// One picture medium per deck (owner, 2026-10-26). The prompt asks the model to
// keep a deck all-photographic or all-illustrated, and it still wrote a photo
// cover over cartoon replacements (prod cmvpm5l8e001nac6dsc302f2l). Before the
// images are generated, every image box's prompt is read as illustration, photo
// or unknown; the majority wins and every other box is told that medium. A
// stock box (a Pexels photo) in an illustrated deck becomes a generated
// illustration, except for subjects that are never generated (flags).

import { mustNotGenerate } from "@/lib/images/never-generate";

export type ImageMedium = "illustration" | "photo";

const ILLUSTRATION_WORDS =
  /\b(illustrat\w*|cartoon\w*|flat|vector|drawing|drawn|sketch\w*|3d|isometric|clay|claymation|watercolou?r|painted|painting|doodle\w*|comic|anime|storybook)\b/gi;
const PHOTO_WORDS = /\b(photo\w*|realistic|photoreal\w*|cinematic|dslr|35mm|bokeh)\b/gi;

const SUFFIX: Record<ImageMedium, string> = {
  illustration:
    "Rendered as a flat, colourful illustration in the same style as the deck's other pictures, not a photograph.",
  photo: "Rendered as a natural, realistic photograph like the deck's other pictures, not an illustration or cartoon.",
};

const BOX_TAG = /<img\b[^>]*\bdata-genimage="[^"]*"[^>]*>/gi;

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function encode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function boxes(html: string): { tag: string; prompt: string; stock: boolean }[] {
  return [...html.matchAll(BOX_TAG)].map((m) => ({
    tag: m[0],
    prompt: decode(/\bdata-genimage="([^"]*)"/i.exec(m[0])?.[1] ?? ""),
    stock: /\bdata-gensource="stock"/i.test(m[0]),
  }));
}

/** The medium one prompt asks for, or null when it does not say. A stock box is a photo. */
export function promptMedium(prompt: string, stock = false): ImageMedium | null {
  if (stock) return "photo";
  const illus = (prompt.match(ILLUSTRATION_WORDS) ?? []).length;
  const photo = (prompt.match(PHOTO_WORDS) ?? []).length;
  if (illus === photo) return null;
  return illus > photo ? "illustration" : "photo";
}

/** The deck's medium: the majority of the boxes that name one; null on a tie or none. */
export function deckMedium(htmls: readonly string[]): ImageMedium | null {
  let illus = 0;
  let photo = 0;
  for (const html of htmls) {
    for (const b of boxes(html)) {
      const m = promptMedium(b.prompt, b.stock);
      if (m === "illustration") illus++;
      else if (m === "photo") photo++;
    }
  }
  if (illus === photo) return null;
  return illus > photo ? "illustration" : "photo";
}

/**
 * The deck's medium as decided WHILE it streams (owner, 2026-10-28): the
 * medium of the first box, in slide order, that names one, and that slide's
 * index. Images are generated as each slide closes; a majority known only at
 * the end rewrote prompts after their images were paid for, and the changed
 * prompt was generated again (1 to 3 wasted images per deck). Slides from
 * that index on follow the medium as they stream; the end-of-deck pass
 * repeats the same rule, so it changes nothing that was already generated.
 */
export function firstMedium(htmls: readonly string[]): { medium: ImageMedium; index: number } | null {
  for (let i = 0; i < htmls.length; i++) {
    for (const b of boxes(htmls[i])) {
      const m = promptMedium(b.prompt, b.stock);
      if (m) return { medium: m, index: i };
    }
  }
  return null;
}

/** Rewrite every box that is not already in `medium` so it is. Pure. */
export function applyImageMedium(html: string, medium: ImageMedium): string {
  return html.replace(BOX_TAG, (tag) => {
    const prompt = decode(/\bdata-genimage="([^"]*)"/i.exec(tag)?.[1] ?? "");
    const stock = /\bdata-gensource="stock"/i.test(tag);
    if (!prompt || promptMedium(prompt, stock) === medium) return tag;
    // A stock box only stays one in a photographic deck; a never-generated
    // subject (a flag) keeps its real photo whatever the deck's medium.
    if (stock && (medium === "photo" || mustNotGenerate(prompt))) return tag;
    const other = medium === "illustration" ? PHOTO_WORDS : ILLUSTRATION_WORDS;
    const cleaned = prompt.replace(other, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
    const next = `${cleaned.replace(/[.,;:\s]+$/, "")}. ${SUFFIX[medium]}`;
    return tag
      .replace(/\s+data-gensource="stock"/i, "")
      .replace(/\bdata-genimage="[^"]*"/i, `data-genimage="${encode(next)}"`);
  });
}
