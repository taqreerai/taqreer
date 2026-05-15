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
 */
export function sanitizeSlideHtml(html: string): string {
  try {
    const dp = getClientDOMPurify();
    return dp.sanitize(html, DOMPURIFY_CONFIG);
  } catch (err) {
    console.error("[sanitize] sanitiseSlideHtml failed:", err);
    return "";
  }
}
