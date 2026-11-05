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
//  - Entities (&nbsp; ...) break runs and are copied through verbatim, except
//    &amp;: "R&amp;D" is one run, or the paragraph flips it to "D&R". The same
//    goes for "|" (prod 2026-11-05 showed "UI|UX" as "UX|UI").
//
// ltrLatinBlocks handles the other half: a whole block in English keeps LTR
// layout in an Arabic deck instead of only its word order.

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
// Stands in for &amp; while the runs are matched: the regex must not read the
// entity's letters as a word. Private-use, so it never occurs in slide text.
const AMP_MARK = "\uE000";
const CONNECTOR = `(?:\\s?[-–−/.,:+&|${AMP_MARK}=×÷*<>≈≤≥]\\s?|\\s)`;
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
    .replaceAll("&amp;", AMP_MARK)
    .split(ENTITY_SPLIT)
    .map((part, i) => {
      if (i % 2 === 1) return part; // an entity
      return part.replace(RUN_RE, (run) => {
        // keep surrounding spaces outside the span (the run never starts/ends with one)
        return worthWrapping(run) ? `<span dir="ltr">${run}</span>` : run;
      });
    })
    .join("")
    .replaceAll(AMP_MARK, "&amp;");
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

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "code", "em", "i", "mark", "small", "span",
  "strong", "sub", "sup", "u",
]);
const ARABIC_LETTER = /\p{Script=Arabic}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

type Block = {
  name: string;
  start: number;
  end: number;
  parent: Block | null;
  kids: Block[];
  latin: number;
  arabic: number;
};

function countLetters(text: string, node: Block): void {
  const words = text.replace(/&#?[A-Za-z0-9]+;/g, " ");
  const latin = words.match(LATIN_LETTER)?.length ?? 0;
  const arabic = words.match(ARABIC_LETTER)?.length ?? 0;
  for (let n: Block | null = node; n; n = n.parent) {
    n.latin += latin;
    n.arabic += arabic;
  }
}

function readBlocks(html: string): Block {
  const root: Block = { name: "", start: 0, end: 0, parent: null, kids: [], latin: 0, arabic: 0 };
  let current = root;
  let rawName: string | null = null;
  let last = 0;
  let m: RegExpExecArray | null;
  const tags = new RegExp(TAG_RE);
  while ((m = tags.exec(html)) !== null) {
    if (!rawName) countLetters(html.slice(last, m.index), current);
    const tag = m[0];
    last = m.index + tag.length;
    if (tag.startsWith("<!--")) continue;
    const closing = /^<\//.test(tag);
    const name = /^<\/?\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(tag)?.[1].toLowerCase();
    if (!name) continue;
    if (rawName) {
      if (closing && name === rawName) rawName = null;
      continue;
    }
    if (closing) {
      for (let n: Block | null = current; n?.parent; n = n.parent) {
        if (n.name === name) {
          current = n.parent;
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
    const node: Block = { name, start: m.index, end: last, parent: current, kids: [], latin: 0, arabic: 0 };
    current.kids.push(node);
    current = node;
  }
  if (!rawName) countLetters(html.slice(last), current);
  return root;
}

const hasText = (n: Block) => n.latin + n.arabic > 0;
const isBlock = (n: Block) => !INLINE_TAGS.has(n.name);
const isEnglish = (n: Block) => n.latin >= 2 && n.arabic === 0;

/** Several lines of its own, unlike one label or heading. */
function holdsSeveralLines(n: Block): boolean {
  return n.kids.filter((k) => isBlock(k) && hasText(k)).length >= 2;
}

/**
 * Give every English block in an RTL well dir="ltr", so it reads and aligns as
 * English, as in the source. A word-level span cannot do that: it fixes word
 * order and leaves the block on the right.
 *
 * Only blocks that stand on their own qualify: the slide's top-level blocks and
 * English cards or lists. One English heading or label inside an Arabic card
 * stays with that card, or it would part from the text it belongs to.
 *
 * Text-align set in the slide's <style> cannot be seen from here; the prompt
 * covers that case. A block the model marked dir="rtl" is left alone.
 */
export function ltrLatinBlocks(html: string): string {
  const root = readBlocks(html);
  // Past the wrappers (the well root) that hold all of the slide's text.
  let top = root;
  for (;;) {
    const withText = top.kids.filter(hasText);
    if (withText.length !== 1 || isEnglish(withText[0])) break;
    top = withText[0];
  }

  const edits: { node: Block; addDir: boolean }[] = [];
  const claim = (n: Block, addDir: boolean) => {
    edits.push({ node: n, addDir });
    for (const kid of n.kids) claim(kid, false);
  };
  const visit = (parent: Block) => {
    for (const kid of parent.kids) {
      if (!isBlock(kid) || kid.latin === 0) continue;
      if (kid.arabic > 0) visit(kid);
      else if (isEnglish(kid) && (parent === top || holdsSeveralLines(kid))) {
        const tag = html.slice(kid.start, kid.end);
        if (/\sdir\s*=\s*["']?rtl\b/i.test(tag)) continue;
        claim(kid, !/\sdir\s*=/i.test(tag));
      }
    }
  };
  visit(top);

  let out = html;
  for (const { node, addDir } of edits.sort((a, b) => b.node.start - a.node.start)) {
    let tag = out.slice(node.start, node.end).replace(/text-align\s*:\s*right/gi, "text-align:left");
    if (addDir) tag = tag.replace(/^<[A-Za-z][A-Za-z0-9:-]*/, '$& dir="ltr"');
    out = out.slice(0, node.start) + tag + out.slice(node.end);
  }
  return out;
}
