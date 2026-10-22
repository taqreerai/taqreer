// Enhance phase 1 (docs/enhance-visuals-plan.md): enforce the carried-picture
// contract on every slide the model writes.
//
// The prompt hands the model each original picture as a ready tag,
// `<img data-asset="s03-a1" src="/api/assets/{projectId}/s03-a1">`. The model
// may move and resize it, but it must never invent a URL. So, server-side:
//   - an <img data-asset="X"> whose X is one of THIS deck's assets gets its src
//     (re)set to the canonical `/api/assets/{projectId}/X`;
//   - an <img> with an unknown data-asset, or any other <img> pointing into
//     /api/assets/ (another project, a typo), is removed;
//   - the picture is never noticeably cropped (owner rule: never cut away the
//     subject): when the box the model drew (inline width / height in px) is
//     within ASPECT_TOLERANCE of the picture's own proportions it keeps
//     object-fit: cover (at most a sliver trimmed); otherwise, or when the box
//     size is not stated on the tag, object-fit: contain shows it whole. The
//     layout itself is never changed.
// Pure string work (runs inside the stream's ingest, no DOM available).

import { renderTableHtml, type TableSpec } from "@/lib/deck/visuals/table";
import { isChartSpec, renderChartHtml, type ChartSpec } from "@/lib/deck/visuals/chart";
import type { FrameSlideDecl } from "@/lib/deck/frame";

const IMG_RE = /<img\b[^>]*>/gi;
const ATTR = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
const ASPECT_TOLERANCE = 0.15;

function attr(tag: string, name: string): string | null {
  const m = tag.match(ATTR(name));
  return m ? (m[2] ?? m[3] ?? "") : null;
}

function setAttr(tag: string, name: string, value: string): string {
  if (ATTR(name).test(tag)) return tag.replace(ATTR(name), ` ${name}="${value}"`);
  return tag.replace(/^<img\b/i, `<img ${name}="${value}"`);
}

// Tallest example size shown for a carried picture (px, 1920x1080 canvas).
const EXAMPLE_MAX_HEIGHT = 560;

function px(style: string, prop: "width" | "height"): number | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px`, "i"));
  return m ? Number(m[1]) : null;
}

function fitFor(style: string, aspect: number | undefined): "cover" | "contain" {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return "contain";
  const w = px(style, "width");
  const h = px(style, "height");
  if (!w || !h) return "contain";
  const drawn = w / h;
  return Math.abs(drawn - aspect) / aspect <= ASPECT_TOLERANCE ? "cover" : "contain";
}

// ─── Tables (step 3) ─────────────────────────────────────────────────
// The model reserves `<div data-table="s05-t1" style="width:..;height:..">`;
// the box is filled here with the EXACT source table (renderTableHtml), and
// whatever the model put inside it is discarded. An unknown table id removes
// the whole box. Nested divs are matched by depth, not by a lazy regex.

const OPEN_TABLE_BOX_RE = /<div\b[^>]*\sdata-(?:table|chart)\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;

function closingDivIndex(html: string, from: number): number {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = from;
  let depth = 1;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

// Walk every table box; `fill` returns its new inner HTML, or null to drop
// the whole box. `inner` is what the box holds now.
function mapTableBoxes(
  html: string,
  fill: (id: string, openTag: string, inner: string) => string | null,
): string {
  if (!/data-(?:table|chart)\s*=/i.test(html)) return html;
  let out = "";
  let cursor = 0;
  OPEN_TABLE_BOX_RE.lastIndex = 0;
  for (let m = OPEN_TABLE_BOX_RE.exec(html); m; m = OPEN_TABLE_BOX_RE.exec(html)) {
    const id = m[2] ?? m[3] ?? "";
    const openEnd = m.index + m[0].length;
    const close = closingDivIndex(html, openEnd);
    if (close < 0) break; // unbalanced: leave the rest as written
    const end = close + "</div>".length;
    const next = fill(id, m[0], html.slice(openEnd, close));
    out += html.slice(cursor, m.index);
    if (next !== null) out += `${m[0]}${next}</div>`;
    cursor = end;
    OPEN_TABLE_BOX_RE.lastIndex = end;
  }
  return out + html.slice(cursor);
}

export function enforceCarriedTables(
  html: string,
  tables: ReadonlyMap<string, TableSpec | ChartSpec>,
): string {
  return mapTableBoxes(html, (id, openTag) => {
    const spec = tables.get(id);
    if (!spec) return null;
    const style = attr(openTag, "style") ?? "";
    // A chart id only fills a data-chart box and a table id a data-table box.
    const wantsChart = /\sdata-chart\s*=/i.test(openTag);
    if (isChartSpec(spec) !== wantsChart) return null;
    return isChartSpec(spec)
      ? renderChartHtml(spec, { boxWidth: px(style, "width"), boxHeight: px(style, "height") })
      : renderTableHtml(spec, { boxHeight: px(style, "height") });
  });
}

export function enforceCarriedAssetImgs(
  html: string,
  projectId: string,
  // assetId -> the picture's own aspect (width / height)
  assets: ReadonlyMap<string, number>,
  // Photo refresh: new assetId -> the original it replaced, stamped as
  // data-asset-original so the studio's "Restore original" works.
  originals?: ReadonlyMap<string, string>,
): string {
  if (!/<img\b/i.test(html)) return html;
  return html.replace(IMG_RE, (tag) => {
    const id = attr(tag, "data-asset");
    if (id !== null) {
      if (!assets.has(id)) return "";
      const style = (attr(tag, "style") ?? "").replace(/;?\s*object-fit\s*:[^;]*/gi, "").trim();
      const fit = fitFor(style, assets.get(id));
      const nextStyle = `${style}${style && !style.endsWith(";") ? ";" : ""}object-fit:${fit}`;
      const aspect = assets.get(id);
      let stamped = aspect && Number.isFinite(aspect) ? setAttr(tag, "data-asset-aspect", String(aspect)) : tag;
      const orig = originals?.get(id);
      if (orig && attr(stamped, "data-asset-original") === null) {
        stamped = setAttr(stamped, "data-asset-original", `/api/assets/${projectId}/${orig}`);
      }
      return setAttr(setAttr(stamped, "src", `/api/assets/${projectId}/${id}`), "style", nextStyle);
    }
    const src = attr(tag, "src") ?? "";
    return /^\s*(https?:\/\/[^/]*)?\/api\/assets\//i.test(src) ? "" : tag;
  });
}

// ─── Prompt side (shared by deck-generate and deck-unlock) ────────────────────────
// One source of truth for what the model is told, so the unlocked tail of a
// free deck places its carried pictures and tables exactly like generation.

export type CarriedPictureRef = {
  assetId: string;
  slideIndex: number;
  // "page": a page-sized artwork (PDF) shown full-bleed as the slide background.
  cls: "content" | "small" | "page" | "backdrop";
  box?: { x: number; y: number; w: number; h: number };
  // Content pictures: a real photo, or a graphic (diagram, scanned page,
  // screenshot). Absent on decks generated before 2026-10-20.
  kind?: "photo" | "graphic" | "document";
  originalAssetId?: string;
  // Rework decks: generic clip-art the redesign may drop or replace, and what
  // the picture shows (labels are matched to pictures by it).
  swap?: boolean;
  shows?: string;
  // An animated GIF: shown whole as a picture, never a background or replaced.
  animated?: boolean;
  aspect: number;
  altText: string | null;
};
export type CarriedTableRef = { tableId: string; slideIndex: number; spec: TableSpec | ChartSpec };

export const CARRIED_TABLES_RULE = `  • ORIGINAL TABLES: FIRST RULE for tables. A slide may come with an "ORIGINAL TABLES" block. For each listed table put ONE EMPTY <div data-table="ID" style="width:...px;height:...px"></div> where the table belongs, sized to fit its rows (start from the suggested size). Never write that table's cells, rows or a <table> yourself, and never repeat its cells as text, cards or bullets elsewhere on the slide (they also appear in the exact-text block; that is the table): the system fills the box with the EXACT table, styled from the slide's text colour and --primary. A title or a short caption above it is fine.`;

export const CARRIED_CHARTS_RULE = `  • ORIGINAL CHARTS: FIRST RULE for charts, overrides the "complex charts" placeholder rule below for every chart it covers. A slide may list "ORIGINAL CHARTS" in the same block as its tables. For each listed chart put ONE EMPTY <div data-chart="ID" style="width:...px;height:...px"></div> where the chart belongs (start from the suggested size; give it real room, charts need at least 700x420px). Never draw the chart, write its numbers, labels or a legend yourself, and never repeat its values as text, cards or bullets elsewhere (they also appear in the exact-text block; that is the chart): the system fills the box with the EXACT chart, in the slide's text colour and brand colours. A title or a short caption above it is fine.`;

export const CARRIED_PICTURES_RULE = `  • ORIGINAL PICTURES: FIRST RULE, overrides the photo, logo and placeholder rules below for every picture it covers. A slide may come with an "ORIGINAL PICTURES" block: the user's own pictures from that slide, already extracted. Put EVERY listed picture on its redesigned slide, exactly once, as the given <img> tag with its data-asset and src attributes UNCHANGED (never write any other /api/assets URL). Give the img an inline style with an explicit width and height in px whose ratio matches the listed aspect (scale the example size; never square a wide picture), so nothing is cut off. PLACEMENT IS FREE: the goal is the best-looking slide, so put each picture wherever the new layout works best and size it for the design; the original place is not a constraint. Never crop away its subject, cover it with text, or replace it with a generated image, a photo slot, an icon or an SVG drawing. PHOTO TREATMENT (entries marked "photo"): pick ONE treatment for the whole deck and apply it to every photo: the same corner radius, the same frame or border (for example a thin brand-colour frame, or the photo set on a soft brand-tinted panel), the same shadow or none. Mixed old photos then read as one set. A uniform gentle grade on every photo is allowed (style="filter:saturate(1.05) contrast(1.05)"); never heavy filters, sepia, blur or colour changes. A weak photo may be shown smaller and framed, or as one tile in a tidy photo grid, rather than stretched as a hero. GRAPHICS AND DOCUMENTS (entries marked "graphic" or "document": diagrams, illustrations, scanned pages, screenshots): shown whole, never cropped, tinted or filtered, never used as a background, on a clean light card when the slide is dark; give them enough size that their labels stay readable. "small" entries are icons, logos or badges: keep them small. Pictures NOT listed (template backgrounds, frame art) are not carried: do not recreate them. A "FULL-PAGE ARTWORK" or "FULL-SLIDE PHOTO" entry is different: it OVERRIDES this whole rule for that slide (follow its own instructions). Each entry also states how much of the source slide it filled: a hint of its importance (a picture that filled most of the slide is the slide's main visual and should stay prominent), not a position to copy. CONTRAST: every word must stay readable on what it sits on. If the original showed light text on a dark picture, panel or bar, and that backing is not carried over or has moved away from the text, give the text its own dark filled shape or switch it to a dark colour; never leave light text on a light slide ground.`;

/**
 * Cover photo (2026-10-21): a source cover with no photo of its own opens the
 * redesign on the deck's strongest photo instead (a plain black title card made
 * a deck of good architecture photos look flat). The largest real photo from
 * any other slide, used as the cover's background; it stays on its own slide.
 * Null when the cover already has a photo, backdrop or page artwork, or the
 * deck has no usable photo (graphics, documents and narrow strips never qualify).
 */
// "Redesign freely" decks (lib/extract/rework-pictures.ts): pictures marked
// SWAPPABLE are generic clip-art the redesign may leave out or replace.
export function reworkPicturesRule(imagesOn: boolean): string {
  return `  • FREE REDESIGN PICTURES: overrides "put EVERY listed picture" for entries marked SWAPPABLE only (generic clip-art and decoration). ${
    imagesOn
      ? "Never show a SWAPPABLE picture as it is: replace it with a generated-image box of the same idea in the deck's single image style when the slide needs a visual, otherwise leave it out."
      : "Leave a SWAPPABLE picture out when it does not fit the new design; keep it when it still helps."
  } Every picture NOT marked SWAPPABLE is content and appears exactly once, as the ORIGINAL PICTURES rule says; a photo of a person (a leader, a teacher, a student) is never left out. LABELS AND PICTURES: when a slide pairs words with pictures (a name under each object), pair them by each entry's "shows": a label goes only with the picture that shows that thing. A "group" picture shows several objects: keep it as one picture with its labels around or beside it, never under a single label. A label with no matching picture stays as text, never on a wrong picture. A "blank" picture is decoration: leave it out.`;
}

export function coverPhotoCandidates<T extends CarriedPictureRef>(pictures: readonly T[]): T[] {
  const onCover = pictures.filter((p) => p.slideIndex === 0);
  if (onCover.some((p) => p.cls === "page" || p.cls === "backdrop" || (p.cls === "content" && p.kind === "photo"))) {
    return [];
  }
  const area = (p: T) => (p.box ? Math.min(1, p.box.w) * Math.min(1, p.box.h) : 0);
  return pictures
    .filter((p) => p.slideIndex !== 0 && p.cls === "content" && p.kind === "photo" && p.aspect >= 1 && p.aspect <= 2.4)
    .sort((a, b) => area(b) - area(a));
}

/**
 * The cover photo chosen at extraction (carried.coverPhotoId; the pixel
 * classifier calls a colourful floor plan a photo, so the pick is confirmed by
 * the Haiku tagger there). Null when none was chosen or the cover has its own.
 */
export function pickCoverPhoto(
  pictures: readonly CarriedPictureRef[],
  coverPhotoId: string | null | undefined,
): CarriedPictureRef | null {
  if (!coverPhotoId) return null;
  return coverPhotoCandidates(pictures).find((p) => p.assetId === coverPhotoId) ?? null;
}

function coverPhotoBlock(p: CarriedPictureRef): string {
  return (
    `── SLIDE 1: COVER PHOTO (asset "${p.assetId}", aspect ${p.aspect}, the deck's own photo from source slide ${p.slideIndex + 1}) ──
` +
    `The source cover has no photo. Open the deck on this one: make it the cover's WHOLE background, so the opening tag includes data-bg="image" data-bg-asset="${p.assetId}" and data-bg-scrim="strong" (no data-bg-prompt, no data-bg-css, no <img> of this asset on this slide). Every word of the source cover stays, in light type over the scrim; the photo still appears on its own slide.

`
  );
}

/** The ORIGINAL PICTURES / ORIGINAL TABLES block for one slide ("" when none). */
export function carriedSlideBlock(
  slideNumber: number, // 1-based
  projectId: string,
  allPictures: readonly CarriedPictureRef[],
  tables: readonly CarriedTableRef[],
  coverPhoto?: CarriedPictureRef | null,
): string {
  let out = slideNumber === 1 && coverPhoto ? coverPhotoBlock(coverPhoto) : "";
  const pictures = allPictures.filter((p) => p.cls !== "page" && p.cls !== "backdrop");
  for (const p of allPictures.filter((q) => q.cls === "backdrop")) {
    out +=
      `── SLIDE ${slideNumber}: FULL-SLIDE PHOTO (asset "${p.assetId}", aspect ${p.aspect}) ──
` +
      `The user's original slide uses this photo as its WHOLE background, with the slide's text on top. Use it the same way: the slide's opening tag must include data-bg="image" data-bg-asset="${p.assetId}" and data-bg-scrim="soft" (or "strong" when the text needs it), with NO data-bg-prompt, no data-bg-css and no <img> of this asset. The well holds the slide's own text and elements as usual (the system draws the photo behind it and a scrim for legibility). Do not box it into a card or a thumbnail.

`;
  }
  for (const p of allPictures.filter((q) => q.cls === "page")) {
    out +=
      `── SLIDE ${slideNumber}: FULL-PAGE ARTWORK (asset "${p.assetId}", aspect ${p.aspect}) ──
` +
      `The user's original page is ONE finished illustration that already contains all of its text and design. Do NOT retype, redraw or restyle it, and do not merge other pages into this slide. REQUIRED for this slide: its opening tag must be exactly <section data-label="..." data-role="..." data-bg="image" data-bg-asset="${p.assetId}"> (NOT data-bg="color", no data-bg-prompt, no data-bg-css) and its well must be EMPTY (<div class="well"></div>): no text, no pictures, no shapes, no labels, because every word is already inside the artwork.

`;
  }
  if (pictures.length > 0) {
    out +=
      `── SLIDE ${slideNumber}: ORIGINAL PICTURES (place each one, tag unchanged) ──\n` +
      pictures
        .map((p) => {
          // Start from the picture's ORIGINAL size on the slide (1920 px canvas),
          // so a hero photo stays a hero photo; fixed examples shrank them all.
          const w0 = p.cls === "small" ? 120 : p.box ? Math.max(200, Math.min(1800, Math.round(p.box.w * 1920))) : 720;
          // A slide's well is ~1060px tall and holds a title too: a tall example
          // size was copied as-is and ran past the canvas (prod 2026-10-22).
          const w = Math.min(w0, Math.round(EXAMPLE_MAX_HEIGHT * p.aspect));
          const kind = p.kind ? `; ${p.kind}` : "";
          const where = p.box
            ? `${kind}; filled ${Math.round(Math.min(1, p.box.w) * 100)}% x ${Math.round(Math.min(1, p.box.h) * 100)}% of the source slide (importance hint, place it freely)`
            : kind;
          return `<img data-asset="${p.assetId}" src="/api/assets/${projectId}/${p.assetId}" alt="${(p.altText ?? "").replace(/["<>&]/g, "")}">  aspect ${p.aspect} (e.g. ${w}x${Math.round(w / p.aspect)}px)${p.cls === "small" ? "  small: icon / logo / badge" : where}${p.shows ? `  shows: "${p.shows.replace(/["<>&]/g, "")}"` : ""}${p.animated ? "  ANIMATED: a moving picture; show it whole as a picture (never a background, never cropped, never replaced by a generated image)" : ""}${p.swap ? "  SWAPPABLE: generic clip-art (free redesign: may be left out or replaced, see FREE REDESIGN)" : ""}`;
        })
        .join("\n") +
      "\n\n";
  }
  if (tables.length > 0) {
    out +=
      `── SLIDE ${slideNumber}: ORIGINAL TABLES / CHARTS (the system fills each box) ──\n` +
      tables
        .map((t) => {
          if (isChartSpec(t.spec)) {
            const c = t.spec;
            const shown = c.series.filter((x) => !x.hidden);
            const wide = c.type === "pie" ? 900 : c.categories.length > 8 ? 1500 : 1100;
            return `<div data-chart="${t.tableId}"></div>  CHART: ${c.type}${c.stacked ? " (stacked)" : ""}, ${c.categories.length} categories, ${shown.length} series${c.title ? `, titled "${c.title.replace(/["<>&]/g, "")}"` : ""}; suggested box ${wide}x520px`;
          }
          const rows = t.spec.rows.length;
          const cells = t.spec.rows.flat();
          const chars = cells.reduce((n, c) => n + c.text.length, 0) / Math.max(1, cells.length);
          const width = t.spec.columns >= 4 || chars > 30 ? 1600 : 1100;
          const height = Math.min(820, rows * (chars > 30 ? 120 : 76));
          return `<div data-table="${t.tableId}"></div>  ${rows} rows x ${t.spec.columns} columns${t.spec.headerRow ? ", header row" : ""}; suggested box ${width}x${height}px`;
        })
        .join("\n") +
      "\n\n";
  }
  return out;
}

// ─── Keeping them through later rewrites ───────────────────────────────────────────────
// The bake's vision review and the studio's "redesign this slide" rewrite a
// slide that already holds carried pictures and filled tables. Snapshot them
// from the CURRENT slide, then after the rewrite: canonical links, the exact
// table bodies back (the model may have touched them), anything foreign
// removed, and report what the rewrite DROPPED so the caller can refuse the
// rewrite (bake) or put the items back (redesign).

export type CarriedSnapshot = {
  assets: Map<string, number>; // assetId -> aspect (NaN when unknown)
  tables: Map<string, string>; // tableId -> the filled table HTML
};

export function snapshotCarried(html: string): CarriedSnapshot {
  const assets = new Map<string, number>();
  for (const m of html.matchAll(IMG_RE)) {
    const id = attr(m[0], "data-asset");
    if (id) assets.set(id, Number(attr(m[0], "data-asset-aspect") ?? NaN));
  }
  const tables = new Map<string, string>();
  mapTableBoxes(html, (id, _open, inner) => {
    if (id && /<(table|svg)\b/i.test(inner)) tables.set(id, inner);
    return inner;
  });
  return { assets, tables };
}

export function hasCarried(snap: CarriedSnapshot): boolean {
  return snap.assets.size > 0 || snap.tables.size > 0;
}

export function restoreCarried(
  html: string,
  projectId: string,
  snap: CarriedSnapshot,
): { html: string; missing: string[] } {
  let out = enforceCarriedAssetImgs(html, projectId, snap.assets);
  out = mapTableBoxes(out, (id) => snap.tables.get(id) ?? null);
  const present = snapshotCarried(out);
  const missing = [
    ...[...snap.assets.keys()].filter((id) => !present.assets.has(id)),
    ...[...snap.tables.keys()].filter((id) => !present.tables.has(id)),
  ];
  return { html: out, missing };
}

/**
 * Put dropped carried items back at the end of the slide's well (a plain row),
 * so a redesign never loses the user's picture or table. Layout polish is left
 * to the bake's review, which may move them but can no longer drop them.
 */
export function appendMissingCarried(
  html: string,
  projectId: string,
  snap: CarriedSnapshot,
  missing: readonly string[],
): string {
  if (missing.length === 0) return html;
  const parts: string[] = [];
  for (const id of missing) {
    if (snap.assets.has(id)) {
      const aspect = snap.assets.get(id)!;
      const w = 520;
      const h = Number.isFinite(aspect) && aspect > 0 ? Math.round(w / aspect) : 390;
      parts.push(
        `<img data-asset="${id}"${Number.isFinite(aspect) ? ` data-asset-aspect="${aspect}"` : ""} src="/api/assets/${projectId}/${id}" alt="" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:16px">`,
      );
    } else if (snap.tables.has(id)) {
      const inner = snap.tables.get(id)!;
      const isChart = /<svg\b/i.test(inner);
      parts.push(`<div data-${isChart ? "chart" : "table"}="${id}" style="width:100%;${isChart ? "height:480px" : ""}">${inner}</div>`);
    }
  }
  if (parts.length === 0) return html;
  const row = `<div style="display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start">${parts.join("")}</div>`;
  const well = /<div\b[^>]*class\s*=\s*("[^"]*\bwell\b[^"]*"|'[^']*\bwell\b[^']*')[^>]*>/i.exec(html);
  if (well) {
    const close = closingDivIndex(html, well.index + well[0].length);
    if (close >= 0) return html.slice(0, close) + row + html.slice(close);
  }
  return html + row;
}

// ─── Full-page artwork as the slide background (PDF, cls "page") ──────────
// The model marks a slide `data-bg-asset="ID"`. Only an ID that is one of THIS
// deck's page assets is honoured: the server stamps the canonical src
// (decl.bgAssetSrc, persisted on the stored section like bgRef) and empties the
// well, because the artwork already carries its words.

const BG_ASSET_SRC_RE = /^\/api\/assets\/[A-Za-z0-9]{8,40}\/[a-z0-9][a-z0-9-]{0,63}$/i;

export function isBgAssetSrc(v: string | null | undefined): v is string {
  return !!v && BG_ASSET_SRC_RE.test(v);
}

export function applyPageBackdrop(
  decl: FrameSlideDecl,
  projectId: string,
  pageIds: ReadonlySet<string>,
  // Safety net when the model left the marker off: the page artwork of THIS
  // slide position (source page = slide), used only if the model also wrote
  // nothing in the well (so no text it authored is thrown away).
  fallbackId?: string | null,
  // Full-slide PHOTO backdrops (cls "backdrop"): same marker, but the slide
  // keeps its own text and the model's scrim choice.
  photoIds?: ReadonlySet<string>,
): void {
  const photo = decl.bgAsset;
  if (photo && photoIds?.has(photo)) {
    decl.bgAssetSrc = `/api/assets/${projectId}/${photo}`;
    decl.bg = "image";
    decl.bgPrompt = null;
    if (decl.bgScrim === "none") decl.bgScrim = "soft";
    return;
  }
  let id = decl.bgAsset;
  if (!(id && pageIds.has(id)) && fallbackId && pageIds.has(fallbackId)) {
    const hasContent = /<img\b|<svg\b|<table\b/i.test(decl.wellHtml) || decl.wellHtml.replace(/<[^>]*>/g, "").trim() !== "";
    if (!hasContent) id = fallbackId;
  }
  if (id && pageIds.has(id)) {
    decl.bgAssetSrc = `/api/assets/${projectId}/${id}`;
    decl.bg = "image";
    decl.bgPrompt = null;
    decl.bgScrim = "none";
    decl.wellHtml = '<div class="well"></div>';
  } else {
    decl.bgAssetSrc = null;
  }
}

/** The backdrop a stored section already has (for rewrites that must keep it). */
export function storedPageBackdrop(storedHtml: string, projectId: string): string | null {
  const tag = /<section\b[^>]*>/i.exec(storedHtml)?.[0] ?? "";
  const m = tag.match(/\sdata-bg-asset-src\s*=\s*"([^"]*)"/i);
  const src = m?.[1] ?? null;
  return isBgAssetSrc(src) && src.startsWith(`/api/assets/${projectId}/`) ? src : null;
}

/** A rewrite keeps the slide's existing backdrop and ignores whatever the model wrote. */
export function keepPageBackdrop(decl: FrameSlideDecl, storedHtml: string, projectId: string): void {
  const prev = storedPageBackdrop(storedHtml, projectId);
  decl.bgAssetSrc = prev;
  if (prev) {
    decl.bg = "image";
    decl.bgPrompt = null;
    decl.bgScrim = "none";
  }
}
