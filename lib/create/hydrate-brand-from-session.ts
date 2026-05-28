// Shared brand-hydration logic for the four landing flows
// (/create, /enhance, /mimic, /datasheet). Reads the canonical
// `taqreer:create:brand` sessionStorage blob and returns the
// minimal pieces each flow needs to seed its own state:
//
//   - colors             -> palette swatches
//   - headingFontSlot    -> FontSlotState (google or upload)
//   - bodyFontSlot       -> FontSlotState
//   - logo               -> { storageUrl, displayUrl, name,
//                             position, exclude } | null
//
// Why a sessionStorage hop and not a direct prop:
// `seedFromBrandKit` (the brand-kits use path) and `seedFromTemplate`
// (the templates use path) both navigate via `window.location.assign`,
// so the landing flow re-mounts with no React props from the source
// page. sessionStorage is the canonical handoff channel for both.
//
// The "default brand kit" code path is a bonus on top: when no
// sessionStorage blob exists on first mount, the flow can call
// `fetchDefaultBrandKit()` and pipe THAT through the same applier
// shape — there's no second hydrator to write.

import { emptyFontSlot, type FontSlotState } from "@/lib/brand/fonts";

export const CREATE_BRAND_KEY = "taqreer:create:brand";

// Parsed shape we hand back to callers. All fields optional — each
// flow applies only what's present. `logo.displayUrl` is the short-
// lived signed URL we render in the slot; `logo.storageUrl` is the
// bucket path the submit pipeline re-signs server-side (no client-
// side trust assumption).
export type HydratedBrand = {
  colors: string[];
  headingFontSlot: FontSlotState;
  bodyFontSlot: FontSlotState;
  logo: {
    storageUrl: string;
    displayUrl: string | null;
    name: string | null;
    position: string;
    exclude: ("cover" | "closing")[];
  } | null;
};

// Resolve the canonical family name from either `{name}` or `{family}`
// — brand-kits POST persists `family`, older blobs use `name`. Returns
// empty string when neither is a non-blank string.
function pickFontFamily(slot: { name?: unknown; family?: unknown }): string {
  if (typeof slot.family === "string" && slot.family.trim()) {
    return slot.family;
  }
  if (typeof slot.name === "string" && slot.name.trim()) {
    return slot.name;
  }
  return "";
}

// Narrow `font` JSON (Json from Prisma) to a FontSlotState. Accepts
// both `{name}` and `{family}` canonical shapes that the brand-kits
// POST persists. When the kit's font has a storageUrl (uploaded), we
// restore as `mode: "upload"`. When it has a `url` pointing at
// Google's CSS API (or just a `family`), restore as `mode: "google"`.
// Garbage in -> empty slot.
function readFontSlot(value: unknown): FontSlotState {
  if (!value || typeof value !== "object") return emptyFontSlot();
  const slot = value as {
    name?: unknown;
    family?: unknown;
    url?: unknown;
    storageUrl?: unknown;
  };

  const family = pickFontFamily(slot);
  if (!family) return emptyFontSlot();

  // Uploaded font → restore as upload-mode with the storage URL (no
  // File handle survives a page navigation; the submit pipeline
  // reuses the storageUrl directly).
  if (typeof slot.storageUrl === "string" && slot.storageUrl) {
    return {
      mode: "upload",
      googleFamily: null,
      uploadFile: null,
      uploadName: typeof slot.name === "string" ? slot.name : null,
      uploadStorageUrl: slot.storageUrl,
      uploadFamily: family,
    };
  }

  // Otherwise fall back to Google-mode using the family name.
  return {
    mode: "google",
    googleFamily: family,
    uploadFile: null,
    uploadName: null,
    uploadStorageUrl: null,
    uploadFamily: "",
  };
}

function readColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && /^#[0-9A-Fa-f]{3,8}$/.test(v),
  );
}

// Shared logo-shape builder used by both the sessionStorage and the
// default-kit-fetch paths. `displayUrl` is the rendered preview src;
// callers pass it in because the field name differs between the two
// sources (sessionStorage uses `url`, server response uses `signedUrl`).
function buildLogo(args: {
  storageUrl: string;
  displayUrl: string | null;
  name: string | null;
  position: string | null;
  exclude: unknown;
}): HydratedBrand["logo"] {
  const exclude = Array.isArray(args.exclude)
    ? args.exclude.filter(
        (v): v is "cover" | "closing" => v === "cover" || v === "closing",
      )
    : [];
  return {
    storageUrl: args.storageUrl,
    displayUrl: args.displayUrl,
    name: args.name,
    position: args.position ?? "top-right",
    exclude,
  };
}

function readLogo(value: unknown): HydratedBrand["logo"] {
  if (!value || typeof value !== "object") return null;
  const blob = value as {
    storageUrl?: unknown;
    url?: unknown;
    name?: unknown;
    position?: unknown;
    exclude?: unknown;
  };
  if (typeof blob.storageUrl !== "string" || !blob.storageUrl) return null;
  return buildLogo({
    storageUrl: blob.storageUrl,
    displayUrl: typeof blob.url === "string" ? blob.url : null,
    name: typeof blob.name === "string" ? blob.name : null,
    position: typeof blob.position === "string" ? blob.position : null,
    exclude: blob.exclude,
  });
}

/**
 * Read & parse the brand sessionStorage blob. Returns null when the
 * key is missing or the blob is unparseable.
 */
export function readBrandFromSession(): HydratedBrand | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(CREATE_BRAND_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const blob = parsed as {
    colors?: unknown;
    fonts?: { heading?: unknown; body?: unknown };
    logo?: unknown;
  };
  return {
    colors: readColors(blob.colors),
    headingFontSlot: readFontSlot(blob.fonts?.heading),
    bodyFontSlot: readFontSlot(blob.fonts?.body),
    logo: readLogo(blob.logo),
  };
}

/**
 * Fetch the user's default brand kit from the server and convert to
 * the HydratedBrand shape. Returns null when no default is set or the
 * fetch fails. Used as a fallback on first mount when no sessionStorage
 * blob exists.
 */
export async function fetchDefaultBrandKit(): Promise<HydratedBrand | null> {
  // Response shape declared loosely because the body is parsed
  // from a network response — TypeScript only protects against
  // compile-time type drift, not runtime API-shape drift. Runtime
  // validation below before any property reads.
  type DefaultBody = {
    kit?: {
      colors?: unknown;
      fonts?: { heading?: unknown; body?: unknown } | null;
      logo?: {
        storageUrl?: string | null;
        signedUrl?: string | null;
        name?: string | null;
        position?: string;
        exclude?: ("cover" | "closing")[];
      } | null;
    } | null;
  };
  let body: DefaultBody;
  try {
    const res = await fetch("/api/brand-kits/default", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    body = (await res.json()) as DefaultBody;
  } catch {
    return null;
  }

  // Runtime shape guard — if the response isn't an object (malformed
  // JSON proxied as "OK", e.g. an HTML error page that slipped past
  // res.ok), bail before reading `.kit` would crash.
  if (!body || typeof body !== "object" || !("kit" in body) || !body.kit) {
    return null;
  }

  const logoBlob = body.kit.logo;
  const logo =
    logoBlob && typeof logoBlob.storageUrl === "string" && logoBlob.storageUrl
      ? buildLogo({
          storageUrl: logoBlob.storageUrl,
          displayUrl: logoBlob.signedUrl ?? null,
          name: logoBlob.name ?? null,
          position: logoBlob.position ?? null,
          exclude: logoBlob.exclude,
        })
      : null;

  return {
    colors: readColors(body.kit.colors),
    headingFontSlot: readFontSlot(body.kit.fonts?.heading),
    bodyFontSlot: readFontSlot(body.kit.fonts?.body),
    logo,
  };
}
