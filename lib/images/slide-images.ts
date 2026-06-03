// Slide image-box helpers — Phase 2 of context/images.md.
//
// Pure string utilities shared by BOTH the server (the deck-images
// Inngest function: scan a slide's HTML for reserved boxes, then inject
// each generated image's URL back as the box's <img src>) AND the client
// (DeckView's realtime progressive swap, Phase 2b). No DOM / JSDOM
// dependency on purpose, so the same code runs in the browser bundle and
// in Node.
//
// The boxes are emitted by OUR own images-mode prompt (deck-generate
// SYSTEM_PROMPT_IMAGES), so the markup shape is known:
//   <img data-genimage="<textless prompt>" data-genid="<unique>"
//        alt="" style="width:…px;height:…px;object-fit:cover;…" />  (NO src yet)
// Only data-genimage + data-genid are required of Claude; the image
// ASPECT is derived from the box's own width/height (see scanGenImages),
// and the ROLE is no-longer requested (defaults to "hero"). Legacy decks
// that still carry data-genrole / data-genaspect are honoured.
// Attribute ORDER is not assumed — Claude reorders freely — so every
// lookup is attribute-name-keyed, and tag boundaries are found with a
// quote-aware scan (a prompt value may legitimately contain a `>`).

// Hard ceiling on generated images per deck — a cost guard enforced
// server-side only (the prompt no longer states a cap; Claude reserves
// boxes freely and the dispatcher stops warming past this count). Shared
// by the warm-during-stream dispatcher (deck-generate), the warm fill,
// and the end reconcile so the cap can't drift between them.
export const MAX_GENERATED_IMAGES = 12;

export type GenImageRole = "hero" | "bg" | "accent";
export type GenImageAspect = "landscape" | "portrait" | "square";

export interface GenImageMarker {
  /** data-genid — unique within a deck; the key we fill `src` by. */
  genid: string;
  /** data-genimage — the textless prompt Claude authored. */
  prompt: string;
  /** data-genrole — defaults to "hero" when missing/invalid. */
  role: GenImageRole;
  /** Derived from the box's width/height (or legacy data-genaspect);
   *  defaults to "landscape" when the shape can't be determined. */
  aspect: GenImageAspect;
}

// Accept only safe genids. The genid flows into a Supabase storage path
// (`${projectId}/gen/${genid}.png`), so a value containing `/` or `..`
// (Claude is influenceable via the brief) could write outside the
// project's prefix in the shared bucket. Bound it to a filename-safe
// charset + length; anything else is skipped (the box stays a gradient).
const SAFE_GENID = /^[A-Za-z0-9._-]{1,64}$/;

const ROLES: ReadonlySet<string> = new Set<GenImageRole>([
  "hero",
  "bg",
  "accent",
]);
const ASPECTS: ReadonlySet<string> = new Set<GenImageAspect>([
  "landscape",
  "portrait",
  "square",
]);

// Yield [start, end) byte ranges of each `<img …>` opening tag, where
// `end` is just past the closing `>`. Quote-aware so a `>` inside an
// attribute value (e.g. a prompt) doesn't prematurely end the tag.
function* imgTagRanges(html: string): Generator<[number, number]> {
  const open = /<img\b/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html)) !== null) {
    const start = m.index;
    let i = start + m[0].length;
    let quote: string | null = null;
    for (; i < html.length; i++) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
    }
    const end = i < html.length ? i + 1 : html.length;
    yield [start, end];
    open.lastIndex = end;
  }
}

// Read one attribute's value from a single tag string. Handles both
// quote styles; returns null when the attribute is absent. (HTML
// attribute values can't contain an un-escaped matching quote — inner
// quotes arrive as entities — so `[^"]*` is exact.)
function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : (m[3] ?? null);
}

// Read a numeric px length for one CSS property out of an inline `style`
// string (e.g. "width: 800px"). Returns null when absent or not in px
// (%, vw, auto, calc()… can't be compared to a sibling px length).
function readPxLen(style: string, prop: string): number | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px`, "i"));
  return m ? parseFloat(m[1]) : null;
}

// Derive the closest gpt-image-2 aspect from the box's own width/height,
// so Claude lays the box out naturally and never has to declare an enum.
// Needs both lengths in px; a ±15% band around 1:1 reads as square.
// Returns null when the shape can't be determined (caller defaults it).
function deriveAspectFromStyle(tag: string): GenImageAspect | null {
  const style = readAttr(tag, "style");
  if (!style) return null;
  const w = readPxLen(style, "width");
  const h = readPxLen(style, "height");
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  const ratio = w / h;
  if (ratio >= 1.15) return "landscape";
  if (ratio <= 0.87) return "portrait";
  return "square";
}

const SRC_ATTR = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i;

// Decode the handful of HTML entities Claude may emit inside an
// attribute value so the prompt reaches gpt-image-2 as plain text.
// `&amp;` is decoded LAST so "&amp;lt;" doesn't collapse to "<".
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Escape a URL for safe embedding as a double-quoted attribute value.
function escapeAttrValue(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Find every reserved image box in one slide's HTML. Skips `<img>` tags
 * that aren't gen-boxes (no `data-genimage`), have an empty prompt, or
 * lack a `data-genid` (un-fillable). De-duplicates by genid (first wins).
 */
export function scanGenImages(html: string): GenImageMarker[] {
  const out: GenImageMarker[] = [];
  const seen = new Set<string>();
  for (const [start, end] of imgTagRanges(html)) {
    const tag = html.slice(start, end);
    const promptRaw = readAttr(tag, "data-genimage");
    if (promptRaw == null) continue; // not a gen-box
    const genid = readAttr(tag, "data-genid");
    if (!genid || seen.has(genid) || !SAFE_GENID.test(genid)) continue;
    const prompt = decodeEntities(promptRaw).trim();
    if (!prompt) continue;
    const roleRaw = readAttr(tag, "data-genrole");
    const aspectRaw = readAttr(tag, "data-genaspect");
    const role: GenImageRole =
      roleRaw && ROLES.has(roleRaw) ? (roleRaw as GenImageRole) : "hero";
    // Prefer an explicit data-genaspect (legacy decks still emit it), else
    // derive the shape from the box's own width/height, else default.
    const aspect: GenImageAspect =
      aspectRaw && ASPECTS.has(aspectRaw)
        ? (aspectRaw as GenImageAspect)
        : (deriveAspectFromStyle(tag) ?? "landscape");
    seen.add(genid);
    out.push({ genid, prompt, role, aspect });
  }
  return out;
}

/**
 * Inject (or replace) the `src` of the `<img>` whose `data-genid` matches
 * `genid`, returning the new HTML. If no matching box exists the HTML is
 * returned unchanged. Used server-side by the reconcile step and
 * client-side by the realtime swap.
 */
export function injectImgSrc(html: string, genid: string, url: string): string {
  const safeUrl = escapeAttrValue(url);
  for (const [start, end] of imgTagRanges(html)) {
    const tag = html.slice(start, end);
    if (readAttr(tag, "data-genid") !== genid) continue;
    const newTag = SRC_ATTR.test(tag)
      ? tag.replace(SRC_ATTR, () => `src="${safeUrl}"`)
      : tag.replace(/^<img\b/i, () => `<img src="${safeUrl}"`);
    return html.slice(0, start) + newTag + html.slice(end);
  }
  return html;
}
