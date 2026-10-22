// Free-redesign (rework) decks: did the source's content survive?
//
// The rework prompt lets the model condense and rephrase, so words cannot be
// matched one to one, but some things can: numbers (a page number, a year, an
// exercise number), each source slide's longest words (a whole slide left out
// shows up as none of them anywhere; local test 2026-10-22 lost a slide after
// splitting another under the slide cap), and the carried pictures that are
// content. Deterministic and cheap; the caller logs what is missing.

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

function latinDigits(s: string): string {
  return s.replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  // Two digits or more: single digits are list markers and step numbers that
  // a redesign rightly turns into its own numbering.
  for (const m of latinDigits(text).matchAll(/\d[\d.,]*\d/g)) out.add(m[0].replace(/[.,]+$/, ""));
  return out;
}

function htmlText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

/** Numbers in the source text that appear nowhere in the generated slides. */
export function missingSourceNumbers(sourceTexts: readonly string[], slideHtml: readonly string[]): string[] {
  const have = numbersIn(slideHtml.map(htmlText).join(" "));
  const missing: string[] = [];
  for (const n of numbersIn(sourceTexts.join(" "))) if (!have.has(n)) missing.push(n);
  return missing;
}

// Arabic diacritics and tatweel do not change a word; a rephrase may drop them.
const MARKS = /[\u064B-\u0652\u0670\u0640]/g;

function words(text: string): string[] {
  return latinDigits(text).replace(MARKS, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Under this share of a source slide's words (4+ letters) anywhere in the
// deck, the slide was left out: local runs kept 84-100% on every slide that
// made it and 41% on the one that was dropped (its common words, "the
// Kingdom", sat on other slides).
const KEPT_BELOW = 0.6;
const MIN_WORDS = 5;

/** Source slides (1-based) that were left out, with the share of their words found. */
export function missingSourceSlides(
  sourceTexts: readonly string[],
  slideHtml: readonly string[],
): { slide: number; kept: number }[] {
  const have = new Set(words(slideHtml.map(htmlText).join(" ")));
  const out: { slide: number; kept: number }[] = [];
  sourceTexts.forEach((text, i) => {
    const own = [...new Set(words(text).filter((w) => w.length >= 4))];
    if (own.length < MIN_WORDS) return;
    const kept = own.filter((w) => have.has(w)).length / own.length;
    if (kept < KEPT_BELOW) out.push({ slide: i + 1, kept: Math.round(kept * 100) / 100 });
  });
  return out;
}

/** Carried asset ids that should be on a slide but appear nowhere. */
export function missingCarriedPictures(assetIds: readonly string[], slideHtml: readonly string[]): string[] {
  const all = slideHtml.join(" ");
  return assetIds.filter((id) => !all.includes(id));
}
