// Layout validator — the deterministic, no-model half of the see-and-fix loop
// (context/plan-create-feedback-loop.md, stage 3a). Renders a deck in OUR
// headless Chromium (the same engine thumbnail-render / PDF export use) and
// reports, per slide, the layout faults a one-shot author can't see:
//
//   • overflow      — a content element spills past the fixed W×H canvas
//                     (the `.tq-canvas{overflow:hidden}` frame clips it
//                     visually, but the geometry is still measurable).
//   • chrome-collision — readable content overlaps a pinned `data-anchor`
//                     chrome element (page number / brandmark / footer) —
//                     i.e. content running into the footer (the live ToC bug).
//
// This is the CHEAP detector: it never calls the model. The fix turn (stage
// 3a.2) feeds these findings back to Claude. Subjective faults (alignment,
// "looks empty", balance) are out of scope here — those need the vision tier.

import puppeteer from "puppeteer";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { dimensionsForFormat, type SlideManifest } from "@/lib/schema/slide";

export type LayoutProblem =
  | { kind: "overflow"; side: "top" | "right" | "bottom" | "left"; px: number; el: string }
  | { kind: "chrome-collision"; el: string; chrome: string };

export type SlideLayoutFindings = { slideId: string; problems: LayoutProblem[] };

// Sub-pixel rounding slack — only flag overflow beyond this.
const OVERFLOW_PX = 2;
// Minimum overlap area (px²) before a content↔chrome overlap counts as a real
// collision (ignores a stray 1px graze).
const COLLISION_AREA = 600;
// Cap reported problems per slide so the fix-turn prompt stays small.
const MAX_PROBLEMS_PER_SLIDE = 8;
const NETWORK_IDLE_TIMEOUT_MS = 30_000;

// Render the deck once and measure every slide. Returns one entry per slide;
// `problems` is empty for a clean slide. Throws on launch/render failure — the
// caller (the gen flow) treats any throw as "ship the draft" (fail-open).
export async function validateLayout(
  manifest: SlideManifest,
): Promise<SlideLayoutFindings[]> {
  const { width, height } = dimensionsForFormat(manifest.format);
  const html = buildHtmlDocumentServer(manifest);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: height + 1, deviceScaleFactor: 1 });
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: NETWORK_IDLE_TIMEOUT_MS,
    });
    // Some bundlers (esbuild/tsx `keepNames`) inject `__name()` wrappers around
    // the NAMED inner helpers of the serialized evaluate function below; those
    // calls run in the browser where `__name` doesn't exist. Define a no-op in
    // the page context first. String form (never transpiled → no injection
    // here); a harmless no-op when `__name` is already defined.
    await page.evaluate(
      "globalThis.__name = globalThis.__name || function (f) { return f; };",
    );
    // Webfonts settle on their own clock; wait so metrics reflect the real font.
    await page.evaluate(
      () =>
        (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready ?? Promise.resolve(),
    );

    // getBoundingClientRect is full-document layout (independent of scroll /
    // viewport), so a single pass measures every slide — no scrolling needed.
    // All geometry below is computed RELATIVE to each slide's `.tq-canvas`
    // frame, so absolute scroll position is irrelevant.
    return (await page.evaluate(
      (W, H, overflowPx, collisionArea, maxProblems) => {
        const describe = (el: Element): string => {
          const cls =
            typeof el.className === "string" && el.className.trim()
              ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
              : el.tagName.toLowerCase();
          const txt = (el.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 40);
          return txt ? `${cls} "${txt}"` : cls;
        };
        const hasDirectText = (el: Element): boolean =>
          Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
          );

        const results: {
          slideId: string;
          problems: (
            | { kind: "overflow"; side: string; px: number; el: string }
            | { kind: "chrome-collision"; el: string; chrome: string }
          )[];
        }[] = [];

        for (const wrap of Array.from(
          document.querySelectorAll("[data-slide-id]"),
        )) {
          const slideId = wrap.getAttribute("data-slide-id") ?? "";
          const canvas =
            (wrap.querySelector(".tq-canvas") as Element | null) ?? wrap;
          const cr = canvas.getBoundingClientRect();
          const problems: (
            | { kind: "overflow"; side: string; px: number; el: string }
            | { kind: "chrome-collision"; el: string; chrome: string }
          )[] = [];

          const chrome = Array.from(canvas.querySelectorAll("[data-anchor]")).map(
            (c) => ({ el: c, r: c.getBoundingClientRect() }),
          );
          const seenOverflow = new Set<string>();

          for (const el of Array.from(canvas.querySelectorAll("*"))) {
            // Skip chrome (and its descendants) — it's MEANT to sit in corners.
            if (el.closest("[data-anchor]")) continue;
            const text = hasDirectText(el);
            // Only "content-ish" boxes: a direct-text element or a leaf with a
            // box. Skips structural containers (which would double-report) and
            // full-bleed background layers (no text → not a collision source).
            if (!text && el.children.length > 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;

            // ── overflow vs the canvas frame (relative coords) ──
            const top = r.top - cr.top;
            const left = r.left - cr.left;
            const bottom = r.bottom - cr.top;
            const right = r.right - cr.left;
            const push = (side: string, px: number) => {
              const key = `${side}:${describe(el)}`;
              if (seenOverflow.has(key)) return;
              seenOverflow.add(key);
              problems.push({ kind: "overflow", side, px: Math.round(px), el: describe(el) });
            };
            if (bottom > H + overflowPx) push("bottom", bottom - H);
            else if (top < -overflowPx) push("top", -top);
            if (right > W + overflowPx) push("right", right - W);
            else if (left < -overflowPx) push("left", -left);

            // ── content running into pinned chrome (text only) ──
            if (text) {
              for (const { el: cEl, r: chR } of chrome) {
                const ox = Math.max(
                  0,
                  Math.min(r.right, chR.right) - Math.max(r.left, chR.left),
                );
                const oy = Math.max(
                  0,
                  Math.min(r.bottom, chR.bottom) - Math.max(r.top, chR.top),
                );
                if (ox * oy > collisionArea) {
                  problems.push({
                    kind: "chrome-collision",
                    el: describe(el),
                    chrome: describe(cEl),
                  });
                  break;
                }
              }
            }
          }
          results.push({ slideId, problems: problems.slice(0, maxProblems) });
        }
        return results;
      },
      width,
      height,
      OVERFLOW_PX,
      COLLISION_AREA,
      MAX_PROBLEMS_PER_SLIDE,
    )) as SlideLayoutFindings[];
  } finally {
    await browser.close();
  }
}

// Convenience: just the slides that have at least one problem.
export function failingSlides(
  findings: SlideLayoutFindings[],
): SlideLayoutFindings[] {
  return findings.filter((f) => f.problems.length > 0);
}
