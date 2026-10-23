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

export type BrokenSlide = {
  slide: number; // 1-based
  kept: number; // share of the source slide's own words found on its slide
  missingPictures: string[]; // carried content pictures not on its slide
  // Pictures with words drawn narrower than they can be read: id -> floor px.
  smallPictures?: { id: string; min: number }[];
};

// A drawn width this far under the floor still passes (rounding, a gap).
const SMALL_SLACK = 0.9;

/** The inline px width of the <img> carrying data-asset="id", or null. */
function drawnWidth(html: string, id: string): number | null {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!new RegExp(`\\sdata-asset\\s*=\\s*["']${id}["']`, "i").test(m[0])) continue;
    const w = m[0].match(/(?:^|[;"'\s])width\s*:\s*([\d.]+)px/i);
    return w ? Number(w[1]) : null;
  }
  return null;
}

/**
 * A free redesign is one slide per source slide, so slide N is checked against
 * source slide N alone: under KEPT_BELOW of the source slide's own words (4+
 * letters; words on 3+ source slides are template chrome and do not count),
 * or any of its content pictures missing, is a broken slide. A slide the deck
 * does not have at all counts as broken with nothing kept.
 */
export function brokenReworkSlides(
  sourceTexts: readonly string[],
  // 0-based source slide -> carried content picture ids that belong on it
  picturesBySlide: ReadonlyMap<number, readonly string[]>,
  slideHtml: readonly string[],
  checkCount: number,
  // Pictures with words: assetId -> smallest readable width (px).
  readable?: ReadonlyMap<string, number>,
): BrokenSlide[] {
  const perSource = sourceTexts.map((t) => new Set(words(t).filter((w) => w.length >= 4)));
  const seenOn = new Map<string, number>();
  for (const set of perSource) for (const w of set) seenOn.set(w, (seenOn.get(w) ?? 0) + 1);
  const out: BrokenSlide[] = [];
  for (let i = 0; i < checkCount; i++) {
    const html = slideHtml[i];
    const pictures = picturesBySlide.get(i) ?? [];
    if (html === undefined) {
      out.push({ slide: i + 1, kept: 0, missingPictures: [...pictures] });
      continue;
    }
    const own = [...(perSource[i] ?? [])].filter((w) => (seenOn.get(w) ?? 0) < 3);
    const have = new Set(words(htmlText(html)));
    const kept = own.length < MIN_WORDS ? 1 : own.filter((w) => have.has(w)).length / own.length;
    const missingPictures = pictures.filter((id) => !html.includes(id));
    const smallPictures = pictures.flatMap((id) => {
      const min = readable?.get(id);
      const w = min ? drawnWidth(html, id) : null;
      return min && w !== null && w < min * SMALL_SLACK ? [{ id, min }] : [];
    });
    if (kept < KEPT_BELOW || missingPictures.length > 0 || smallPictures.length > 0) {
      out.push({ slide: i + 1, kept: Math.round(kept * 100) / 100, missingPictures, smallPictures });
    }
  }
  return out;
}

/**
 * The follow-up turn that asks the model to re-emit only the broken slides,
 * in place (data-revises), with each one's full source text and the pictures
 * it must place. `pictureBlocks` holds the ORIGINAL PICTURES block per slide.
 */
export function reworkRepairMessage(
  broken: readonly BrokenSlide[],
  sourceTexts: readonly string[],
  pictureBlocks: ReadonlyMap<number, string>,
): string {
  const parts = broken.map((b) => {
    const text = (sourceTexts[b.slide - 1] ?? "").trim() || "(no text on this source slide)";
    const why = [
      b.kept < 1 ? `only ${Math.round(b.kept * 100)}% of its words made it` : "",
      b.missingPictures.length > 0 ? `content pictures left out: ${b.missingPictures.join(", ")}` : "",
      (b.smallPictures ?? []).length > 0
        ? `pictures with words too small to read: ${b.smallPictures!.map((x) => `${x.id} (at least ${x.min}px wide)`).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    return `── SLIDE ${b.slide}: ${why} ──\nSource slide ${b.slide} text (every fact, term, exercise item and number must appear):\n${text}\n${pictureBlocks.get(b.slide - 1) ?? ""}`;
  });
  return `REPAIR PASS. Your deck above lost content or readability on ${broken.length === 1 ? "one slide" : `${broken.length} slides`}: slide N must carry the content of source slide N. Re-emit ONLY the slides listed below, each as ONE complete corrected <section> with the same data-label, data-role and background attributes as your version of that slide, PLUS data-revises="N" (N = the slide number). Keep the deck's design system and look; rebuild the slide so all of its source content and every listed picture (tag unchanged) fit. No <style> block, no prose, no fences: the first character of your reply is the < of the first section.

${parts.join("\n\n")}`;
}
