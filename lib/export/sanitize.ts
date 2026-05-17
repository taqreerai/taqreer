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
 * sanitize threw) returns an empty string and logs a console error. **Never
 * returns the raw input** — fail-closed by design so a sanitiser bug can't
 * become an XSS vector.
 *
 * Post-sanitise pass converts physical CSS L/R properties (`left`, `right`,
 * `padding-left`, …) into their logical equivalents (`inset-inline-start`,
 * `padding-inline-end`, …). See `rewritePhysicalToLogical` below for the why.
 */
export function sanitizeSlideHtml(html: string): string {
  try {
    const dp = getClientDOMPurify();
    const clean = dp.sanitize(html, DOMPURIFY_CONFIG);
    return rewritePhysicalToLogical(clean);
  } catch (err) {
    console.error("[sanitize] sanitiseSlideHtml failed:", err);
    return "";
  }
}

// Inline-style CSS prop name (exact match, lower-cased) → logical
// equivalent. Logical properties resolve to physical based on the
// containing block's writing direction:
//   • LTR  →  inline-start = left,  inline-end = right
//   • RTL  →  inline-start = right, inline-end = left
// Claude generates slide CSS as if it were LTR (calling sides
// "left" / "right" literally). When the slide is rendered with
// `dir="rtl"`, those physical values stay anchored to the visual
// left / right — so a decorative box Claude placed at `right: 0` to
// sit on the start side ends up clashing with the RTL-flowed text.
// Rewriting to logical equivalents makes the WHOLE slide mirror as
// a unit in RTL while leaving LTR slides byte-identical.
const PHYSICAL_TO_LOGICAL: Record<string, string> = {
  left: "inset-inline-start",
  right: "inset-inline-end",
  "padding-left": "padding-inline-start",
  "padding-right": "padding-inline-end",
  "margin-left": "margin-inline-start",
  "margin-right": "margin-inline-end",
  "border-left": "border-inline-start",
  "border-right": "border-inline-end",
  "border-left-width": "border-inline-start-width",
  "border-right-width": "border-inline-end-width",
  "border-left-color": "border-inline-start-color",
  "border-right-color": "border-inline-end-color",
  "border-left-style": "border-inline-start-style",
  "border-right-style": "border-inline-end-style",
};

// Walk the sanitised slide markup and rewrite every inline `style` attr.
// `<style>` blocks intentionally NOT touched — Claude rarely emits them
// and the regex-on-CSS-text risk (false positives in selectors / urls /
// keyframe % values) outweighs the benefit at the volume we see.
//
// Operates on each element's live `CSSStyleDeclaration` rather than
// string-splitting on `;` — a naive split would corrupt values that
// legitimately carry semicolons inside parens (e.g. `background-image:
// url(data:image/svg+xml;base64,…)`) by treating the inner `;` as a
// declaration boundary.
//
// `text-align` intentionally NOT rewritten. It controls how the text
// sits inside its OWN box, not the box's position on the slide —
// `text-align: left` on a box that lives on the visual left edge
// should keep aligning to the box's left edge in any direction.
// Flipping it to `start` causes RTL slides to flush that text to the
// box's right, which is the wrong corner for anything Claude
// intentionally pinned to a physical side.
//
// Opt-out: elements carrying `data-anchor` are skipped. Used by chrome
// (logo, pagination) where the position is a physical corner the user
// explicitly picked — those should stay anchored to the SAME visual
// corner regardless of slide direction. The prompt tells Claude to
// stamp `data-anchor` on those elements with physical CSS values.
function rewritePhysicalToLogical(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const root = doc.body.firstElementChild;
    if (!root) return html;
    const els = root.querySelectorAll<HTMLElement>(
      "[style]:not([data-anchor]):not([data-anchor] *)",
    );
    let changed = false;
    els.forEach((el) => {
      const before = el.style.cssText;
      for (const [physical, logical] of Object.entries(PHYSICAL_TO_LOGICAL)) {
        const value = el.style.getPropertyValue(physical);
        if (!value) continue;
        const priority = el.style.getPropertyPriority(physical);
        el.style.removeProperty(physical);
        el.style.setProperty(logical, value, priority);
      }
      const floatValue = el.style
        .getPropertyValue("float")
        .trim()
        .toLowerCase();
      if (floatValue === "left" || floatValue === "right") {
        const priority = el.style.getPropertyPriority("float");
        el.style.setProperty(
          "float",
          floatValue === "left" ? "inline-start" : "inline-end",
          priority,
        );
      }
      if (el.style.cssText !== before) changed = true;
    });
    return changed ? root.innerHTML : html;
  } catch {
    // DOMParser failure is unexpected in a browser context; return the
    // unmodified sanitised HTML rather than swallowing the slide.
    return html;
  }
}
