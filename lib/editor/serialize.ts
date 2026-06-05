// Serialize a live edited slide <section> back to an HTML string suitable for
// persistence (→ sanitizeSlideHtmlServer → slide.html → new SlideVersion).
//
// The in-canvas editor tags the live DOM with editor-only attributes
// (data-tq-id on every element, data-tq-cc on visual leaves) and toggles
// contenteditable while a text run is being edited. None of that belongs in the
// saved source, so we serialize a CLONE with those stripped. The hover/selection
// overlays live OUTSIDE the <section> (appended to the iframe body), so cloning
// the section never captures them.

// Editor-only attributes to strip from the persisted HTML.
const EDITOR_ATTRS = ["data-tq-id", "data-tq-cc", "contenteditable"] as const;
// Selector for any element carrying one — derived from EDITOR_ATTRS so adding a
// new editor attribute updates both the strip list and the query in one edit.
const EDITOR_ATTR_SELECTOR = EDITOR_ATTRS.map((a) => `[${a}]`).join(",");

export function serializeSlideSection(sec: Element): string {
  const clone = sec.cloneNode(true) as Element;
  // The clone root itself carries data-tq-id (the section is element 0); strip it
  // plus every descendant's editor attributes.
  for (const attr of EDITOR_ATTRS) clone.removeAttribute(attr);
  for (const el of clone.querySelectorAll(EDITOR_ATTR_SELECTOR)) {
    for (const attr of EDITOR_ATTRS) el.removeAttribute(attr);
  }
  return clone.outerHTML;
}
