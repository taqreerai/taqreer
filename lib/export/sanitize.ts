// Shared HTML sanitiser for Claude-authored slide HTML.
//
// Why a shared module:
//   - SlideRenderer (preview) sanitises client-side via useEffect.
//   - html-document (downloadable .html artifact) sanitises before splicing
//     each slide into the document body.
//   Both call sites must use the same config; otherwise the preview and the
//   exported .html could diverge in what's allowed.
//
// Why we call the DOMPurify factory explicitly with `window`:
//   `dompurify@3.4.3`'s default export is the result of `createDOMPurify()`
//   evaluated at module-load with `getGlobal()`. Under Turbopack's SSR pass
//   there is no `window`, so the cached default export carries only
//   `.version` / `.removed` / `.isSupported` and NOT `.sanitize`. The
//   default export is *also* callable as a factory — `DOMPurifyFactory(win)`
//   returns a fresh instance with `.sanitize`. Calling it with the real
//   `window` from a client-only call site dodges the SSR singleton entirely.
//
// Trust model:
//   - HTML is produced by Claude per the user's brief.
//   - Sanitising client-side is defence-in-depth. The PROPER pre-launch fix
//     is server-side sanitisation in `inngest/functions/deck-generate.ts`
//     before the manifest is written to `PresentationVersion.slideJson`.
//   - Allowed tags include <style>, <link rel="stylesheet">, <svg> etc. —
//     Claude needs these for typography, gradients, icons, decorative shapes.
//   - <script>, event handlers (`onclick=...`), `javascript:` URIs are
//     blocked by DOMPurify's default profile + our FORBID_TAGS additions.

import DOMPurifyFactory from "dompurify";
import type { Config } from "dompurify";
import { ALLOWED_FONT_HOSTS } from "@/lib/schema/slide";

export type DOMPurifyAPI = {
  sanitize: (source: string, config?: Config) => string;
  addHook?: (
    hook: string,
    cb: (node: Element, data: { tagName?: string }) => void
  ) => void;
};

export const DOMPURIFY_CONFIG: Config = {
  ADD_TAGS: ["style", "link"],
  ADD_ATTR: ["dir", "lang", "viewBox", "preserveAspectRatio", "xmlns"],
  FORBID_TAGS: ["iframe", "object", "embed", "frame", "frameset"],
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
};

/**
 * Build a DOMPurify instance backed by the current `window`. MUST be called
 * from a client-side execution context — throws if `window` is undefined or
 * the factory shape is unexpected.
 *
 * Re-builds on each call because the underlying DOMPurify instance is
 * cheap to create and using a fresh one avoids any state carried between
 * sanitize calls (hooks, allowed tag mutations, etc.).
 */
export function getClientDOMPurify(): DOMPurifyAPI {
  if (typeof window === "undefined") {
    throw new Error(
      "getClientDOMPurify: called from a non-browser context. Slide HTML " +
        "must be sanitised client-side (or upstream in deck-generate.ts)."
    );
  }
  // The default export is the result of `createDOMPurify()` AND is also
  // callable as the factory itself. Call it with the live window to bypass
  // any SSR-loaded singleton that lacks .sanitize.
  const factory = DOMPurifyFactory as unknown as (
    win: Window
  ) => Partial<DOMPurifyAPI>;
  const instance = factory(window);
  if (typeof instance.sanitize !== "function") {
    throw new Error(
      "getClientDOMPurify: factory returned an instance without .sanitize. " +
        "DOMPurify version may have changed; check the export shape."
    );
  }
  // Defence-in-depth for `<link>`: ADD_TAGS allows the tag because slides
  // legitimately embed `<link rel="stylesheet" href="...">` for webfonts.
  // But CR flagged that this lets a malicious manifest pull *any* remote
  // stylesheet (tracking via CSS, exfil via background-image). Mirror the
  // ALLOWED_FONT_HOSTS check from the Zod schema here so the sanitiser
  // strips any `<link>` whose href isn't on the allowlist. Belt + braces:
  // even if a manifest sneaks past Zod (e.g. via the streaming path before
  // final validation), the renderer still won't inject it.
  if (typeof instance.addHook === "function") {
    instance.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName !== "link") return;
      const href = node.getAttribute?.("href") ?? "";
      let allowed = false;
      try {
        const url = new URL(href);
        allowed = ALLOWED_FONT_HOSTS.has(url.hostname);
      } catch {
        allowed = false;
      }
      if (!allowed) {
        // Remove from the tree. DOMPurify's uponSanitizeElement is the
        // recommended hook for this; replacing the tag name with an empty
        // string also works but leaves a stub.
        node.parentNode?.removeChild(node);
      }
    });
  }
  return instance as DOMPurifyAPI;
}

/**
 * Sanitise a Claude-authored slide HTML string. Always returns a safe
 * string — on any failure (DOMPurify unavailable, factory shape changed,
 * sanitize threw) returns an empty string and logs a console error.
 * **Never returns the raw input** — fail-closed by design so a sanitiser
 * bug can't become an XSS vector.
 *
 * Pipeline:
 *   1. DOMPurify with our config (XSS strip + font-link allowlist hook)
 *   2. `rewriteRtlFlexEndToFlexStart` — column-flex `align-items:flex-end`
 *      lands on the visual LEFT in RTL; corrects to `flex-start`
 *   3. `rewriteRtlRowFlexOrder` — explicit `justify-content:flex-end` AND
 *      the 2-item full-width split-screen case in RTL row-flex; corrects
 *      to `flex-start` / `row-reverse` respectively
 *
 * Both rewriters are scoped to elements inside an RTL slide root with
 * `dir="ltr"` sub-trees opted out. LTR slides pass through DOMPurify
 * only. See each rewriter's own docstring for the exact bug they catch.
 */
export function sanitizeSlideHtml(html: string): string {
  try {
    const dp = getClientDOMPurify();
    const clean = dp.sanitize(html, DOMPURIFY_CONFIG);
    return rewriteRtlRowFlexOrder(rewriteRtlFlexEndToFlexStart(clean));
  } catch (err) {
    console.error("[sanitize] sanitiseSlideHtml failed:", err);
    return "";
  }
}

// ─── RTL rewriter helpers ────────────────────────────────────────
// The two rewriters below share the same scaffold (SSR guard,
// DOMParser, slide-root detection, RTL gate, `dir="ltr"` opt-out,
// per-element walk, changed/return contract). Lifted into one
// `withRtlStyledElements` so the rule-specific predicates are the
// ONLY part each rewriter expresses. Behavior preserved exactly —
// see the original revision for the per-step rationale that's been
// folded into this single docstring + the rewriter docstrings below.
// (2026-05-27 simplifier pass.)

// CSS zero-length sentinels recognized by `isNonZeroLength` below.
// Lifted to module scope so the predicate isn't allocated per
// styled-element visit.
const ZERO_CSS_LENGTHS = new Set(["", "0", "0px", "0%"]);
function isNonZeroLength(v: string): boolean {
  return !ZERO_CSS_LENGTHS.has(v);
}

// Read a CSS property off the element's inline style, trimmed and
// lowercased. The two predicate-style reads in the rewriters
// (`display`, `flex-direction`, `align-items`, `justify-content`,
// `position`, `text-align`) all want this exact shape.
function styleLower(el: HTMLElement, prop: string): string {
  return el.style.getPropertyValue(prop).trim().toLowerCase();
}

// Parse a CSS length-style property as a float, falling back to
// `fallback` (default 0) when missing or unparseable.
function stylePx(el: HTMLElement, prop: string, fallback = 0): number {
  return parseFloat(el.style.getPropertyValue(prop)) || fallback;
}

// Shared scaffold for the RTL rewriters. Runs `visit` on every
// styled element inside an RTL slide root, with the `dir="ltr"`
// opt-out applied uniformly. `visit` returns true if it mutated the
// element. The function returns `root.innerHTML` if anything
// changed, otherwise the original `html` unchanged. SSR-safe
// (returns the input on server-side calls). All failures fall back
// to returning the input — fail-closed-to-DOMPurify-output by
// design.
//
// The slide root is the wrapper's FIRST element child (we wrapped
// the incoming HTML in a synthetic `<div>` at parse time). We check
// its OWN `dir` attribute — NOT `querySelector('[dir="rtl"]')` —
// because the latter would also match a nested `<div dir="rtl">`
// inside an otherwise-LTR slide and apply the RTL rewrites to its
// subtree.
//
// The `closest('[dir]')` opt-out skips elements that are inside a
// nested `dir="ltr"` override (e.g. a `<div dir="ltr">` wrapping a
// pagination block). Those are intentionally LTR sub-trees and
// their flex alignment should resolve under LTR semantics.
// `closest('[dir]')` returns this element if it has its own `dir`;
// otherwise walks up to the nearest ancestor with one — at minimum
// the slide root (RTL by our pre-filter).
function withRtlStyledElements(
  html: string,
  visit: (el: HTMLElement, slideRoot: HTMLElement) => boolean,
): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const root = doc.body.firstElementChild;
    if (!root) return html;
    const slideRoot = root.firstElementChild as HTMLElement | null;
    if (!slideRoot || slideRoot.getAttribute("dir") !== "rtl") return html;
    const els = slideRoot.querySelectorAll<HTMLElement>("[style]");
    let changed = false;
    els.forEach((el) => {
      const closestDir = el.closest("[dir]");
      if (closestDir && closestDir.getAttribute("dir") !== "rtl") return;
      if (visit(el, slideRoot)) changed = true;
    });
    return changed ? root.innerHTML : html;
  } catch {
    return html;
  }
}

// Defensive rewriter — keeps the prompt's "design RTL natively" rule
// from breaking when Claude slips into a specific CSS misconception.
//
// The bug pattern: a content container inside an RTL slide root uses
// `display: flex; flex-direction: column; align-items: flex-end` to
// right-align the column's children. In RTL the cross axis is
// inline-reversed, so `flex-end` actually pins items to the visual
// LEFT — opposite of what Claude intended. Prompt rule covers it
// (LAYOUT GOTCHAS — "RTL flex columns flip cross-axis alignment")
// but Claude still makes the mistake every few decks, so we correct
// the rendered manifest defensively. Logical `end` resolves the same
// way as `flex-end` for column flex (both = cross-axis end =
// inline-axis end in RTL = LEFT visually), so we cover both.
//
// `flex-start` is never rewritten — in RTL column flex it lands on
// the visual RIGHT, which is the intended title-side anchor.
// `flex-direction: row` is intentionally OUT of scope here — main-axis
// alignment in row flex is a different surface and false-positives
// would be higher (e.g. chrome rows that genuinely want main-axis
// flex-end). Add it only if a real failure mode shows up.
function rewriteRtlFlexEndToFlexStart(html: string): string {
  return withRtlStyledElements(html, (el) => {
    const display = styleLower(el, "display");
    if (display !== "flex" && display !== "inline-flex") return false;
    // Only column / column-reverse. Row + flex-end is a different
    // failure mode (main-axis instead of cross-axis); leave that
    // alone for now.
    const flexDir = styleLower(el, "flex-direction");
    if (flexDir !== "column" && flexDir !== "column-reverse") return false;
    const ai = styleLower(el, "align-items");
    if (ai !== "flex-end" && ai !== "end") return false;
    // INTENT GUARD: if the container carries ANY physical-direction
    // signal (`text-align: left/start`, `padding-left`, `padding-right`,
    // `padding` shorthand with asymmetric L/R), Claude is deliberately
    // composing a LEFT-SIDE block in an RTL slide — e.g. a timeline-step
    // label that sits in the right half of the canvas but is anchored
    // to its own LEFT edge so it reads adjacent to a centred timeline
    // rule. `align-items: flex-end` in that case is CORRECT (RTL column
    // flex's cross-axis end resolves to visual left). The bug we're
    // defending against is the pattern with NO physical hints where
    // Claude reached for flex-end thinking it meant "right-align in
    // RTL"; that one we still flip.
    const ta = styleLower(el, "text-align");
    if (ta === "left" || ta === "start") return false;
    const pl = el.style.getPropertyValue("padding-left").trim();
    const pr = el.style.getPropertyValue("padding-right").trim();
    if (isNonZeroLength(pl) || isNonZeroLength(pr)) return false;
    el.style.setProperty("align-items", "flex-start");
    return true;
  });
}

// Companion to the column-flex rewriter — catches the OTHER way
// Claude flips RTL composition. He writes DOM in LTR-mental order
// (first child = "the thing on the left") then uses
// `flex-direction: row` with no `justify-content`. In RTL, row-flex's
// main axis is inline-reversed, so the FIRST DOM child renders on the
// visual RIGHT — Claude's "left thing" ends up where the Arabic title
// should be, and his Arabic title ends up where decoration should be.
//
// Defensive fix: add `flex-direction: row-reverse` to the eligible
// container. That re-flips the main axis so DOM order maps to LTR
// visual order — first child lands LEFT, second lands RIGHT — which
// is what Claude was thinking when he wrote the DOM.
//
// Scope is intentionally narrow to keep false positives near zero:
//   • RTL slide root only
//   • `display: flex` + `flex-direction: row` (or unset → defaults
//     to row, but Claude almost always sets it explicitly when he
//     wants row, so we require the explicit prop)
//   • Exactly 2 children — the split-screen pattern. Three+ items
//     are typically chrome / nav rows where reversal would break
//     the existing right/left anchoring.
//   • No explicit `justify-content` — chrome rows usually set
//     `space-between` / `flex-end` / etc.; leave those alone.
//   • Container's left+right insets together cover > 50% of the
//     canvas — filters out narrow chrome strips where reversal
//     would surprise.
function rewriteRtlRowFlexOrder(html: string): string {
  return withRtlStyledElements(html, (el, slideRoot) => {
    const display = styleLower(el, "display");
    if (display !== "flex" && display !== "inline-flex") return false;
    // Default flex-direction is "row" — accept empty too.
    const flexDir = styleLower(el, "flex-direction");
    const isRow = flexDir === "" || flexDir === "row";
    if (!isRow) return false;
    const justify = styleLower(el, "justify-content");

    // Case A: explicit `justify-content: flex-end` (or logical `end`)
    // on row-flex. In RTL, main axis is inline-reversed, so flex-end
    // packs items toward the visual LEFT. Claude reaches for it when
    // he wants cards on the right side of the canvas — wrong tool.
    // Rewrite to `flex-start` so they pack toward the main-axis
    // start = the visual RIGHT in RTL.
    if (justify === "flex-end" || justify === "end") {
      el.style.setProperty("justify-content", "flex-start");
      return true;
    }

    // Case B: NO `justify-content` (defaults to flex-start), but DOM
    // order written LTR-mental — first child packs to the visual
    // RIGHT in RTL row-flex, putting Claude's "left thing" where the
    // Arabic title should be. We flip the main axis with row-reverse
    // so DOM order maps to LTR visual order again.
    //
    // Scoped TIGHT to avoid breaking:
    //   • inline icon-plus-text rows nested inside a column (small,
    //     no explicit position) where RTL's natural main-axis-start
    //     anchoring already does the right thing
    //   • chrome rows (3+ items or explicit justify)
    //
    // Signals that this is a TOP-LEVEL content layer (the only kind
    // we want to reverse): `position: absolute` AND wide insets
    // (both sides set, or explicit large width). Without
    // `position:absolute` we leave the row alone — naked
    // `display:flex` rows inside a column-flex parent flow with the
    // parent's intrinsic width, where reversing them packs items to
    // the wrong edge (e.g. the contact-row email/website bug).
    if (justify && justify !== "flex-start" && justify !== "start") return false;
    if (styleLower(el, "position") !== "absolute") return false;
    const elementChildren = Array.from(el.children).filter(
      (c): c is Element => c.nodeType === 1,
    );
    if (elementChildren.length !== 2) return false;
    // Read the slide-root's canvas width so the wide-row threshold
    // scales for both formats — 1920px (16:9) and 1080px (9:16).
    // Without this the detection was tuned for 1920 (widthPx > 1200
    // = ~62 %) and silently dead on 9:16 where a "full-width"
    // container is at most 1080px. Fall back to 1920 if the root's
    // width style is missing or unparseable so legacy manifests
    // behave as they did before.
    const fullWidthThresholdPx = stylePx(slideRoot, "width", 1920) * 0.62;
    const leftPx = stylePx(el, "left");
    const rightPx = stylePx(el, "right");
    const widthPx = stylePx(el, "width");
    const looksFullWidth =
      (leftPx > 0 && rightPx > 0 && leftPx < 240 && rightPx < 240) ||
      widthPx > fullWidthThresholdPx;
    if (!looksFullWidth) return false;
    el.style.setProperty("flex-direction", "row-reverse");
    return true;
  });
}
