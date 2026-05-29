// Shared template constants.

// A template captures at most the first N slides of its source deck —
// a template showcases a layout/style, so a handful of slides is enough
// and keeps the stored PDF + thumbnails small. Enforced in two places
// that must agree: the save route (Template.slideCount) and the
// template-render job (PDF + thumbnails are rendered from the capped
// slice).
export const MAX_TEMPLATE_SLIDES = 10;
