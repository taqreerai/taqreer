// Deterministic LTR isolation for Latin/number runs inside RTL slide HTML.
//
// The frame prompt asks the model to wrap inline Latin runs in <span dir="ltr">,
// but models skip it (prod 2026-10: 7% of Sonnet's Latin runs in Arabic decks
// were isolated; a controlled run flipped "98.5%" to "%98.5" and "1-2%" to
// "%2-1"). Under the Unicode bidi algorithm an unisolated run containing a
// percent sign, a hyphenated range, a slash or a decimal point reorders against
// the RTL paragraph, so this enforces the rule at the assembly chokepoint
// instead of trusting the model (same philosophy as latinizeDigits).
//
// Rules:
//  - TEXT NODES ONLY; tags, attributes, <style>, <script>, <svg>, <textarea>,
//    <title> and comments are never touched.
//  - Text already under dir="ltr", <bdi>, class "ltr", unicode-bidi or
//    direction:ltr is left alone, so the pass is idempotent and never nests.
//  - A run is wrapped when it holds a Latin letter, a percent sign, or digits
//    joined by a connector (100-200, 3.3 - 4.2, 1,000,000, 01 / 03). A bare
//    integer ("2026") is left alone: digits are not the failure.
//  - Entities (&amp; &nbsp; ...) break runs and are copied through verbatim.

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
// Content of these is not slide text; skip it whole.
const RAW_TAGS = new Set(["style", "script", "svg", "textarea", "title"]);

const TAG_RE = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ENTITY_SPLIT = /(&#?[A-Za-z0-9]+;)/;

// One LTR run: optional leading symbol, an alphanumeric word, then any number
// of (connector or space) + alphanumeric word, optional trailing percent.
// Letters are ALL of Latin script, accents included, and an apostrophe between
// letters stays in the word (l’entreprise). Basic [A-Za-z] split "Présentation"
// into Pr|é|sentation and the RTL paragraph reordered the pieces (prod
// 2026-10-22, a French deck: "sentationéPr").
const LATIN = "\\p{Script=Latin}";
const WORD = `[${LATIN}0-9][${LATIN}\\p{M}0-9²³°µ]*(?:['’][${LATIN}][${LATIN}\\p{M}0-9]*)*`;
const CONNECTOR = "(?:\\s?[-–−/.,:+&=×÷*<>≈≤≥]\\s?|\\s)";
const RUN_RE = new RegExp(
  `(?:[~≈<>≤≥±√]\\s?)?${WORD}(?:${CONNECTOR}${WORD})*%?`,
  "gu",
);
const HAS_LATIN = /\p{Script=Latin}/u;
const HAS_LATIN_OR_DIGIT = /[\p{Script=Latin}0-9]/u;

function worthWrapping(run: string): boolean {
  if (HAS_LATIN.test(run)) return true;
  if (run.includes("%")) return true;
  // digits only: wrap when a connector joins them (a bare integer is fine)
  return /\d\s?[-–−/.,:+=×÷*]\s?\d/.test(run);
}

function wrapText(text: string): string {
  return text
    .split(ENTITY_SPLIT)
    .map((part, i) => {
      if (i % 2 === 1) return part; // an entity
      return part.replace(RUN_RE, (run) => {
        // keep surrounding spaces outside the span (the run never starts/ends with one)
        return worthWrapping(run) ? `<span dir="ltr">${run}</span>` : run;
      });
    })
    .join("");
}

function openIsIsolating(tag: string, name: string): boolean {
  if (name === "bdi") return true;
  if (/\bdir\s*=\s*["']?ltr\b/i.test(tag)) return true;
  const cls = /\bclass\s*=\s*"([^"]*)"|\bclass\s*=\s*'([^']*)'/i.exec(tag);
  if (cls && /(?:^|\s)ltr(?:\s|$)/.test(cls[1] ?? cls[2] ?? "")) return true;
  const style = /\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/i.exec(tag);
  const s = (style?.[1] ?? style?.[2] ?? "").toLowerCase();
  return /unicode-bidi\s*:\s*(?:isolate|bidi-override|isolate-override)/.test(s) ||
    /direction\s*:\s*ltr/.test(s);
}

/**
 * Wrap Latin/number runs in <span dir="ltr"> inside the text nodes of an RTL
 * well. Only nodes that are not already isolated are touched. Safe to run
 * repeatedly on its own output.
 */
export function isolateLatinRuns(html: string): string {
  let out = "";
  let last = 0;
  // stack of { name, iso } for open elements; rawName = inside a raw-text element
  const stack: { name: string; iso: boolean }[] = [];
  let rawName: string | null = null;
  let isoDepth = 0;

  const flushText = (text: string) => {
    if (!text) return;
    if (rawName || isoDepth > 0 || !HAS_LATIN_OR_DIGIT.test(text)) {
      out += text;
      return;
    }
    out += wrapText(text);
  };

  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    flushText(html.slice(last, m.index));
    const tag = m[0];
    out += tag;
    last = m.index + tag.length;
    if (tag.startsWith("<!--")) continue;

    const closing = /^<\//.test(tag);
    const nameMatch = /^<\/?\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(tag);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();

    if (rawName) {
      if (closing && name === rawName) rawName = null;
      continue;
    }
    if (closing) {
      // pop to the nearest matching open element
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          for (let j = stack.length - 1; j >= i; j--) {
            if (stack[j].iso) isoDepth--;
          }
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*>$/.test(tag)) continue;
    if (RAW_TAGS.has(name)) {
      rawName = name;
      continue;
    }
    const iso = openIsIsolating(tag, name);
    stack.push({ name, iso });
    if (iso) isoDepth++;
  }
  flushText(html.slice(last));
  return out;
}
