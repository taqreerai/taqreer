// Scope author-written CSS under a single class so its rules can ONLY affect
// that subtree (one slide), never leak into the app.
//
// Why: in the Claude-authored model the model writes its OWN `<style>` design
// system, and SlideRenderer injects slide HTML into a plain `<div>` in the MAIN
// app document (no iframe / shadow DOM). An unscoped `:root` / `section` / `h1`
// rule from the model would restyle Taqreer's own UI. We prefix every selector
// with a scope class (`.tq-canvas`, stamped on each slide's `<section>`), so the
// model's CSS is contained to the slide.
//
// Handles: comma selector lists; descendant/child/sibling combinators; the slide
// ROOT selectors (`:root` / `html` / `body` / `section` → become the scope class
// itself); `*`; nested conditional at-rules (`@media` / `@supports` /
// `@container` — recursed); and leaves `@keyframes` / `@font-face` / `@page`
// untouched (no element selectors to scope). `@import` is DROPPED (a model
// `@import url(evil)` could pull arbitrary remote CSS). String- and
// comment-aware brace/paren matching so commas/braces inside `:is(.a,.b)`,
// `[attr="{"]`, or `url(...)` don't desync the parser.

const ROOT_SELECTOR = /^(?::root|html|body|section)\b/;

// Split a string on a top-level separator char, ignoring the separator when it
// sits inside (), [], {}, or a string. Used for comma-splitting selector lists.
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let str: '"' | "'" | null = null;
  let buf = "";
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (str) {
      buf += c;
      if (c === "\\") {
        buf += input[++i] ?? "";
      } else if (c === str) {
        str = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      buf += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length) out.push(buf);
  return out;
}

// Strip CSS comments (string-aware so a `/*` inside a string value survives).
function stripComments(css: string): string {
  let out = "";
  let str: '"' | "'" | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (str) {
      out += c;
      if (c === "\\") out += css[++i] ?? "";
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      out += c;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i += 1; // loop ++ skips the trailing '/'
      continue;
    }
    out += c;
  }
  return out;
}

type Node =
  | { kind: "rule"; prelude: string; block: string }
  | { kind: "at-block"; prelude: string; block: string }
  | { kind: "at-statement"; text: string };

// Tokenize a stylesheet into its top-level nodes (string/brace/paren aware).
function tokenize(css: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  const n = css.length;
  let str: '"' | "'" | null = null;
  let prelude = "";
  while (i < n) {
    const c = css[i];
    if (str) {
      prelude += c;
      if (c === "\\") prelude += css[++i] ?? "";
      else if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      prelude += c;
      i++;
      continue;
    }
    if (c === ";" && prelude.trimStart().startsWith("@")) {
      // at-statement with no block (e.g. @import, @charset)
      nodes.push({ kind: "at-statement", text: prelude.trim() + ";" });
      prelude = "";
      i++;
      continue;
    }
    if (c === "{") {
      // capture the brace-matched block
      let depth = 1;
      let block = "";
      let bstr: '"' | "'" | null = null;
      i++;
      while (i < n && depth > 0) {
        const d = css[i];
        if (bstr) {
          block += d;
          if (d === "\\") block += css[++i] ?? "";
          else if (d === bstr) bstr = null;
          i++;
          continue;
        }
        if (d === '"' || d === "'") {
          bstr = d;
          block += d;
          i++;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        block += d;
        i++;
      }
      const pre = prelude.trim();
      if (pre.startsWith("@")) nodes.push({ kind: "at-block", prelude: pre, block });
      else nodes.push({ kind: "rule", prelude: pre, block });
      prelude = "";
      continue;
    }
    prelude += c;
    i++;
  }
  return nodes;
}

// Split a selector into [firstCompound, rest] at the first top-level combinator
// (descendant space, `>`, `+`, `~`), ignoring combinators inside () or [].
// `.a.b > .c` → [".a.b", " > .c"]; `.slide` → [".slide", ""].
function splitFirstCompound(sel: string): [string, string] {
  let depth = 0;
  let str: '"' | "'" | null = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (
      depth === 0 &&
      (c === " " || c === "\t" || c === "\n" || c === ">" || c === "+" || c === "~")
    ) {
      return [sel.slice(0, i), sel.slice(i)];
    }
  }
  return [sel, ""];
}

// Rewrite `#ident` to `[id="ident"]` (identical targeting, class-level
// specificity). Without this, an authored `#hero{position:absolute;…}` scopes
// to `.tq-canvas#hero` at (1,1,0) and outranks every class-based enforcement
// (audit 2026-07-08). String-aware so `[href="#x"]` attr values survive.
function neutralizeIdSpecificity(sel: string): string {
  let out = "";
  let str: '"' | "'" | null = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (str) {
      out += c;
      if (c === "\\") out += sel[++i] ?? "";
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      out += c;
      continue;
    }
    if (c === "#") {
      const m = /^[A-Za-z_-][\w-]*/.exec(sel.slice(i + 1));
      if (m) {
        out += `[id="${m[0]}"]`;
        i += m[0].length;
        continue;
      }
    }
    out += c;
  }
  return out;
}

// One scoped arm: the selector plus whether its SUBJECT is the scope root
// itself (a compound on the `<section>`, e.g. `.tq-canvas.content`) rather
// than a descendant. Root-subject arms get the geometry-filtered declaration
// block below — the confirmed `.tq-canvas.content{position:absolute;inset:…}`
// bug displaced a live deck's whole canvas through exactly this arm.
type ScopedArm = { sel: string; rootSubject: boolean };

function scopeOneSelector(sel: string, scope: string): ScopedArm[] {
  const s = neutralizeIdSpecificity(sel.trim());
  if (!s) return [{ sel: scope, rootSubject: true }];
  // `&` (CSS nesting) — leave to the parent context; rare from the model.
  if (s.startsWith("&")) return [{ sel: s, rootSubject: false }];
  const m = s.match(ROOT_SELECTOR);
  if (m) {
    // `section.cover` → `.tq-canvas.cover`; `section .x` → `.tq-canvas .x`;
    // `section` → `.tq-canvas`; `:root` → `.tq-canvas`.
    const remainder = s.slice(m[0].length);
    const [compound, rest] = splitFirstCompound(remainder);
    void compound;
    return [{ sel: scope + remainder, rootSubject: rest.trim() === "" }];
  }
  // A class / id / attr / pseudo-leading FIRST compound can be on the scope ROOT
  // itself — the model styles the slide root via a class on the `<section>`
  // (e.g. `.slide{background:…}` with `<section class="slide">`). The section is
  // `.tq-canvas.slide`, so a descendant-only `.tq-canvas .slide` would MISS it
  // (the white-on-white bug). Match BOTH the root (compound) and descendants.
  const [first, rest] = splitFirstCompound(s);
  if (/^[.[:]/.test(first) || first.startsWith("[id=")) {
    return [
      // Root arm's subject is the section only when there's no combinator.
      { sel: `${scope}${first}${rest}`, rootSubject: rest.trim() === "" },
      { sel: `${scope} ${first}${rest}`, rootSubject: false },
    ];
  }
  // Tag- / `*`-leading → only ever a descendant of the scope root.
  return [{ sel: `${scope} ${s}`, rootSubject: false }];
}

// Declarations that must never apply to the slide ROOT via a scoped compound:
// canvas geometry (the enforced frame owns it) and whole-slide hiding. Kept
// off the root ARM only — the descendant arm keeps the full block, so inner
// layout classes keep working exactly as authored.
const ROOT_UNSAFE_DECL =
  /^\s*(?:position|inset(?:-[a-z]+)?|top|right|bottom|left|width|height|min-width|min-height|max-width|max-height|margin(?:-[a-z-]+)?|transform|translate|rotate|scale|zoom|float)\s*:/i;
const ROOT_HIDING_DECL =
  /^\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0*)?\s*(?:!|;|$)|content-visibility\s*:\s*hidden)/i;

function filterRootBlock(block: string): string {
  return splitTopLevel(block, ";")
    .filter(
      (decl) =>
        decl.trim() !== "" &&
        !ROOT_UNSAFE_DECL.test(decl) &&
        !ROOT_HIDING_DECL.test(decl),
    )
    .join(";");
}

// `position:fixed` has no legitimate use inside a fixed-size slide, and in the
// Puppeteer print path a fixed element escapes the slide clip and repeats on
// every PDF page. Rewrite to absolute — what the author meant on a canvas.
function neutralizeFixedPosition(block: string): string {
  return block.replace(/(^|[;{\s])position\s*:\s*fixed\b/gi, "$1position:absolute");
}

// Emit the rule(s) for one prelude+block: descendant arms keep the full block;
// root-subject arms get the geometry/hiding-filtered block (dropped entirely
// when nothing survives the filter).
function emitScopedRule(prelude: string, block: string, scope: string): string[] {
  const arms = splitTopLevel(prelude, ",").flatMap((sel) =>
    scopeOneSelector(sel, scope),
  );
  const safeBlock = neutralizeFixedPosition(block);
  const rootArms = arms.filter((a) => a.rootSubject).map((a) => a.sel);
  const descArms = arms.filter((a) => !a.rootSubject).map((a) => a.sel);
  const needsSplit =
    rootArms.length > 0 &&
    splitTopLevel(safeBlock, ";").some(
      (d) => ROOT_UNSAFE_DECL.test(d) || ROOT_HIDING_DECL.test(d),
    );
  if (!needsSplit) {
    return [`${[...rootArms, ...descArms].join(", ")}{${safeBlock}}`];
  }
  const out: string[] = [];
  const rootBlock = filterRootBlock(safeBlock);
  if (rootBlock.trim()) out.push(`${rootArms.join(", ")}{${rootBlock}}`);
  if (descArms.length) out.push(`${descArms.join(", ")}{${safeBlock}}`);
  return out;
}

const AT_NAME = /^@([a-zA-Z-]+)/;

export function scopeDeckCss(css: string, scope = ".tq-canvas"): string {
  const nodes = tokenize(stripComments(css));
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "rule") {
      out.push(...emitScopedRule(node.prelude, node.block, scope));
    } else if (node.kind === "at-statement") {
      // Drop @import (remote-CSS exfil / injection); keep other statements.
      if (/^@import\b/i.test(node.text)) continue;
      out.push(node.text);
    } else {
      const name = node.prelude.match(AT_NAME)?.[1]?.toLowerCase() ?? "";
      if (
        name === "media" ||
        name === "supports" ||
        name === "container" ||
        name === "layer"
      ) {
        // Wraps normal style rules: recurse so the INNER selectors get scoped.
        // `@layer name { body{…} }` would otherwise leak its selectors to the
        // app (the block form; the `@layer a, b;` statement form has no block
        // and is handled as an at-statement above).
        out.push(`${node.prelude}{${scopeDeckCss(node.block, scope)}}`);
      } else {
        // @keyframes / @font-face / @page / unknown — no element selectors to
        // scope; leave the block verbatim.
        out.push(`${node.prelude}{${node.block}}`);
      }
    }
  }
  return out.join("\n");
}

// Inverse of scopeDeckCss, sufficient for a re-scope round-trip: strip the
// `scope` prefix each selector carries, so the CSS can be fed back through
// scopeDeckCss canonically. Used to normalize PARTIAL-REGEN output: that path
// trusts the model to hand-prefix its selectors, and the model sometimes emits
// only the compound form (`.tq-canvas.uc .uc-ic`) and drops the descendant form
// (`.tq-canvas .uc .uc-ic`) — leaving a rule that matches nothing (icons fall to
// the browser default ~300px = huge). `scopeDeckCss(unscopeDeckCss(css))` rebuilds
// BOTH forms. A selector the model forgot to scope is left as-is, so re-scoping
// then adds the prefix it was missing.
export function unscopeDeckCss(css: string, scope = ".tq-canvas"): string {
  const esc = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = new RegExp(`^${esc}`);
  const stripOne = (sel: string): string => {
    const s = sel.trim();
    if (!lead.test(s)) return s; // unscoped already — leave for scopeDeckCss
    const rest = s.replace(lead, "").replace(/^\s+/, "");
    return rest === "" ? ":root" : rest; // bare scope was a root selector
  };
  const nodes = tokenize(stripComments(css));
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "rule") {
      const sels = splitTopLevel(node.prelude, ",").map(stripOne);
      out.push(`${[...new Set(sels)].join(", ")}{${node.block}}`);
    } else if (node.kind === "at-statement") {
      out.push(node.text);
    } else {
      const name = node.prelude.match(AT_NAME)?.[1]?.toLowerCase() ?? "";
      if (
        name === "media" ||
        name === "supports" ||
        name === "container" ||
        name === "layer"
      ) {
        out.push(`${node.prelude}{${unscopeDeckCss(node.block, scope)}}`);
      } else {
        out.push(`${node.prelude}{${node.block}}`);
      }
    }
  }
  return out.join("\n");
}
