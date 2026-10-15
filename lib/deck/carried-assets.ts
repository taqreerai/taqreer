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
