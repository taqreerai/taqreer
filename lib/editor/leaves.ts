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

// Resolve a click target to the OUTERMOST visual leaf at/above it, or null when the
// click lands on a layout container or the bare slide bg (→ deselect). An <svg>
// selects as one unit (never its inner paths).
export function resolveSelectable(el: Element, sec: Element): HTMLElement | null {
  const svg = el.closest("svg");
  if (svg && svg !== sec && sec.contains(svg)) return svg as unknown as HTMLElement;
  let n: Element | null = el;
  let best: HTMLElement | null = null;
  while (n && n !== sec) {
    if (n.tagName === "IMG" || isTextLeaf(n)) best = n as HTMLElement;
    else break;
    n = n.parentElement;
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

export type LayerNode = {
  el: HTMLElement;
  label: string;
  // text run · image · svg graphic · gradient fill · solid shape · the slide bg.
  kind: "text" | "image" | "graphic" | "gradient" | "shape" | "background";
  depth: number; // always 0 — flat list, no nesting / groups
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
  const t = fillType(win.getComputedStyle(el));
  if (t === "gradient") return { label: "Gradient", kind: "gradient" };
  if (t === "image") return { label: "Image", kind: "image" };
  if (t === "color") return { label: "Shape", kind: "shape" };
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
  // NOTE: the slide BACKGROUND (kind "background") is NOT emitted here — the
  // builder's arg is the editor STAGE, not the slide root, so the panel
  // synthesizes that node from the real slide root and pins it backmost.
  return out;
}
