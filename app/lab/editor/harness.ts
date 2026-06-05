// Phase 0 test harness — pure browser-side functions that break the round-trip bet
// on purpose (context/phase-0-checklist.md). Runs against a real slide's HTML.
import { sanitizeSlideHtml } from "@/lib/export/sanitize";

// ── The round-trip primitive (A1) ────────────────────────────────────────────
export function roundtrip(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = sanitizeSlideHtml(html);
  return d.innerHTML;
}

export function firstDiffAt(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// Common-prefix / common-suffix → the size of the actually-changed region. A
// localized edit changes a tiny region; a noisy reserialization changes ~the whole
// string even for a one-word edit.
export function changedRegion(a: string, b: string): {
  len: number;
  frac: number;
} {
  let p = 0;
  const n = Math.min(a.length, b.length);
  while (p < n && a[p] === b[p]) p++;
  let s = 0;
  while (s < n - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const len = Math.max(a.length - p - s, b.length - p - s, 0);
  return { len, frac: len / Math.max(1, a.length) };
}

export type A1Result = {
  browserNormalized: boolean;
  dblStable: boolean;
  drift10: number;
  firstDiffSnippet: string | null;
  sanitizedLen: number;
  r0Len: number;
  r0: string;
};

export function a1ForSlide(html: string): A1Result {
  const sanitized = sanitizeSlideHtml(html);
  const r0 = roundtrip(html);
  const r1 = roundtrip(r0);
  const dblStable = r0 === r1;
  let r = r0;
  let drift10 = 0;
  for (let i = 0; i < 10; i++) {
    const next = roundtrip(r);
    if (next !== r) drift10++;
    r = next;
  }
  const diffPos = dblStable ? -1 : firstDiffAt(r0, r1);
  const firstDiffSnippet =
    diffPos < 0
      ? null
      : `…${r0.slice(Math.max(0, diffPos - 40), diffPos)}⟦${r0.slice(diffPos, diffPos + 1)}⟧${r0.slice(diffPos + 1, diffPos + 40)}…`;
  return {
    browserNormalized: sanitized !== r0,
    dblStable,
    drift10,
    firstDiffSnippet,
    sanitizedLen: sanitized.length,
    r0Len: r0.length,
    r0,
  };
}

// ── A2/A3 — the EDIT round-trip (the real gate) ──────────────────────────────
// Run real contentEditable edits through the browser's editing pipeline (where the
// junk gets injected), then inspect the serialized result. Done in an offscreen-but-
// ATTACHED scratch node (contentEditable + execCommand need the element in-document
// and focusable) so the displayed slide is never disturbed.
function withScratch<T>(html: string, fn: (root: HTMLElement) => T): T {
  const scratch = document.createElement("div");
  scratch.setAttribute("aria-hidden", "true");
  scratch.style.cssText =
    "position:fixed;left:-99999px;top:0;width:1920px;height:1080px;";
  scratch.innerHTML = sanitizeSlideHtml(html);
  document.body.appendChild(scratch);
  try {
    return fn(scratch);
  } finally {
    scratch.remove();
  }
}

function sectionHtml(root: HTMLElement): string {
  return sanitizeSlideHtml(root.firstElementChild?.outerHTML ?? root.innerHTML);
}

// A leaf-ish text element with real visible text (prefer Arabic to stress BiDi).
function pickTextEl(root: HTMLElement): HTMLElement | null {
  const cands = ([...root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,span")] as HTMLElement[]).filter(
    (el) => {
      const t = (el.textContent ?? "").trim();
      const hasElementChildren = el.children.length > 0;
      return t.length > 4 && !hasElementChildren;
    },
  );
  return (
    cands.find((el) => /[؀-ۿ]/.test(el.textContent ?? "")) ??
    cands[0] ??
    null
  );
}

function effectiveDir(el: HTMLElement): string {
  let n: HTMLElement | null = el;
  while (n) {
    const d = n.getAttribute?.("dir");
    if (d) return d;
    n = n.parentElement;
  }
  return "(inherited)";
}

// Perform a real edit through the browser's contentEditable pipeline (replaces the
// element's text). `execCommand` is deprecated but still routes through the editing
// engine in Chromium — exactly the path that injects junk in production.
function editTextNode(el: HTMLElement, newText: string) {
  el.setAttribute("contenteditable", "true");
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand("insertText", false, newText);
  el.blur();
  el.removeAttribute("contenteditable");
}

const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/;

function junkReport(el: HTMLElement): string[] {
  const html = el.innerHTML;
  const issues: string[] = [];
  if (/<div[\s>]/i.test(html)) issues.push("<div>");
  if (/<font[\s>]/i.test(html)) issues.push("<font>");
  if (/<span[^>]*\sstyle=/i.test(html)) issues.push("styled <span>");
  if (/<br\s*\/?>/i.test(html)) issues.push("<br>");
  if (/&nbsp;| /.test(html)) issues.push("nbsp");
  if (BIDI_CONTROLS.test(html)) issues.push("bidi-control");
  return issues;
}

export type A2Result = {
  edited: boolean;
  tag: string;
  injectedJunk: string[]; // A2 hygiene — empty = clean
  diffFrac: number; // localized-edit metric (small = good)
  diffLen: number;
  dirPreserved: boolean; // A3
  bidiInjected: boolean; // A3
  latinNumeralsKept: boolean; // A3
  cycle10Junk: number; // junk after 10 edit cycles
  cycle10Growth: number; // serialized-length growth over 10 cycles (accumulation)
  sample: string;
};

const EMPTY_A2: A2Result = {
  edited: false,
  tag: "—",
  injectedJunk: [],
  diffFrac: 0,
  diffLen: 0,
  dirPreserved: true,
  bidiInjected: false,
  latinNumeralsKept: true,
  cycle10Junk: 0,
  cycle10Growth: 0,
  sample: "",
};

export function a2a3ForSlide(html: string): A2Result {
  return withScratch(html, (root): A2Result => {
    const el = pickTextEl(root);
    if (!el) return EMPTY_A2;
    const tag = el.tagName.toLowerCase();
    const dirBefore = effectiveDir(el);
    const before = sectionHtml(root);

    // One-word edit that stresses BiDi: Arabic + Latin + Latin digits.
    editTextNode(el, "تجربة Edit 2026");

    const injectedJunk = junkReport(el);
    const after = sectionHtml(root);
    const { len: diffLen, frac: diffFrac } = changedRegion(before, after);

    const dirPreserved =
      effectiveDir(el) === dirBefore && !/\bdir=["']ltr["']/i.test(el.outerHTML);
    const bidiInjected = BIDI_CONTROLS.test(el.innerHTML);
    const txt = el.textContent ?? "";
    const latinNumeralsKept = /2026/.test(txt) && !/[٠-٩]/.test(txt);

    // 10× edit cycle — edit → serialize → re-render → repeat. Watch for junk +
    // serialized-length accumulation (the "creeping wrapper/whitespace" drift).
    let cur = sectionHtml(root);
    const startLen = cur.length;
    for (let i = 0; i < 10; i++) {
      root.innerHTML = cur;
      const e2 = pickTextEl(root);
      if (e2) editTextNode(e2, `cycle ${i} نص 2026`);
      cur = sectionHtml(root);
    }
    root.innerHTML = cur;
    const lastEl = pickTextEl(root);
    const cycle10Junk = lastEl ? junkReport(lastEl).length : 0;
    const cycle10Growth = cur.length - startLen;

    return {
      edited: true,
      tag,
      injectedJunk,
      diffFrac,
      diffLen,
      dirPreserved,
      bidiInjected,
      latinNumeralsKept,
      cycle10Junk,
      cycle10Growth,
      sample: el.outerHTML.slice(0, 400),
    };
  });
}

// ── Visual layers (flat) ─────────────────────────────────────────────────────
export type LayerNode = {
  el: HTMLElement;
  label: string;
  kind: "text" | "image" | "graphic";
  depth: number; // always 0 — flat list, no nesting / groups
};

// Inline formatting tags — an element whose element-children are ALL inline (plus
// text) renders as one visual text run; anything else is a layout container.
const INLINE_TAGS = new Set([
  "SPAN", "A", "B", "I", "EM", "STRONG", "U", "S", "SMALL", "SUB", "SUP", "MARK",
  "BR", "ABBR", "CODE", "Q", "TIME", "BDI", "BDO", "WBR", "CITE", "LABEL", "DEL",
  "INS", "KBD", "SAMP", "VAR",
]);

// A visual TEXT leaf: renders visible text with no block-level children. This is the
// OUTERMOST such element (we never recurse into one), so a heading containing an
// inline <span> counts as ONE leaf, not two. Shared with the selection model so the
// Layers list and what's clickable always agree.
export function isTextLeaf(el: Element): boolean {
  return (
    (el.textContent ?? "").trim().length > 0 &&
    [...el.children].every((c) => INLINE_TAGS.has(c.tagName))
  );
}

// Flat list of ONLY the visually-rendered leaves — text runs, images, graphics.
// Layout/wrapper divs are skipped entirely (recursed THROUGH, never listed). No
// groups, no nesting. Presentation-only — never mutates the DOM.
export function buildLayerTree(section: HTMLElement): LayerNode[] {
  const out: LayerNode[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of [...el.children] as HTMLElement[]) {
      const tag = child.tagName.toLowerCase();
      if (tag === "style" || tag === "script") continue;
      if (tag === "svg") {
        out.push({ el: child, label: "Graphic", kind: "graphic", depth: 0 });
        continue;
      }
      if (tag === "img") {
        const isGen = child.hasAttribute("data-genimage");
        out.push({
          el: child,
          label: isGen ? "Generated image" : "Image",
          kind: "image",
          depth: 0,
        });
        continue;
      }
      if (isTextLeaf(child)) {
        const t = (child.textContent ?? "").trim();
        out.push({
          el: child,
          label: `“${t.slice(0, 30)}${t.length > 30 ? "…" : ""}”`,
          kind: "text",
          depth: 0,
        });
        continue;
      }
      // layout container — not a visual element; recurse to find leaves inside it.
      walk(child);
    }
  };
  walk(section);
  return out;
}
