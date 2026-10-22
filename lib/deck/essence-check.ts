// Free-redesign (rework) decks: did every number in the source survive?
//
// The rework prompt lets the model condense and rephrase, so words cannot be
// matched one to one, but numbers can: a page number, a year, a quantity or
// an exercise number that vanished means content was lost. Deterministic and
// cheap; the caller logs what is missing (tuning signal for the rule).

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
