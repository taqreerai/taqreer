// FULL flatten (the editor's structural normal form).
//
// A slide is authored as nested HTML: top-level absolute layers (bg image, scrims,
// chrome) PLUS content layers (.wrap) whose text runs are in flow. Nesting means each
// positioned wrapper is its own STACKING CONTEXT, so a leaf's z-index can only reorder
// it within its wrapper — never relative to the rest of the slide. That breaks global
// restacking, layer-drag, and grouping.
//
// This pass dissolves all of that: every visual element (text run, image, graphic,
// painted shell) becomes a STANDALONE, absolutely-positioned DIRECT CHILD of the
// <section>, in ONE stacking context, carrying:
//   - its measured geometry in canvas (1920x1080) space (left/top/width/height + rotate),
//   - an explicit z-index equal to its ORIGINAL PAINT-ORDER rank (so the flat stack
//     renders identically to the nested original, and is then freely restackable),
//   - its INHERITED text/colour styles frozen inline (hoisting an element out of its
//     wrapper changes what it inherits, so we bake the resolved values to keep it 1:1),
//   - its own inner HTML / scoped classes / data-* / dir preserved (fonts, colours, RTL
//     cascade, and the export pipeline's per-leaf text bodies all stay intact).
//
// Re-flatten is idempotent: geometry is integer-rounded and reproduced from the live
// layout, the paint order of an already-flat section is just its DOM order, and the
// frozen styles re-resolve to the same values.

import { isTextLeaf } from "./leaves";

export type FlattenOptions = {
  // The live editor renders the section inside a CSS-scaled stage (--tqe-scale); pass that
  // scale so measured on-screen geometry maps back to canvas (1920x1080) space. The export
  // path renders at scale 1, where this is a no-op.
  scale?: number;
};

// Inline-style properties flatten OWNS and rewrites every pass. Stripping them from the
// source element's prior inline style before re-applying makes re-flatten byte-stable:
// geometry + stacking + frozen inheritance are reproduced from the live layout, never
// accumulated.
const FLATTEN_OWNED = new Set([
  "position", "left", "top", "right", "bottom", "width", "height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "transform", "transform-origin", "z-index", "white-space",
  // frozen inherited text/colour props (see freezeInherited)
  "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "color", "text-align",
  "text-transform", "text-decoration", "text-decoration-line",
  "text-decoration-color", "text-decoration-style", "text-indent",
  "direction", "unicode-bidi",
]);

// Remove flatten-owned props via the browser's CSS parser (the element is a live DOM
// clone, so it carries a real CSSStyleDeclaration). A naive string split on ";" would
// corrupt values that legitimately contain semicolons, e.g. url(data:image/svg+xml;...).
function stripFlattenProps(el: HTMLElement): string {
  for (const prop of FLATTEN_OWNED) el.style.removeProperty(prop);
  return el.getAttribute("style") ?? "";
}

// Net rotation (deg) from an element's OWN computed transform matrix. Translation is
// ignored (captured by the measured centre); element-level scale is rare on slide leaves
// and intentionally not reconstructed.
function rotationDeg(transform: string): number {
  if (!transform || transform === "none") return 0;
  const m = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
  if (!m) return 0;
  const p = m[1].split(",").map((s) => parseFloat(s.trim()));
  if (p.length < 4 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 0;
  return Math.round((Math.atan2(p[1], p[0]) * 180) / Math.PI * 100) / 100;
}

// If an element CLIPS its content (overflow hidden/clip) AND has rounded corners, it
// is a rounded MASK: its children render with those rounded corners. Flatten hoists
// those children out of the clipper, so we carry the radius down to them (a photo in
// a rounded card keeps its roundness once it's a standalone box). Returns the radius
// shorthand, or "" when the element doesn't clip / isn't rounded.
function clipRadiusOf(cs: CSSStyleDeclaration): string {
  const clips =
    cs.overflowX === "hidden" || cs.overflowX === "clip" ||
    cs.overflowY === "hidden" || cs.overflowY === "clip";
  if (!clips) return "";
  return hasOwnRadius(cs) ? cs.borderRadius : "";
}

function hasOwnRadius(cs: CSSStyleDeclaration): boolean {
  return [
    cs.borderTopLeftRadius, cs.borderTopRightRadius,
    cs.borderBottomLeftRadius, cs.borderBottomRightRadius,
  ].some((v) => parseFloat(v) > 0);
}

// Does the element paint its own box (fill / gradient / image / visible border / shadow)?
function hasOwnPaint(cs: CSSStyleDeclaration): boolean {
  if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
  const bg = cs.backgroundColor;
  if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return true;
  if (cs.boxShadow && cs.boxShadow !== "none") return true;
  if (
    cs.borderStyle !== "none" &&
    (cs.borderTopWidth !== "0px" || cs.borderRightWidth !== "0px" ||
      cs.borderBottomWidth !== "0px" || cs.borderLeftWidth !== "0px")
  ) {
    return true;
  }
  return false;
}

// Inherited text/colour properties frozen inline on each flattened box. Hoisting an
// element to the section changes its inherited cascade, so we bake the RESOLVED values
// to keep it rendering exactly as it did inside its old wrapper. Only emitted for
// text-bearing boxes (img/svg keep `color` for currentColor).
const TEXT_INHERIT: readonly string[] = [
  "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "line-height", "letter-spacing", "word-spacing", "text-align",
  "text-transform", "text-decoration", "text-indent", "direction", "unicode-bidi",
];
// Build an inline-style string of `${prop}:${resolved};` for every prop that
// resolves to a non-empty value. Shared by the leaf freeze (freezeInherited) and
// the descendant freeze (freezeDescendants) so both tokenize props identically.
function bakeProps(cs: CSSStyleDeclaration, props: readonly string[]): string {
  let out = "";
  for (const p of props) {
    const v = cs.getPropertyValue(p);
    if (v) out += `${p}:${v};`;
  }
  return out;
}

function freezeInherited(el: HTMLElement, cs: CSSStyleDeclaration): string {
  let out = `color:${cs.color};`;
  if ((el.textContent ?? "").trim().length > 0) out += bakeProps(cs, TEXT_INHERIT);
  return out;
}

// Props baked onto each DESCENDANT of a hoisted text leaf. `display` is the
// critical one: a rule scoped to a now-removed ancestor (`.foot b{display:block}`)
// stops matching once the box is hoisted out, so without this the descendant
// reverts to its tag default and stacked labels collapse to inline. Colour plus
// the text ladder are baked too so a descendant's OWN scoped overrides (e.g.
// `.foot b` setting color / font-size / font-weight) survive as well.
const DESC_FREEZE: readonly string[] = ["display", "color", ...TEXT_INHERIT];

// A text leaf is hoisted WHOLE (full clone), so its descendants leave behind any
// ancestor-scoped cascade. Bake each descendant's RESOLVED DESC_FREEZE props
// inline, read from the live (still-in-context) element. Live + clone walk in the
// same document order, so index `i` pairs them. STRIP any prior freeze first so a
// re-flatten of an already-flat slide stays byte-stable (mirrors stripFlattenProps
// for the box; without it each pass would append another copy and the persisted
// HTML would grow unbounded). SVG internals are left alone (own styling model).
function freezeDescendants(live: HTMLElement, clone: HTMLElement, win: Window): void {
  const liveDesc = live.querySelectorAll<HTMLElement>("*");
  const cloneDesc = clone.querySelectorAll<HTMLElement>("*");
  const n = Math.min(liveDesc.length, cloneDesc.length);
  for (let i = 0; i < n; i++) {
    const ld = liveDesc[i];
    if (ld.closest("svg")) continue;
    const cd = cloneDesc[i];
    for (const p of DESC_FREEZE) cd.style.removeProperty(p);
    const add = bakeProps(win.getComputedStyle(ld), DESC_FREEZE);
    if (!add) continue;
    const prior = (cd.getAttribute("style") ?? "").replace(/;\s*$/, "");
    cd.setAttribute("style", prior ? `${prior};${add}` : add);
  }
}

// ── Safety net: content-parity census ─────────────────────────────────────────
// Flatten is lossy AND irreversible (it overwrites the slide in both stores and
// feeds the PPTX export), so before the caller persists we verify the output
// still holds every VISIBLE text word and every image / svg / embed the input
// had. On any shortfall the caller keeps the slide UNFLATTENED (degraded editing,
// but lossless) rather than silently shipping a deck with dropped content. Text
// is a word MULTISET (catches a dropped duplicate); the census is a strict
// non-shrink on visual atoms. Styling fidelity (collapsed lines, lost colour) is
// NOT checked here, only content presence.
type AtomCensus = { img: number; svg: number; embed: number };
export type FlattenParity = {
  ok: boolean;
  missingWords: string[];
  srcCensus: AtomCensus;
  outCensus: AtomCensus;
};

function wordCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of text.split(/\s+/)) if (w) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

// Word multiset of a subtree, tokenized PER TEXT NODE so adjacent inline runs
// keep their boundaries (`<span>A</span><span>B</span>` stays {A, B}, never "AB").
// `visibleOnly` skips text that does not render (display:none / collapsed / inside
// <style>|<script>) via a Range rect; used on the LIVE source so flatten is never
// faulted for correctly omitting invisible content. The detached output clone has
// no layout, so it passes false (everything it carries is meant to render).
function collectWords(root: HTMLElement, doc: Document, visibleOnly: boolean): Map<string, number> {
  const words = new Map<string, number>();
  const range = visibleOnly ? doc.createRange() : null;
  const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = (n.textContent ?? "").trim();
    if (!t) continue;
    if (range) {
      if (n.parentElement?.closest("style, script")) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
    }
    for (const [w, c] of wordCounts(t)) words.set(w, (words.get(w) ?? 0) + c);
  }
  return words;
}

function checkParity(section: HTMLElement, out: HTMLElement, win: Window): FlattenParity {
  const doc = section.ownerDocument;
  // Both sides census words PER TEXT NODE (see collectWords). Counting the output
  // via `out.textContent` instead would concatenate adjacent inline runs with no
  // whitespace (`<span>A</span><span>B</span>` becomes "AB"), so a nav/footer that
  // sets runs side by side would falsely read the boundary words as dropped and the
  // net would needlessly keep the slide unflattened. Per-node on BOTH sides matches
  // word boundaries, so only a genuinely unemitted run is ever flagged.
  const srcWords = collectWords(section, doc, true);
  const outProbe = out.cloneNode(true) as HTMLElement;
  outProbe.querySelectorAll("style, script").forEach((s) => s.remove());
  const outWords = collectWords(outProbe, doc, false);
  const missingWords: string[] = [];
  for (const [w, count] of srcWords) {
    if ((outWords.get(w) ?? 0) < count) missingWords.push(w);
  }
  // Visual atoms: output must not have FEWER than the source's VISIBLE atoms
  // (a 0x0 defs <svg> or display:none img is excluded, so it isn't required).
  const EMBED = "canvas, video, iframe, object, embed";
  const visibleCount = (sel: string) =>
    [...section.querySelectorAll(sel)].filter((el) => {
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    }).length;
  const srcCensus: AtomCensus = {
    img: visibleCount("img"),
    svg: visibleCount("svg"),
    embed: visibleCount(EMBED),
  };
  const outCensus: AtomCensus = {
    img: out.querySelectorAll("img").length,
    svg: out.querySelectorAll("svg").length,
    embed: out.querySelectorAll(EMBED).length,
  };
  const censusShrunk =
    outCensus.img < srcCensus.img ||
    outCensus.svg < srcCensus.svg ||
    outCensus.embed < srcCensus.embed;
  return {
    ok: missingWords.length === 0 && !censusShrunk,
    missingWords: missingWords.slice(0, 25),
    srcCensus,
    outCensus,
  };
}

export function flattenSlideSection(
  section: HTMLElement,
  opts: FlattenOptions = {},
): { html: string; parity: FlattenParity } {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const win = section.ownerDocument.defaultView;
  if (!win) throw new Error("flattenSlideSection: section is not attached to a live document");

  const isHidden = (cs: CSSStyleDeclaration) =>
    cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0";

  const originRect = section.getBoundingClientRect();

  // Geometry relative to the SECTION. offsetWidth/Height are layout (canvas) px;
  // getBoundingClientRect is on-screen (scaled) px, so its deltas are divided by `scale`.
  const measure = (el: HTMLElement, cs: CSSStyleDeclaration) => {
    const rect = el.getBoundingClientRect();
    const w = el.offsetWidth || rect.width / scale;
    const h = el.offsetHeight || rect.height / scale;
    const cx = (rect.left + rect.width / 2 - originRect.left) / scale;
    const cy = (rect.top + rect.height / 2 - originRect.top) / scale;
    return {
      left: Math.round(cx - w / 2),
      top: Math.round(cy - h / 2),
      // Ceil the box so a sub-pixel shave can't force single-line text to wrap.
      width: Math.ceil(w),
      height: Math.ceil(h),
      rotateDeg: rotationDeg(cs.transform),
    };
  };

  // One standalone absolute box: a clone of `el` (full keeps its subtree; shallow empties
  // it for a painted shell), positioned in section space, with an EXPLICIT global z.
  const makeBox = (
    el: HTMLElement,
    cs: CSSStyleDeclaration,
    z: number,
    fullClone: boolean,
    clipRadius: string,
  ): HTMLElement => {
    const m = measure(el, cs);
    const clone = el.cloneNode(fullClone) as HTMLElement;
    if (!fullClone) while (clone.firstChild) clone.removeChild(clone.firstChild);
    // Bake the descendant cascade onto the full clone (no-op for shells): a text
    // leaf carries scoped rules that match its children via an ancestor the hoist
    // drops (e.g. `.foot b{display:block}` makes stacked labels), so freeze each
    // descendant's resolved display + text styling inline before we own the box.
    if (fullClone) freezeDescendants(el, clone, win);
    const prev = stripFlattenProps(clone);
    const frozen = freezeInherited(el, cs);
    // SINGLE-LINE detection (robust + self-healing): force the live element onto one
    // line and measure the content width. If that fits within the box width, the text
    // is single-line and the fixed box width would otherwise SHAVE-wrap it (sub-pixel)
    // — pin white-space:nowrap. Genuine multi-line text has a one-line width far wider
    // than its box, so it keeps wrapping. Because it measures the would-be single-line
    // width (not the current wrapped height), re-flattening a slide whose box already
    // shave-wrapped HEALS it back to one line.
    let nowrap = "";
    if (isTextLeaf(el)) {
      const prevWS = el.style.whiteSpace;
      el.style.whiteSpace = "nowrap";
      const oneLineWidth = el.scrollWidth;
      el.style.whiteSpace = prevWS;
      if (oneLineWidth <= m.width + 4) nowrap = "white-space:nowrap;";
    }
    // A rounded clipping ANCESTOR (a mask) rounds this box's corners, but only if the
    // box doesn't already define its own radius. Hoisting it out of the clipper would
    // otherwise drop the mask (a photo in a rounded card goes back to square corners).
    const clip = clipRadius && !hasOwnRadius(cs) ? `border-radius:${clipRadius};overflow:hidden;` : "";
    const pos =
      // right:auto / bottom:auto neutralize any class-based right/bottom/inset from the
      // scoped <style> (which we can't strip): an absolute box with our inline left+width
      // AND a class `right` is over-constrained, and dir:rtl then IGNORES `left`.
      `position:absolute;left:${m.left}px;top:${m.top}px;right:auto;bottom:auto;` +
      `width:${m.width}px;height:${m.height}px;margin:0;` +
      (m.rotateDeg ? `transform:rotate(${m.rotateDeg}deg);transform-origin:center center;` : "") +
      `z-index:${z};` +
      clip +
      nowrap; // single-line text: keep it on one line (the fixed width can't shave-wrap)
    clone.setAttribute("style", [prev, frozen, pos].filter(Boolean).join(";"));
    clone.setAttribute("data-tq-flat", "1");
    return clone;
  };

  // A bare text node directly under a dissolved / painted-shell parent (e.g. the
  // "Page 01" in <div class="pno"><hr>Page 01</div>) is invisible to the element
  // walk below, so it would be silently dropped. Emit each RENDERED run as its own
  // absolute box, frozen with the parent's inherited text styles and positioned by
  // a Range measurement (same section-space geometry as makeBox).
  const makeTextBox = (
    textNode: Node,
    parentEl: HTMLElement,
    parentCs: CSSStyleDeclaration,
    z: number,
  ): HTMLElement | null => {
    const range = section.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return null; // not rendered
    const w = Math.ceil(rect.width / scale);
    const h = Math.ceil(rect.height / scale);
    const left = Math.round((rect.left + rect.width / 2 - originRect.left) / scale - w / 2);
    const top = Math.round((rect.top + rect.height / 2 - originRect.top) / scale - h / 2);
    const box = section.ownerDocument.createElement("div");
    box.textContent = (textNode.textContent ?? "").trim();
    const frozen = freezeInherited(parentEl, parentCs);
    box.setAttribute(
      "style",
      `${frozen}position:absolute;left:${left}px;top:${top}px;right:auto;bottom:auto;` +
        `width:${w}px;height:${h}px;margin:0;z-index:${z};white-space:nowrap;`,
    );
    box.setAttribute("data-tq-flat", "1");
    return box;
  };

  const isLeaf = (el: HTMLElement) =>
    el.tagName === "IMG" || el.tagName.toLowerCase() === "svg" || isTextLeaf(el);
  const hasContent = (el: HTMLElement) =>
    (el.textContent ?? "").trim() !== "" || !!el.querySelector("img, svg");

  const zOf = (cs: CSSStyleDeclaration) => {
    const z = parseInt(cs.zIndex, 10);
    return Number.isNaN(z) ? 0 : z;
  };

  // Walk in PAINT ORDER, emitting a standalone box for every visual element. Children of a
  // container are processed in (z-index asc, DOM order) — the order they paint — so the
  // running counter `z` reproduces the original stacking as a flat sequence.
  const out = section.cloneNode(false) as HTMLElement;
  // Carry ALL <style> blocks (not just direct children): a nested <style> in a
  // wrapper that dissolves would otherwise lose its @font-face / :root vars /
  // keyframes. They are global once hoisted. SVG-internal <style> stays in its svg.
  for (const style of Array.from(section.querySelectorAll("style"))) {
    if (style.closest("svg")) continue;
    out.appendChild(style.cloneNode(true));
  }
  let z = 1;
  // `clip` = the rounded-mask radius inherited from a clipping ANCESTOR (a rounded
  // card / framed photo). It flows down to every box hoisted out of that ancestor so
  // the mask survives flattening as the box's own border-radius.
  const collect = (parent: HTMLElement, clip: string) => {
    const kids = (Array.from(parent.children) as HTMLElement[])
      .filter((el) => {
        const low = el.tagName.toLowerCase();
        if (low === "style" || low === "script") return false;
        const cs = win.getComputedStyle(el);
        if (isHidden(cs)) return false;
        // Cull on LAYOUT px: offsetWidth/Height are scale-invariant (fall back to
        // rect/scale for inline boxes where offset is 0), with a 0.5px floor so a
        // genuine 1px hairline survives at any editor zoom and the result is
        // deterministic across zoom levels.
        const r = el.getBoundingClientRect();
        const w = el.offsetWidth || r.width / scale;
        const h = el.offsetHeight || r.height / scale;
        return w >= 0.5 && h >= 0.5;
      })
      .map((el, i) => ({ el, i, z: zOf(win.getComputedStyle(el)) }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map((x) => x.el);
    for (const el of kids) {
      const cs = win.getComputedStyle(el);
      // This element's OWN clip radius takes over for its descendants (a nested mask).
      const childClip = clipRadiusOf(cs) || clip;
      if (isLeaf(el)) {
        out.appendChild(makeBox(el, cs, z++, true, clip)); // text / image / graphic, whole
      } else if (hasOwnPaint(cs)) {
        out.appendChild(makeBox(el, cs, z++, false, clip)); // painted shell (scrim / fill / card)
        if (hasContent(el)) collect(el, childClip); // its content paints ON TOP, as its own boxes
      } else {
        collect(el, childClip); // transparent wrapper → dissolve, hoist its children
      }
    }
    // Bare text nodes directly under this dissolved / shell parent (siblings of the
    // element kids above) - emit each so mixed text+element content is never dropped.
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 3 /* TEXT_NODE */ || !(node.textContent ?? "").trim()) continue;
      const box = makeTextBox(node, parent, win.getComputedStyle(parent), z);
      if (box) {
        out.appendChild(box);
        z++;
      }
    }
  };
  collect(section, "");

  return { html: out.outerHTML, parity: checkParity(section, out, win) };
}
