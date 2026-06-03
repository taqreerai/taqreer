// Server-side counterpart to `lib/export/sanitize.ts`. Same XSS strip +
// same two RTL rewriters; runs inside a JSDOM window so it works in
// Node (Inngest worker, API routes), not just the browser.
//
// Used by:
//   - The thumbnail render pipeline (inngest/functions/thumbnail-render.ts
//     via lib/export/html-document-server.ts) — Puppeteer needs sanitised
//     HTML before screenshotting, identical to what the live preview
//     renders so thumbnails match what the user saw.
//
// Why a duplicate of sanitize.ts and not a shared helper:
//   The RTL rewriters mutate DOM through DOMParser + element style
//   getters/setters. Extracting them into env-agnostic helpers would
//   require threading a DOMParser instance through the API and is
//   meaningful structural surgery on a load-bearing module. Until a
//   third caller appears, duplicating ~150 lines is the lower-risk
//   move — bug-fix discipline is "patch both files when changing
//   rewriter logic". This comment is the canonical pointer.
//
// One JSDOM instance per call: cheap (~1 ms) and avoids carrying any
// state between invocations (DOMPurify hooks, mutated globals).

import { JSDOM } from "jsdom";
import DOMPurifyFactory from "dompurify";
import type { Config } from "dompurify";
import { ALLOWED_FONT_HOSTS } from "@/lib/schema/slide";
import { applyScrimFixes } from "@/lib/export/scrim";
import { applyGridDenseFixes, gridNeedsDense } from "@/lib/export/grid-dense";

const DOMPURIFY_CONFIG: Config = {
  ADD_TAGS: ["style", "link"],
  ADD_ATTR: ["dir", "lang", "viewBox", "preserveAspectRatio", "xmlns"],
  FORBID_TAGS: ["iframe", "object", "embed", "frame", "frameset"],
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
};

type PurifyAPI = {
  sanitize: (source: string, config?: Config) => string;
  addHook?: (
    hook: string,
    cb: (node: Element, data: { tagName?: string }) => void,
  ) => void;
};

type JSDOMWindow = JSDOM["window"];

// Construct a fresh JSDOM window + DOMPurify instance bound to it.
// Returns the {window, purify} pair so the rewriters below can reuse
// the same window's DOMParser without spinning up a second JSDOM.
function buildEnv(): { window: JSDOMWindow; purify: PurifyAPI } {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  // DOMPurify's default export doubles as a factory — invoking it with
  // a window returns an instance with `.sanitize`. Same pattern as the
  // browser path; see lib/export/sanitize.ts for the long-form
  // rationale (SSR-cached singleton lacks `.sanitize`).
  const factory = DOMPurifyFactory as unknown as (
    win: Window,
  ) => Partial<PurifyAPI>;
  const purify = factory(dom.window as unknown as Window);
  if (typeof purify.sanitize !== "function") {
    throw new Error(
      "sanitize-server: DOMPurify factory returned an instance without .sanitize",
    );
  }
  // Mirror the browser-side `<link>` allowlist: strip any stylesheet
  // whose href isn't on the font-host allowlist. Identical hook as
  // sanitize.ts.
  if (typeof purify.addHook === "function") {
    purify.addHook("uponSanitizeElement", (node, data) => {
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
        node.parentNode?.removeChild(node);
      }
    });
  }
  return { window: dom.window, purify: purify as PurifyAPI };
}

/**
 * Server-safe slide-HTML sanitiser. Identical pipeline to the browser
 * variant: DOMPurify XSS strip → RTL flex-end column rewriter → RTL
 * row-flex order rewriter. Always returns a string; logs and returns
 * empty on internal failure (fail-closed, never the raw input).
 */
export function sanitizeSlideHtmlServer(html: string): string {
  try {
    const { window, purify } = buildEnv();
    const clean = purify.sanitize(html, DOMPURIFY_CONFIG);
    return rewriteImageScrim(
      window,
      rewriteRtlImagePanelSide(
        window,
        rewriteRtlMarginAutoEnd(
          window,
          rewriteRtlRowFlexOrder(
            window,
            rewriteRtlFlexEndToFlexStart(
              window,
              rewriteGridAutoFlowDense(window, clean),
            ),
          ),
        ),
      ),
    );
  } catch (err) {
    console.error("[sanitize-server] sanitizeSlideHtmlServer failed:", err);
    return "";
  }
}

// ─── RTL rewriters (server-side mirrors) ──────────────────────────
// Logic is IDENTICAL to lib/export/sanitize.ts — see that file's
// docblocks for the bug each rewriter defends against. The only
// difference is the DOMParser source (JSDOM window instead of the
// real one). When either rewriter's logic changes, update BOTH files.

function rewriteRtlFlexEndToFlexStart(
  window: JSDOMWindow,
  html: string,
): string {
  try {
    const doc = new window.DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const root = doc.body.firstElementChild;
    if (!root) return html;
    const slideRoot = root.firstElementChild as HTMLElement | null;
    if (!slideRoot || slideRoot.getAttribute("dir") !== "rtl") return html;
    const rtlRoot = slideRoot;
    const els = rtlRoot.querySelectorAll<HTMLElement>("[style]");
    let changed = false;
    els.forEach((el) => {
      const closestDir = el.closest("[dir]");
      if (closestDir && closestDir.getAttribute("dir") !== "rtl") return;
      const display = el.style.getPropertyValue("display").trim().toLowerCase();
      if (display !== "flex" && display !== "inline-flex") return;
      const flexDir = el.style
        .getPropertyValue("flex-direction")
        .trim()
        .toLowerCase();
      if (flexDir !== "column" && flexDir !== "column-reverse") return;
      const ai = el.style.getPropertyValue("align-items").trim().toLowerCase();
      if (ai !== "flex-end" && ai !== "end") return;
      const ta = el.style.getPropertyValue("text-align").trim().toLowerCase();
      if (ta === "left" || ta === "start") return;
      const pl = el.style.getPropertyValue("padding-left").trim();
      const pr = el.style.getPropertyValue("padding-right").trim();
      const hasNonZero = (v: string) =>
        v.length > 0 && v !== "0" && v !== "0px" && v !== "0%";
      if (hasNonZero(pl) || hasNonZero(pr)) return;
      el.style.setProperty("align-items", "flex-start");
      changed = true;
    });
    return changed ? root.innerHTML : html;
  } catch {
    return html;
  }
}

function rewriteRtlRowFlexOrder(
  window: JSDOMWindow,
  html: string,
): string {
  try {
    const doc = new window.DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const root = doc.body.firstElementChild;
    if (!root) return html;
    const slideRoot = root.firstElementChild as HTMLElement | null;
    if (!slideRoot || slideRoot.getAttribute("dir") !== "rtl") return html;
    const rtlRoot = slideRoot;
    const rootWidthPx =
      parseFloat(slideRoot.style.getPropertyValue("width")) || 1920;
    const fullWidthThresholdPx = rootWidthPx * 0.62;
    const els = rtlRoot.querySelectorAll<HTMLElement>("[style]");
    let changed = false;
    els.forEach((el) => {
      const closestDir = el.closest("[dir]");
      if (closestDir && closestDir.getAttribute("dir") !== "rtl") return;
      const display = el.style.getPropertyValue("display").trim().toLowerCase();
      if (display !== "flex" && display !== "inline-flex") return;
      const flexDir = el.style
        .getPropertyValue("flex-direction")
        .trim()
        .toLowerCase();
      const isRow = flexDir === "" || flexDir === "row";
      if (!isRow) return;
      const justify = el.style
        .getPropertyValue("justify-content")
        .trim()
        .toLowerCase();
      if (justify === "flex-end" || justify === "end") {
        el.style.setProperty("justify-content", "flex-start");
        changed = true;
        return;
      }
      if (justify && justify !== "flex-start" && justify !== "start") return;
      const position = el.style.getPropertyValue("position").trim().toLowerCase();
      if (position !== "absolute") return;
      const elementChildren = Array.from(el.children).filter(
        (c): c is Element => c.nodeType === 1,
      );
      if (elementChildren.length !== 2) return;
      const leftPx = parseFloat(el.style.getPropertyValue("left")) || 0;
      const rightPx = parseFloat(el.style.getPropertyValue("right")) || 0;
      const widthPx = parseFloat(el.style.getPropertyValue("width")) || 0;
      const looksFullWidth =
        (leftPx > 0 && rightPx > 0 && leftPx < 240 && rightPx < 240) ||
        widthPx > fullWidthThresholdPx;
      if (!looksFullWidth) return;
      el.style.setProperty("flex-direction", "row-reverse");
      changed = true;
    });
    return changed ? root.innerHTML : html;
  } catch {
    return html;
  }
}

// Server mirror of `rewriteRtlMarginAutoEnd` in lib/export/sanitize.ts —
// see that file's docblock for the bug. `margin-right:auto` physically
// pushes a block LEFT; in RTL Claude means it as start-anchoring (visual
// RIGHT), whose physical property is `margin-left:auto`. Swap them.
function rewriteRtlMarginAutoEnd(window: JSDOMWindow, html: string): string {
  try {
    const doc = new window.DOMParser().parseFromString(
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
      if (el.style.getPropertyValue("margin-right").trim().toLowerCase() !== "auto")
        return;
      if (el.style.getPropertyValue("margin-left").trim().toLowerCase() === "auto")
        return; // centered — leave it
      if (el.style.getPropertyValue("text-align").trim().toLowerCase() === "left")
        return; // deliberate left block
      el.style.setProperty("margin-left", "auto");
      el.style.setProperty("margin-right", "0");
      changed = true;
    });
    return changed ? root.innerHTML : html;
  } catch {
    return html;
  }
}

// Server mirror — JSDOM `window.DOMParser`, then the shared core from
// lib/export/grid-dense.ts (same logic the browser twin runs). `gridNeedsDense`
// skips the parse on slides with no pinned grid.
function rewriteGridAutoFlowDense(window: JSDOMWindow, html: string): string {
  if (!gridNeedsDense(html)) return html;
  try {
    const doc = new window.DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const wrapper = doc.body.firstElementChild;
    const slideRoot = wrapper?.firstElementChild as HTMLElement | null;
    if (!slideRoot) return html;
    return applyGridDenseFixes(slideRoot) ? wrapper!.innerHTML : html;
  } catch {
    return html;
  }
}

// Server mirror of `rewriteRtlImagePanelSide` in lib/export/sanitize.ts —
// see that file's docblock for the bug. RTL row-flex with a single in-flow
// image panel + an absolute content layer on the right → reverse so the
// image packs left. Scoped to data-genimage panels.
function rewriteRtlImagePanelSide(window: JSDOMWindow, html: string): string {
  try {
    const doc = new window.DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const wrapper = doc.body.firstElementChild;
    const slideRoot = wrapper?.firstElementChild as HTMLElement | null;
    if (!slideRoot || slideRoot.getAttribute("dir") !== "rtl") return html;
    const lower = (el: Element, p: string) =>
      (el as HTMLElement).style.getPropertyValue(p).trim().toLowerCase();
    const candidates = [
      slideRoot,
      ...Array.from(slideRoot.querySelectorAll<HTMLElement>("[style]")),
    ];
    let changed = false;
    for (const el of candidates) {
      const closestDir = el.closest("[dir]");
      if (closestDir && closestDir.getAttribute("dir") !== "rtl") continue;
      if (lower(el, "display") !== "flex") continue;
      const fd = lower(el, "flex-direction");
      if (fd !== "" && fd !== "row") continue;
      const kids = Array.from(el.children) as HTMLElement[];
      const inFlow = kids.filter((c) => {
        const p = lower(c, "position");
        return p !== "absolute" && p !== "fixed";
      });
      if (inFlow.length !== 1) continue;
      const panel = inFlow[0];
      if (!panel.style.getPropertyValue("width").trim()) continue;
      if (!panel.querySelector("[data-genimage]")) continue;
      const content = kids.find(
        (c) =>
          lower(c, "position") === "absolute" &&
          c.style.getPropertyValue("top").trim() !== "" &&
          c.style.getPropertyValue("bottom").trim() !== "",
      );
      if (!content) continue;
      const left = parseFloat(content.style.getPropertyValue("left")) || 0;
      const right = parseFloat(content.style.getPropertyValue("right")) || 0;
      if (left <= right) continue;
      el.style.setProperty("flex-direction", "row-reverse");
      changed = true;
    }
    return changed ? wrapper!.innerHTML : html;
  } catch {
    return html;
  }
}

// Server mirror of `rewriteImageScrim` in lib/export/sanitize.ts — re-orients
// + softens full-bleed image scrims via the shared lib/export/scrim.ts core.
// Applies to BOTH directions (dark end → text side), so no rtl-only gate.
function rewriteImageScrim(window: JSDOMWindow, html: string): string {
  try {
    const doc = new window.DOMParser().parseFromString(
      `<!DOCTYPE html><div>${html}</div>`,
      "text/html",
    );
    const wrapper = doc.body.firstElementChild;
    const slideRoot = wrapper?.firstElementChild as HTMLElement | null;
    if (!slideRoot) return html;
    const dir = slideRoot.getAttribute("dir") === "ltr" ? "ltr" : "rtl";
    const changed = applyScrimFixes(slideRoot, dir);
    return changed ? wrapper!.innerHTML : html;
  } catch {
    return html;
  }
}
