// Serialize a live edited slide <section> back to an HTML string suitable for
// persistence (→ sanitizeSlideHtmlServer → slide.html → new SlideVersion).
//
// The in-canvas editor tags the live DOM with editor-only attributes
// (data-tq-id on every element, data-tq-cc on visual leaves) and toggles
// contenteditable while a text run is being edited. None of that belongs in the
// saved source, so we serialize a CLONE with those stripped. The hover/selection
// overlays live OUTSIDE the <section> (appended to the iframe body), so cloning
// the section never captures them.

// Editor-only attributes to strip from the persisted HTML. data-tq-lock (per-layer
// lock) is runtime-only. data-tq-group (canvas grouping) is INTENTIONALLY KEPT — it
// persists so groups survive refresh / navigation / browser close; it's an inert
// data-attribute that dom-to-pptx ignores on export.
const EDITOR_ATTRS = ["data-tq-id", "data-tq-cc", "data-tq-lock", "data-tq-fidx", "contenteditable"] as const;
// Selector for any element carrying one — derived from EDITOR_ATTRS so adding a
// new editor attribute updates both the strip list and the query in one edit.
const EDITOR_ATTR_SELECTOR = EDITOR_ATTRS.map((a) => `[${a}]`).join(",");

// Runtime-only gen-image state classes DeckView toggles on the iframe's boxes
// (retry shimmer / one-shot fade / failed dim). Session state, not content —
// persisting them would freeze a transient look into the saved slide (a
// stored `tq-genimg-live` would shimmer "loading" forever, the exact lie
// PR #185 removes; a stored `tq-genimg-in` would replay its fade on every
// future render).
const TRANSIENT_GENIMG_CLASSES = ["tq-genimg-live", "tq-genimg-in", "tq-genimg-failed"] as const;

export function serializeSlideSection(sec: Element): string {
  const clone = sec.cloneNode(true) as Element;
  // The clone root itself carries data-tq-id (the section is element 0); strip it
  // plus every descendant's editor attributes.
  for (const attr of EDITOR_ATTRS) clone.removeAttribute(attr);
  for (const el of clone.querySelectorAll(EDITOR_ATTR_SELECTOR)) {
    for (const attr of EDITOR_ATTRS) el.removeAttribute(attr);
  }
  for (const el of clone.querySelectorAll(
    TRANSIENT_GENIMG_CLASSES.map((c) => `.${c}`).join(","),
  )) {
    el.classList.remove(...TRANSIENT_GENIMG_CLASSES);
    if (el.classList.length === 0) el.removeAttribute("class");
  }
  return clone.outerHTML;
}
