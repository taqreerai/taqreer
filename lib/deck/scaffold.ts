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

import { SLIDE_ROLE_VALUES } from "@/lib/schema/slide";

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

// Mirror the section's data-role value into its class list. The model
// sometimes styles slides BY ROLE NAME (`.cover h1{…}`) while only marking
// the section `data-role="cover"` (observed 2026-06-13, opus-fast: the whole
// cover rendered default-size). Mirror ONLY the known role vocabulary
// (mirrors SLIDE_ROLES in deck-generate) — an arbitrary data-role value would
// widen the class-collision surface the scoper's compound-arm filter guards
// against for no benefit.
const ROLE_ATTR = /\bdata-role\s*=\s*"([a-z-]+)"/i;
const MIRRORED_ROLES = new Set<string>(SLIDE_ROLE_VALUES);

export function withCanvasClass(sectionHtml: string): string {
  return stampCanvasClass(sectionHtml, /<section\b([^>]*)>/i, "section");
}

// Generic stamping core: withCanvasClass targets `<section>` (the generation
// contract); enforceCanvasFrame falls back to a `<div>` root because the
// partial-regen model was historically prompted for one — those slides
// previously got NO scope class, so their rescoped stylesheet matched
// nothing (audit 2026-07-08 FIX B).
function stampCanvasClass(
  html: string,
  openTag: RegExp,
  tag: "section" | "div",
): string {
  return html.replace(openTag, (full, attrs: string) => {
    const rawRole = attrs.match(ROLE_ATTR)?.[1] ?? null;
    const role = rawRole && MIRRORED_ROLES.has(rawRole) ? rawRole : null;
    const classMatch = attrs.match(CLASS_ATTR);
    if (classMatch) {
      const raw = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "";
      // Preserve single quotes if that's what Claude used; otherwise normalize
      // to double (covers the unquoted case too).
      const quote = classMatch[2] !== undefined ? "'" : '"';
      const classes = raw.split(/\s+/).filter(Boolean);
      if (role && !classes.includes(role)) classes.push(role);
      if (!classes.includes(CANVAS_CLASS)) classes.unshift(CANVAS_CLASS);
      const newAttrs = attrs.replace(
        CLASS_ATTR,
        `class=${quote}${classes.join(" ")}${quote}`,
      );
      return `<${tag}${newAttrs}>`;
    }
    void full;
    const classes = role ? `${CANVAS_CLASS} ${role}` : CANVAS_CLASS;
    return `<${tag} class="${classes}"${attrs}>`;
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

// The enforced frame CSS for a given canvas size — shared by buildSlideHtml
// (generation) and enforceCanvasFrame (partial regen, which splices model
// output without rebuilding the slide and previously never re-applied it).
//
// It pins the section's GEOMETRY no matter what the authored CSS says
// (background / padding / display / colour stay Claude's, cascaded per-prop).
// Three layers of armor (audit 2026-07-08, the `.tq-canvas.content` inset bug
// that displaced a live deck's canvas):
//   • doubled class = (0,2,0) specificity, so role-mirrored compounds like
//     `.tq-canvas.content{position:absolute;inset:…}` no longer outrank it;
//   • appended LAST, so it wins every equal-specificity tie;
//   • `!important` on each declaration, so an authored `!important` at equal
//     or higher specificity can't re-displace the canvas.
// `inset:auto` neutralizes the over-constrained-absolute case (under
// dir="rtl" right/top win and shift the canvas); margin/transform/zoom/
// max/min/float resets close the same family; `isolation:isolate` makes the
// section a stacking context so a child's negative z-index paints above the
// section background (matches author intent AND dom-to-pptx's DOM ordering).
export function canvasFrameCss(canvas: { width: number; height: number }): string {
  return (
    `.tq-canvas.tq-canvas{box-sizing:border-box!important;position:relative!important;` +
    `inset:auto!important;width:${canvas.width}px!important;height:${canvas.height}px!important;` +
    `overflow:hidden!important;margin:0!important;transform:none!important;` +
    `translate:none!important;rotate:none!important;scale:none!important;zoom:1!important;` +
    `max-width:none!important;max-height:none!important;min-width:0!important;` +
    `min-height:0!important;float:none!important;isolation:isolate!important;}` +
    `.tq-canvas *{box-sizing:border-box;}`
  );
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
  const styleTag = `<style>${scopedStyleCss}\n${canvasFrameCss(canvas)}</style>`;
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

// Partial-regen enforcement: the regen path splices the model's returned
// section verbatim (it never passes buildSlideHtml), so historically a regen'd
// slide carried NO scope class and NO enforced frame — whatever geometry the
// model emitted was final, persisted in both slideJson stores. Stamp the
// class and append the frame as a trailing <style> INSIDE the section (last
// stylesheet = wins order ties; a model-copied older frame earlier in the
// CSS is simply outranked).
export function enforceCanvasFrame(
  sectionHtml: string,
  canvas: { width: number; height: number },
): string {
  // Stamp the scope class on the section root; when the model returned a
  // `<div>` root instead (the regen prompt historically asked for one),
  // stamp the first div. Both shapes are live in stored regen output.
  const hasSection = /<section\b/i.test(sectionHtml);
  const withClass = hasSection
    ? withCanvasClass(sectionHtml)
    : stampCanvasClass(sectionHtml, /<div\b([^>]*)>/i, "div");
  const frameTag = `<style>${canvasFrameCss(canvas)}</style>`;
  // Insert before the LAST closing tag of the SAME root type we stamped —
  // an end-anchored match would miss when the model appended trailing junk
  // after the root, leaving the <style> outside any element (the sanitizer's
  // DOMParser round-trip can drop it there). CR PR #117.
  const closeTag = hasSection ? "</section>" : "</div>";
  const at = withClass.toLowerCase().lastIndexOf(closeTag);
  if (at === -1) return `${withClass}${frameTag}`;
  return `${withClass.slice(0, at)}${frameTag}${withClass.slice(at)}`;
}
