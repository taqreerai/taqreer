// Canonical DOM-leaf classification for the in-canvas editor.
//
// A slide is nested flex/grid/SVG HTML, but the editor only ever touches the
// VISUALLY-RENDERED leaves — text runs, images, graphics — never the layout/wrapper
// divs between them. ONE rule (`isTextLeaf`) drives BOTH selection and the Layers
// list, so what's clickable and what's listed can never disagree. Pure DOM logic,
// no React — shared by the iframe editor and any panel that lists elements.

// Inline formatting tags. An element whose element-children are ALL inline (plus
// text) renders as a single visual text run; anything with a block-level child is a
// layout container.
export const INLINE_TAGS = new Set([
  "SPAN", "A", "B", "I", "EM", "STRONG", "U", "S", "SMALL", "SUB", "SUP", "MARK",
  "BR", "ABBR", "CODE", "Q", "TIME", "BDI", "BDO", "WBR", "CITE", "LABEL", "DEL",
  "INS", "KBD", "SAMP", "VAR",
]);

// Text tags treated as editable even if a stray block child snuck in (e.g.
// contentEditable junk from an earlier paste) — otherwise one bad edit would lock the
// element out of editing forever.
export const TEXT_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "A", "SPAN", "BLOCKQUOTE",
  "FIGCAPTION", "CAPTION", "DT", "DD", "TD", "TH", "B", "I", "EM", "STRONG",
  "MARK", "SMALL", "LABEL", "CITE",
]);

// A visual TEXT leaf: renders visible text with no block-level children. This is the
// OUTERMOST such element (we never recurse into one), so a heading containing an
// inline <span> counts as ONE leaf, not two.
//
// A <div> qualifies on the SAME terms as any other element — it holds text and all
// its element-children are inline — because Claude authors plenty of primary text as
// a bare <div>…</div>, and excluding the tag wholesale made that text unselectable /
// uneditable. Image/icon wrappers are still excluded for free: <img>/<svg> aren't in
// INLINE_TAGS, so a <div><img></div> fails the inline-only test and stays a
// pass-through container. Overlay captions laid OVER an image no longer need a
// special case either — the editor's hit-test (resolveHit + pointInInk) only selects
// an element when the cursor is over its actual text ink, so clicking the image's
// empty area falls through to the image, while clicking the caption text selects it.
export function isTextLeaf(el: Element): boolean {
  return (
    (el.textContent ?? "").trim().length > 0 &&
    [...el.children].every((c) => INLINE_TAGS.has(c.tagName))
  );
}

// A visually-rendered leaf: a text run, an image, or a graphic. Layout/wrapper divs
// are NOT leaves — neither selectable nor listed.
export function isVisualLeaf(el: Element): boolean {
  if (el.tagName === "IMG") return true;
  if (el.tagName.toLowerCase() === "svg") return true;
  return isTextLeaf(el);
}

// True when the element paints something of its OWN (a solid colour, a gradient,
// a background image, a shadow, or a visible border), as opposed to a transparent
// layout wrapper. This is what promotes a content-free `<div>` (a colour panel, a
// scrim, a full-bleed overlay) to a selectable object: now that locking is manual
// (Layers panel), every painted block is grabbable, not just text/img/svg. Kept in
// lockstep with flatten.ts `hasOwnPaint` so a shadow-only shell that flatten emits is
// also selectable / listed. Needs the live view for the computed style.
export function hasOwnPaint(el: Element, win: Window): boolean {
  const cs = win.getComputedStyle(el);
  if (/gradient|url\(/i.test(cs.backgroundImage)) return true;
  if (isOpaqueish(cs.backgroundColor)) return true;
  if (cs.boxShadow && cs.boxShadow !== "none") return true;
  return hasVisibleBorder(cs);
}

// A visible border on ANY side — accent bars / card top-rules / framed boxes are
// often a 2-3px coloured border rather than a filled element, and the user still
// wants to select them.
function hasVisibleBorder(cs: CSSStyleDeclaration): boolean {
  const sides = [
    ["borderTopWidth", "borderTopColor", "borderTopStyle"],
    ["borderRightWidth", "borderRightColor", "borderRightStyle"],
    ["borderBottomWidth", "borderBottomColor", "borderBottomStyle"],
    ["borderLeftWidth", "borderLeftColor", "borderLeftStyle"],
  ] as const;
  for (const [w, c, s] of sides) {
    if (
      parseFloat(cs[w]) >= 1 &&
      cs[s] !== "none" &&
      isOpaqueish(cs[c])
    ) {
      return true;
    }
  }
  return false;
}

// Resolve a click target to the selectable object at/above it, or null when the
// click lands on a transparent wrapper or the bare slide root (→ deselect / let the
// hit-test fall through to whatever's beneath). Priority: an <svg> selects as one
// unit; a text run resolves to its OUTERMOST text leaf; an image; otherwise (only
// when `paint` is enabled) any element that paints its OWN fill (a colour block /
// scrim / full-bleed overlay). The slide root <section> is never returned (it's the
// bg + deselect surface — its own fill is edited from the Layers Background row).
//
// `paint` lets the caller run a CONTENT-FIRST pass: a full-bleed scrim painted ON
// TOP of text would otherwise eat every click (its box hit-tests solid even where
// it's visually transparent), so the hit-test resolves content leaves first and
// only falls back to painted shapes when nothing else is under the cursor.
export function resolveSelectable(
  el: Element,
  sec: Element,
  opts: { paint?: boolean } = {},
): HTMLElement | null {
  const paint = opts.paint ?? true;
  const svg = el.closest("svg");
  if (svg && svg !== sec && sec.contains(svg)) return svg as unknown as HTMLElement;
  const win = el.ownerDocument?.defaultView ?? null;
  let n: Element | null = el;
  let best: HTMLElement | null = null;
  while (n && n !== sec) {
    if (n.tagName === "IMG") return n as HTMLElement;
    if (isTextLeaf(n)) {
      best = n as HTMLElement; // keep climbing to the OUTERMOST text leaf
      n = n.parentElement;
      continue;
    }
    if (best) break; // already resolved a text leaf — its parent is a wrapper, stop
    if (paint && win && hasOwnPaint(n, win)) return n as HTMLElement; // painted block
    break; // transparent wrapper → fall through to the next element in the stack
  }
  return best;
}

// Can this element host inline text editing? Text tags always; a div/section only if
// its children are inline-only. SVG/img/hr never.
export function isTextEditable(el: Element): boolean {
  if (el.closest("svg")) return false;
  if (["IMG", "SVG", "HR"].includes(el.tagName)) return false;
  if (TEXT_TAGS.has(el.tagName)) return true;
  return [...el.children].every((c) => INLINE_TAGS.has(c.tagName));
}

// The element whose z-index actually governs a leaf's stacking: the leaf itself if
// positioned, else the nearest positioned ancestor (a leaf nested in an absolute
// block restacks the whole block). Falls back to the leaf. Bounded by the stage.
// Shared by the Layers reorder AND the pill's bring-to-front / send-to-back so both
// move the SAME element — otherwise setting z on a static leaf does nothing.
export function stackingTarget(el: HTMLElement, win: Window, stage: Element): HTMLElement {
  let n: HTMLElement | null = el;
  while (n && n !== stage) {
    if (win.getComputedStyle(n).position !== "static") return n;
    n = n.parentElement;
  }
  return el;
}

export type LayerNode = {
  el: HTMLElement;
  label: string;
  // text run · image · svg graphic · gradient fill · solid-colour shape · the slide bg.
  kind: "text" | "image" | "graphic" | "gradient" | "shape" | "background";
  depth: number; // always 0 — flat list; the panel folds groups into folders itself
  // The element's data-tq-group id (virtual grouping), or undefined. The Layers
  // panel folds same-group leaves into one collapsible folder.
  group?: string;
};

// A colour string reads as actually-painted (not fully transparent).
function isOpaqueish(color: string): boolean {
  if (!color || color === "transparent") return false;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return true; // named / hex colour → assume painted
  const parts = m[1].split(",").map((s) => s.trim());
  const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
  return a > 0.01;
}

// Classify an element's VISIBLE fill: a gradient, a background image, a solid
// colour — or null when it paints nothing.
function fillType(cs: CSSStyleDeclaration): "gradient" | "image" | "color" | null {
  const bg = cs.backgroundImage;
  if (/gradient/i.test(bg)) return "gradient";
  if (/url\(/i.test(bg)) return "image";
  if (isOpaqueish(cs.backgroundColor)) return "color";
  return null;
}

// A decorative FILL leaf: an element with a visible fill but NO content (no text,
// no img/svg descendant) — a gradient scrim, an accent bar, a colour block. These
// are real visual layers, not layout wrappers. Needs a live view for the computed
// style; returns null without one (or for content-bearing containers).
function fillLeaf(
  el: HTMLElement,
  win: Window,
): { label: string; kind: LayerNode["kind"] } | null {
  if ((el.textContent ?? "").trim() !== "") return null;
  if (el.querySelector("img, svg")) return null;
  const cs = win.getComputedStyle(el);
  const t = fillType(cs);
  if (t === "gradient") return { label: "Gradient", kind: "gradient" };
  if (t === "image") return { label: "Image", kind: "image" };
  // Solid-colour fills (colour panels, scrims, full-bleed overlays) ARE listed
  // now — they're selectable objects (manual lock replaced the old hard-exclude),
  // so the Layers panel must surface them for select / lock / reorder / delete.
  if (t === "color") return { label: "Shape", kind: "shape" };
  // Border-only decorative elements (accent rules / framed dividers).
  if (hasVisibleBorder(cs)) return { label: "Shape", kind: "shape" };
  return null;
}

// Flat list of ONLY the visually-rendered leaves — text runs, images, graphics.
// Layout/wrapper divs are skipped entirely (recursed THROUGH, never listed). No
// groups, no nesting. Presentation-only — never mutates the DOM.
//
// Engine for the I2 Layers panel (plan-editor §5.4). No in-PRODUCT caller yet —
// DeckView's editor uses the selection helpers above (resolveSelectable /
// isTextEditable), not this — but the lab (app/lab/editor/LabEditor) consumes it
// for its Layers list, so the lab and the future product panel share one builder.
export function buildLayerTree(section: HTMLElement): LayerNode[] {
  const out: LayerNode[] = [];
  const win = section.ownerDocument.defaultView;
  const walk = (el: HTMLElement) => {
    for (const child of [...el.children] as HTMLElement[]) {
      const tag = child.tagName.toLowerCase();
      if (tag === "style" || tag === "script") continue;
      // Skip empty 0px elements (Claude sometimes emits stray empty divs) — not a
      // visible layer, and never selectable on the canvas either.
      const cr = child.getBoundingClientRect();
      if (cr.width < 1 || cr.height < 1) continue;
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
      // Decorative fill (gradient scrim / colour block / bg image, no content) —
      // a real visual layer, listed; NOT a layout wrapper to recurse through.
      const fill = win ? fillLeaf(child, win) : null;
      if (fill) {
        out.push({ el: child, label: fill.label, kind: fill.kind, depth: 0 });
        continue;
      }
      // layout container — not a visual element; recurse to find leaves inside it.
      walk(child);
    }
  };
  walk(section);
  // Stamp each leaf's group id (virtual grouping) so the panel can fold same-group
  // leaves into a folder. Read here, in the one place that already walks the DOM.
  for (const n of out) {
    const gid = n.el.getAttribute("data-tq-group");
    if (gid) n.group = gid;
  }
  // NOTE: the slide BACKGROUND (kind "background") is NOT emitted here — the
  // builder's arg is the editor STAGE, not the slide root, so the panel
  // synthesizes that node from the real slide root and pins it backmost.
  return out;
}
