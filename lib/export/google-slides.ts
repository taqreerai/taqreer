"use client";

// Google Slides export - the CLIENT-SIDE half of the "Export to Google
// Slides" menu entry (user direction 2026-07-13: a real Slides deck, not
// a .pptx download; the dom-to-pptx + BiDi pipeline stays the engine).
//
// Flow: acquire a `drive.file` access token via Google Identity Services
// (popup consent, once per session - the token lives ONLY in this browser
// tab, never on our servers), upload the dom-to-pptx blob to the Drive API
// with the Google-Slides mimeType so Drive converts it to a NATIVE Slides
// presentation, and hand back the docs.google.com edit URL.
//
// `drive.file` is the narrow non-restricted scope: it grants access ONLY
// to files this app creates, not the user's Drive. The OAuth client is the
// SAME Google Cloud client the Supabase Google signin uses (client id is
// public by design - it rides every signin redirect); it needs the app's
// origins in "Authorized JavaScript origins" + the Drive API enabled.

const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Thrown when NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID is absent - callers fall
 *  back to the plain PPTX download so the menu entry never dead-ends. */
export class GoogleSlidesConfigError extends Error {
  constructor() {
    super("Google Slides export is not configured (missing client id)");
    this.name = "GoogleSlidesConfigError";
  }
}

/** Thrown when the user closes/denies the consent popup (or the browser
 *  blocks it) - same PPTX-download fallback as the config error. */
export class GoogleAuthDeclinedError extends Error {
  constructor(reason: string) {
    super(`Google authorization declined: ${reason}`);
    this.name = "GoogleAuthDeclinedError";
  }
}

// Minimal GIS surface (the official types live in @types/google.accounts;
// not worth a dependency for two calls).
type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};
type GisGlobal = {
  accounts?: {
    oauth2?: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (resp: GisTokenResponse) => void;
        error_callback?: (err: { type?: string }) => void;
      }) => { requestAccessToken: (cfg?: { prompt?: string }) => void };
    };
  };
};

let gisLoad: Promise<void> | null = null;
// Session token cache - GIS tokens last ~1h; the 60s slack keeps a token
// that is about to expire from being used for a multi-second upload.
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadGis(): Promise<void> {
  if (gisLoad) return gisLoad;
  gisLoad = new Promise<void>((resolve, reject) => {
    const existing = (window as unknown as { google?: GisGlobal }).google;
    if (existing?.accounts?.oauth2) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      // Allow a retry on a later click instead of caching the failure.
      gisLoad = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(s);
  });
  return gisLoad;
}

/**
 * Resolve a `drive.file` access token: cached when fresh, else the GIS
 * consent popup. Call this FIRST in the click handler - before the
 * multi-second PPTX build - so the popup still rides the user gesture.
 */
export async function ensureDriveToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new GoogleSlidesConfigError();
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  await loadGis();
  const google = (window as unknown as { google?: GisGlobal }).google;
  const oauth2 = google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services unavailable");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (!resp.access_token) {
          reject(new GoogleAuthDeclinedError(resp.error ?? "no token"));
          return;
        }
        cachedToken = {
          token: resp.access_token,
          expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
        };
        resolve(resp.access_token);
      },
      // Popup closed / blocked / origin not authorized.
      error_callback: (err) =>
        reject(new GoogleAuthDeclinedError(err?.type ?? "popup closed")),
    });
    client.requestAccessToken();
  });
}

/**
 * Google Slides' PPTX importer does not support SVG (root-caused
 * 2026-07-13 on a live deck: every svgBlip-carrying picture rendered as
 * a broken-image icon - including the full-bleed background, which
 * whited out the whole slide). PowerPoint prefers the svg part, Slides
 * chokes on the extension instead of falling back - so the UPLOAD COPY
 * is made Slides-safe in two steps; the PPTX download path is untouched
 * (PowerPoint keeps the crisp, editable vectors):
 *
 *   1. RE-RASTERIZE: dom-to-pptx dual-encodes every SVG with a raster
 *      fallback, but many fallbacks are BLANK (found on the same deck;
 *      latent until Slides, because PowerPoint never reads fallbacks).
 *      Two proven causes, both handled by prepareStandaloneSvg below:
 *        a. dom-to-pptx copies inline <svg> elements VERBATIM, so the
 *           root keeps DOM-layout styles like `inset: 0 auto auto 40px`
 *           - in a standalone svg document that shifts the drawing
 *           outside its own viewport (all-but-the-first icon in a row
 *           rasterized blank, upstream AND here before the strip).
 *        b. An inline svg may reference defs (pattern/gradient ids)
 *           that live in a SIBLING inline svg of the same slide DOM;
 *           standalone, the url(#id) dangles and the shape renders
 *           empty - in every renderer, PowerPoint included. The defs
 *           are inlined from the same sheet's other svg parts.
 *      Text-free svg parts are then re-rendered with the browser's own
 *      SVG engine and overwrite the fallback bytes. Svgs bearing <text>
 *      keep dom-to-pptx's fallback (it rendered WITH document webfonts;
 *      an isolated <img> render would fall back to system fonts) unless
 *      that fallback is effectively blank - then anything beats nothing.
 *
 *   2. STRIP the svgBlip extensions so Slides reads those fallbacks.
 *
 * The orphaned svg media parts + rels stay in the zip on purpose - a
 * relationship pointing at a deleted part is an OOXML validity risk,
 * an unreferenced part is not.
 */
const SVG_BLIP_EXT_RE =
  /<a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}">[\s\S]*?<\/a:ext>/g;

export async function rasterizeSvgsForSlides(pptx: Blob): Promise<Blob> {
  // Dynamic import, same pattern as html-export: jszip stays out of the
  // main bundle until an export actually runs.
  const JSZipImport = await import("jszip");
  const JSZip = (JSZipImport.default ??
    JSZipImport) as typeof import("jszip");
  const zip = await JSZip.loadAsync(pptx);
  const xmlPaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(p),
  );

  // Pass 1: collect raster-part -> svg-part pairs from every sheet's
  // blips (resolving rIds through the sheet's rels), remembering which
  // sheet each pair belongs to - defs inlining is per-sheet (ids like
  // "pt1" can collide across slides with different content).
  const pairs = new Map<string, { svgPath: string; sheet: string }>();
  const sheetSvgPaths = new Map<string, Set<string>>();
  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const relsFile = zip.file(path.replace(/([^/]+)\.xml$/, "_rels/$1.xml.rels"));
    if (!relsFile) continue;
    const rels = await relsFile.async("string");
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      // Sheet-relative "../media/x" -> "ppt/media/x" (sheets all live one
      // level under ppt/); tolerate package-absolute "/ppt/media/x" too.
      relMap.set(m[1], m[2].replace(/^\.\.\//, "ppt/").replace(/^\//, ""));
    }
    for (const m of xml.matchAll(
      /<a:blip[^>]*r:embed="([^"]+)"[^>]*>([\s\S]*?)<\/a:blip>/g,
    )) {
      const svgRef = m[2].match(/svgBlip[^>]*r:embed="([^"]+)"/);
      if (!svgRef) continue;
      const rasterPath = relMap.get(m[1]);
      const svgPath = relMap.get(svgRef[1]);
      if (rasterPath && svgPath && zip.file(rasterPath) && zip.file(svgPath)) {
        pairs.set(rasterPath, { svgPath, sheet: path });
        let set = sheetSvgPaths.get(path);
        if (!set) sheetSvgPaths.set(path, (set = new Set()));
        set.add(svgPath);
      }
    }
  }

  // Per-sheet pool of id-bearing def elements across ALL the sheet's svg
  // parts, built once per sheet (the sibling-defs case in the doc comment).
  const parser = new DOMParser();
  const defsPools = new Map<string, Map<string, Element>>();
  const defsPoolFor = async (sheet: string): Promise<Map<string, Element>> => {
    const cached = defsPools.get(sheet);
    if (cached) return cached;
    const pool = new Map<string, Element>();
    for (const svgPath of sheetSvgPaths.get(sheet) ?? []) {
      const file = zip.file(svgPath);
      if (!file) continue;
      const root = parseStandaloneSvg(parser, await file.async("string"));
      if (!root) continue;
      for (const el of Array.from(root.querySelectorAll("[id]"))) {
        if (SVG_DEF_TAGS.has(el.tagName) && !pool.has(el.id)) {
          pool.set(el.id, el);
        }
      }
    }
    defsPools.set(sheet, pool);
    return pool;
  };

  // Pass 2: re-render fallbacks (see doc comment for the text-svg rule).
  for (const [rasterPath, { svgPath, sheet }] of pairs) {
    try {
      const svgFile = zip.file(svgPath);
      const rasterFile = zip.file(rasterPath);
      if (!svgFile || !rasterFile) continue;
      const svgText = await svgFile.async("string");
      const hasText = /<text[\s>]/.test(svgText);
      if (hasText) {
        const existing = await rasterFile.async("blob");
        if (!(await imageIsEffectivelyBlank(existing))) continue;
      }
      const root = parseStandaloneSvg(parser, svgText);
      if (!root) continue;
      const cleaned = prepareStandaloneSvg(root, await defsPoolFor(sheet));
      const png = await svgToPngBlob(cleaned);
      if (png) zip.file(rasterPath, png);
    } catch {
      // Any failure keeps the original fallback for this image.
    }
  }

  // Pass 3: strip the svgBlip extensions.
  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const stripped = xml.replace(SVG_BLIP_EXT_RE, "");
    if (stripped !== xml) zip.file(path, stripped);
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** Def-like svg elements worth pooling for cross-part id resolution. */
const SVG_DEF_TAGS = new Set([
  "pattern",
  "linearGradient",
  "radialGradient",
  "clipPath",
  "filter",
  "marker",
  "symbol",
]);

/** Root style properties that are DOM-layout leftovers, not drawing
 *  state. `inset`/`left`/... place the svg inside the SLIDE; standalone
 *  they shift the drawing outside its own viewport (proven blank-icon
 *  cause - see rasterizeSvgsForSlides doc). */
const ROOT_LAYOUT_PROPS = [
  "position",
  "inset",
  "left",
  "top",
  "right",
  "bottom",
  "margin",
  "grid-area",
];

/** Parse an svg part into a detached DOM root. Inline svg in HTML needs
 *  no xmlns but a standalone document does - inject it when absent so
 *  DOMParser yields a real svg root. Returns null on parse failure. */
function parseStandaloneSvg(
  parser: DOMParser,
  svgText: string,
): Element | null {
  const withNs = /<svg[^>]*\sxmlns=/.test(svgText)
    ? svgText
    : svgText.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = parser.parseFromString(withNs, "image/svg+xml");
  const root = doc.documentElement;
  return root.tagName.toLowerCase() === "svg" ? root : null;
}

/** Make a parsed svg render correctly OUTSIDE its original slide DOM:
 *  strip root layout leftovers and inline any defs it references but
 *  doesn't own (iterating so nested refs like pattern->gradient settle).
 *  Returns the serialized standalone markup. */
function prepareStandaloneSvg(
  root: Element,
  defsPool: Map<string, Element>,
): string {
  const style = (root as unknown as { style?: CSSStyleDeclaration }).style;
  if (style) {
    for (const prop of ROOT_LAYOUT_PROPS) style.removeProperty(prop);
  }
  const doc = root.ownerDocument;
  for (let pass = 0; pass < 3 && doc; pass++) {
    const text = new XMLSerializer().serializeToString(root);
    const wanted = new Set<string>();
    for (const m of text.matchAll(/url\(\s*(?:"|'|&quot;)?#([^"'&)\s]+)/g)) {
      wanted.add(m[1]);
    }
    for (const m of text.matchAll(/\shref="#([^"]+)"/g)) {
      wanted.add(m[1]);
    }
    let added = false;
    for (const id of wanted) {
      const def = defsPool.get(id);
      if (!def) continue;
      try {
        if (root.querySelector(`[id="${id}"]`)) continue;
      } catch {
        continue; // exotic id broke the selector - skip, keep fallback
      }
      let defs = root.querySelector("defs");
      if (!defs) {
        defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
        root.insertBefore(defs, root.firstChild);
      }
      defs.appendChild(doc.importNode(def, true));
      added = true;
    }
    if (!added) break;
  }
  return new XMLSerializer().serializeToString(root);
}

/** Render a standalone svg string to a PNG blob at the svg's own
 *  declared size (dom-to-pptx already declares 2x the on-slide size). */
async function svgToPngBlob(svgText: string): Promise<Blob | null> {
  const url = URL.createObjectURL(
    new Blob([svgText], { type: "image/svg+xml" }),
  );
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg decode failed"));
      img.src = url;
    });
    const w = Math.max(1, Math.round(img.naturalWidth || 1));
    const h = Math.max(1, Math.round(img.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "Blank" = under 0.5% of sampled pixels are neither transparent nor
 *  white - catches both the fully-empty icon fallbacks and the
 *  border-line-only pattern fallback dom-to-pptx produced. */
async function imageIsEffectivelyBlank(image: Blob): Promise<boolean> {
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let content = 0;
    let sampled = 0;
    // Stride of 4 pixels keeps this sub-millisecond on big fallbacks.
    for (let i = 0; i < data.length; i += 16) {
      sampled++;
      const a = data[i + 3];
      if (a < 8) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 247 && g > 247 && b > 247) continue;
      content++;
    }
    return content / Math.max(1, sampled) < 0.005;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Upload the dom-to-pptx blob to Drive with the Slides mimeType - Drive
 * converts it to a native Google Slides presentation. Returns the edit URL.
 *
 * Body is hand-built `multipart/related` (the Drive contract) - FormData
 * would send multipart/form-data, which the upload endpoint rejects.
 */
export async function uploadPptxAsGoogleSlides(
  pptx: Blob,
  title: string,
  token: string,
): Promise<{ url: string }> {
  const metadata = {
    name: title,
    mimeType: "application/vnd.google-apps.presentation",
  };
  const boundary = `taqreer_gslides_${Math.random().toString(36).slice(2)}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${PPTX_MIME}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Blob([head, pptx, tail]),
  });
  if (!res.ok) {
    // A stale/revoked token shouldn't poison the session cache.
    if (res.status === 401) cachedToken = null;
    throw new Error(`Google Drive upload failed (${res.status})`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Google Drive upload returned no file id");
  return { url: `https://docs.google.com/presentation/d/${json.id}/edit` };
}
