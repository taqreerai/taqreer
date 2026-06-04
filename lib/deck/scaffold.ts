// Slide bridge — assembles each Claude-authored `<section>` into a
// self-contained slide for the existing per-slide pipeline (SlideRenderer,
// dom-to-pptx, thumbnails, versioning).
//
// MODEL (2026-06-04, Phase 2): Claude authors its OWN design system. It streams
// ONE `<style>` (CSS variables + component classes built on the injected brand
// vars) followed by the `<section>` slides. We do NOT ship a fixed scaffold. Per
// slide we:
//   1. SCOPE Claude's `<style>` under `.tq-canvas` (lib/deck/scope-css) so its
//      `:root`/`section`/`h1` rules can't leak into Taqreer's own UI;
//   2. ENFORCE the canvas frame (exact W×H + overflow) — the renderer/export
//      contract, not Claude's choice;
//   3. put the `<style>` INSIDE the `<section>` (a leading `<style>` is hoisted
//      to `<head>` by the HTML parser and dropped by the sanitizer's re-parse);
//   4. stamp the `.tq-canvas` scope class on the section.
// The result is a self-contained `slide.html` every downstream consumer renders
// unchanged.

const CANVAS_CLASS = "tq-canvas";

// Stamp the scope class onto a `<section>`'s class list (idempotent), merging
// with any class Claude wrote. Only the FIRST opening `<section …>` is touched.
// Quote-agnostic.
// Matches a class attribute in double-quoted, single-quoted, OR unquoted form.
// Unquoted (`class=slide`, valid HTML) MUST be handled: if we miss it and fall
// to the no-class branch, we emit a SECOND `class="tq-canvas"` → duplicate
// attribute → the browser keeps the first and DROPS Claude's classes (silent
// broken slide). Capture groups: 1=double, 2=single, 3=unquoted.
const CLASS_ATTR = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

export function withCanvasClass(sectionHtml: string): string {
  return sectionHtml.replace(/<section\b([^>]*)>/i, (full, attrs: string) => {
    const classMatch = attrs.match(CLASS_ATTR);
    if (classMatch) {
      const raw = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "";
      // Preserve single quotes if that's what Claude used; otherwise normalize
      // to double (covers the unquoted case too).
      const quote = classMatch[2] !== undefined ? "'" : '"';
      const classes = raw.split(/\s+/).filter(Boolean);
      if (!classes.includes(CANVAS_CLASS)) classes.unshift(CANVAS_CLASS);
      const newAttrs = attrs.replace(
        CLASS_ATTR,
        `class=${quote}${classes.join(" ")}${quote}`,
      );
      return `<section${newAttrs}>`;
    }
    void full;
    return `<section class="${CANVAS_CLASS}"${attrs}>`;
  });
}

// Pull the CSS out of every `<style>…</style>` block in the model's leading
// output (everything it streamed before the first `<section>`), concatenated.
// Returns "" when the model wrote no `<style>` (we then render with just the
// enforced canvas frame + brand vars). DOMPurify-safe: this runs on the raw
// model text, server-side, before storage.
export function extractLeadingStyleCss(leadingHtml: string): string {
  const blocks: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(leadingHtml)) !== null) blocks.push(m[1]);
  return blocks.join("\n").trim();
}

// Build a self-contained slide: the (already-scoped) design-system `<style>` +
// the enforced canvas frame, injected as the section's first child + the scope
// class stamped on.
//
// `scopedStyleCss` is Claude's design system AFTER scopeDeckCss() (scoped once
// per deck, reused for every slide). `canvas` is the exact format size — we
// enforce it AFTER Claude's CSS so the slide is always W×H regardless of what
// Claude wrote (the renderer measures the DOM + the export uses this size).
export function buildSlideHtml(
  sectionHtml: string,
  scopedStyleCss: string,
  canvas: { width: number; height: number },
): string {
  // Enforced canvas frame — wins over Claude's `.tq-canvas{…}` for geometry only
  // (background / padding / display / colour stay Claude's, cascaded per-prop).
  const frame =
    `.tq-canvas{box-sizing:border-box;position:relative;` +
    `width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;}` +
    `.tq-canvas *{box-sizing:border-box;}`;
  const styleTag = `<style>${scopedStyleCss}\n${frame}</style>`;
  const withClass = withCanvasClass(sectionHtml);
  // Inject the `<style>` as the section's FIRST CHILD (a leading `<style>` is
  // hoisted to `<head>` + dropped by the sanitizer's DOMParser round-trip; inside
  // the section it survives, and its scoped rules still match document-wide).
  // Replacer FN so any `$` in the CSS isn't read as a backreference.
  const injected = withClass.replace(
    /<section\b[^>]*>/i,
    (openTag) => `${openTag}${styleTag}`,
  );
  return injected !== withClass ? injected : `${styleTag}${withClass}`;
}
