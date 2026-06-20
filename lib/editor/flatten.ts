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
function freezeInherited(el: HTMLElement, cs: CSSStyleDeclaration): string {
  let out = `color:${cs.color};`;
  const text = (el.textContent ?? "").trim().length > 0;
  if (text) {
    for (const p of TEXT_INHERIT) {
      const v = cs.getPropertyValue(p);
      if (v) out += `${p}:${v};`;
    }
  }
  return out;
}

export function flattenSlideSection(
  section: HTMLElement,
  opts: FlattenOptions = {},
): { html: string } {
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
  for (const style of Array.from(section.querySelectorAll(":scope > style"))) {
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
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
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
  };
  collect(section, "");

  return { html: out.outerHTML };
}
