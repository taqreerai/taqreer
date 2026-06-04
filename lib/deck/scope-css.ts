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

function scopeOneSelector(sel: string, scope: string): string {
  const s = sel.trim();
  if (!s) return scope;
  // `&` (CSS nesting) — leave to the parent context; rare from the model.
  if (s.startsWith("&")) return s;
  const m = s.match(ROOT_SELECTOR);
  if (m) {
    // `section.cover` → `.tq-canvas.cover`; `section .x` → `.tq-canvas .x`;
    // `section` → `.tq-canvas`; `:root` → `.tq-canvas`.
    return scope + s.slice(m[0].length);
  }
  // A class / id / attr / pseudo-leading FIRST compound can be on the scope ROOT
  // itself — the model styles the slide root via a class on the `<section>`
  // (e.g. `.slide{background:…}` with `<section class="slide">`). The section is
  // `.tq-canvas.slide`, so a descendant-only `.tq-canvas .slide` would MISS it
  // (the white-on-white bug). Match BOTH the root (compound) and descendants.
  const [first, rest] = splitFirstCompound(s);
  if (/^[.#[:]/.test(first)) {
    return `${scope}${first}${rest}, ${scope} ${first}${rest}`;
  }
  // Tag- / `*`-leading → only ever a descendant of the scope root.
  return `${scope} ${s}`;
}

function scopeSelectorList(prelude: string, scope: string): string {
  return splitTopLevel(prelude, ",")
    .map((sel) => scopeOneSelector(sel, scope))
    .join(", ");
}

const AT_NAME = /^@([a-zA-Z-]+)/;

export function scopeDeckCss(css: string, scope = ".tq-canvas"): string {
  const nodes = tokenize(stripComments(css));
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "rule") {
      out.push(`${scopeSelectorList(node.prelude, scope)}{${node.block}}`);
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
