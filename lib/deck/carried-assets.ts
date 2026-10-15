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

const OPEN_TABLE_BOX_RE = /<div\b[^>]*\sdata-table\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;

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

export function enforceCarriedTables(
  html: string,
  tables: ReadonlyMap<string, TableSpec>,
): string {
  if (!/data-table\s*=/i.test(html)) return html;
  let out = "";
  let cursor = 0;
  OPEN_TABLE_BOX_RE.lastIndex = 0;
  for (let m = OPEN_TABLE_BOX_RE.exec(html); m; m = OPEN_TABLE_BOX_RE.exec(html)) {
    const id = m[2] ?? m[3] ?? "";
    const openEnd = m.index + m[0].length;
    const close = closingDivIndex(html, openEnd);
    if (close < 0) break; // unbalanced: leave the rest as written
    const end = close + "</div>".length;
    const spec = tables.get(id);
    out += html.slice(cursor, m.index);
    if (spec) {
      const style = attr(m[0], "style") ?? "";
      out += `${m[0]}${renderTableHtml(spec, { boxHeight: px(style, "height") })}</div>`;
    }
    cursor = end;
    OPEN_TABLE_BOX_RE.lastIndex = end;
  }
  return out + html.slice(cursor);
}

export function enforceCarriedAssetImgs(
  html: string,
  projectId: string,
  // assetId -> the picture's own aspect (width / height)
  assets: ReadonlyMap<string, number>,
): string {
  if (!/<img\b/i.test(html)) return html;
  return html.replace(IMG_RE, (tag) => {
    const id = attr(tag, "data-asset");
    if (id !== null) {
      if (!assets.has(id)) return "";
      const style = (attr(tag, "style") ?? "").replace(/;?\s*object-fit\s*:[^;]*/gi, "").trim();
      const fit = fitFor(style, assets.get(id));
      const nextStyle = `${style}${style && !style.endsWith(";") ? ";" : ""}object-fit:${fit}`;
      return setAttr(setAttr(tag, "src", `/api/assets/${projectId}/${id}`), "style", nextStyle);
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
  cls: "content" | "small";
  aspect: number;
  altText: string | null;
};
export type CarriedTableRef = { tableId: string; slideIndex: number; spec: TableSpec };

export const CARRIED_TABLES_RULE = `  • ORIGINAL TABLES: FIRST RULE for tables. A slide may come with an "ORIGINAL TABLES" block. For each listed table put ONE EMPTY <div data-table="ID" style="width:...px;height:...px"></div> where the table belongs, sized to fit its rows (start from the suggested size). Never write that table's cells, rows or a <table> yourself, and never repeat its cells as text, cards or bullets elsewhere on the slide (they also appear in the exact-text block; that is the table): the system fills the box with the EXACT table, styled from the slide's text colour and --primary. A title or a short caption above it is fine.`;

export const CARRIED_PICTURES_RULE = `  • ORIGINAL PICTURES: FIRST RULE, overrides the photo, logo and placeholder rules below for every picture it covers. A slide may come with an "ORIGINAL PICTURES" block: the user's own pictures from that slide, already extracted. Put EVERY listed picture on its redesigned slide, exactly once, as the given <img> tag with its data-asset and src attributes UNCHANGED (never write any other /api/assets URL). Give the img an inline style with an explicit width and height in px whose ratio matches the listed aspect (scale the example size; never square a wide picture), so nothing is cut off. Move, resize, round, frame or shadow it to suit the new design; never crop away its subject, recolour it with filters, cover it with text, or replace it with a generated image, a photo slot, an icon or an SVG drawing. "small" entries are icons, logos or badges: keep them small. Pictures NOT listed (template backgrounds, frame art) are not carried: do not recreate them.`;

/** The ORIGINAL PICTURES / ORIGINAL TABLES block for one slide ("" when none). */
export function carriedSlideBlock(
  slideNumber: number, // 1-based
  projectId: string,
  pictures: readonly CarriedPictureRef[],
  tables: readonly CarriedTableRef[],
): string {
  let out = "";
  if (pictures.length > 0) {
    out +=
      `── SLIDE ${slideNumber}: ORIGINAL PICTURES (place each one, tag unchanged) ──\n` +
      pictures
        .map((p) => {
          const w = p.cls === "small" ? 120 : 720;
          return `<img data-asset="${p.assetId}" src="/api/assets/${projectId}/${p.assetId}" alt="${(p.altText ?? "").replace(/["<>&]/g, "")}">  aspect ${p.aspect} (e.g. ${w}x${Math.round(w / p.aspect)}px)${p.cls === "small" ? "  small: icon / logo / badge" : ""}`;
        })
        .join("\n") +
      "\n\n";
  }
  if (tables.length > 0) {
    out +=
      `── SLIDE ${slideNumber}: ORIGINAL TABLES (the system fills each box) ──\n` +
      tables
        .map((t) => {
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
