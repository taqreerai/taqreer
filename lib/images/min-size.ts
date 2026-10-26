// Replace-all / redraw decks (owner, 2026-10-26): a generated picture that
// replaces the user's clip-art is a real illustration, never icon-sized. The
// prompt says so and the model still copied a 260px clip-art size (prod
// cmvpm5l8e001nac6dsc302f2l). In-well image boxes with an explicit px size
// under SMALL_LONG on their longer side are scaled up to MIN_LONG, ratio kept.
// Background and panel images (sized 100%) are untouched. The bake's overflow
// backstop still shrinks pictures on a slide that no longer fits.

const MIN_LONG = 480;
const SMALL_LONG = 400;

const BOX_TAG = /<img\b[^>]*\bdata-genimage="[^"]*"[^>]*>/gi;

export function enlargeSmallGenImages(html: string): string {
  return html.replace(BOX_TAG, (tag) => {
    const style = /\bstyle="([^"]*)"/i.exec(tag)?.[1];
    if (!style) return tag;
    const w = /(?:^|;)\s*width\s*:\s*([\d.]+)px/i.exec(style);
    const h = /(?:^|;)\s*height\s*:\s*([\d.]+)px/i.exec(style);
    if (!w || !h) return tag;
    const width = Number(w[1]);
    const height = Number(h[1]);
    const long = Math.max(width, height);
    if (!(long > 0) || long >= SMALL_LONG) return tag;
    const k = MIN_LONG / long;
    const next = style
      .replace(/((?:^|;)\s*width\s*:\s*)[\d.]+px/i, `$1${Math.round(width * k)}px`)
      .replace(/((?:^|;)\s*height\s*:\s*)[\d.]+px/i, `$1${Math.round(height * k)}px`);
    return tag.replace(/\bstyle="[^"]*"/i, `style="${next}"`);
  });
}
