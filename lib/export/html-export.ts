"use client";

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import type { SlideManifest } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import {
  downloadBlob,
  fixBiDiInPptxBlob,
  makeStats,
  type BiDiPostprocessStats,
} from "@/lib/export/bidi-postprocess";

/**
 * Phase 1 of the html-pivot migration: export the existing JSON manifest
 * as a .pptx via dom-to-pptx + our OOXML BiDi post-processor.
 *
 * Flow:
 *   1. Mount a hidden offscreen DOM with every slide rendered at full
 *      1920×1080 (no scale transform — dom-to-pptx reads
 *      getBoundingClientRect at the real pixel size).
 *   2. Wait for React commit + fonts.ready so measurements are stable.
 *   3. Hand the slide nodes to dom-to-pptx with skipDownload=true so the
 *      library returns the final Blob without auto-downloading.
 *   4. Run bidi-postprocess on the Blob (fixes bodyPr rtlCol, pPr rtl/algn,
 *      run lang, merges per-script-split runs).
 *   5. Trigger the download ourselves, unmount, clean up.
 *
 * This is a stepping-stone export path. Phase 2 will rewrite the system
 * prompt so Claude emits HTML directly and this manifest-rendering hop
 * goes away.
 */
export async function exportManifestAsPptx(
  manifest: SlideManifest,
  fileName: string
): Promise<{ stats: BiDiPostprocessStats; slideCount: number }> {
  const container = document.createElement("div");
  container.setAttribute("data-html-export", "true");
  Object.assign(container.style, {
    position: "fixed",
    // Far offscreen but NOT visibility:hidden or display:none — dom-to-pptx
    // (and most DOM capture libs) skip elements whose computed visibility
    // resolves to "hidden", so the slides would walk as empty even though
    // their bounding rects are fine. Offscreen + opacity:1 is the right
    // trade: not visible to the user, but fully rendered + measurable.
    left: "-99999px",
    top: "0px",
    width: "1920px",
    pointerEvents: "none",
    // Keep opacity:1 + visibility:visible explicitly in case parent styles
    // (e.g. a transition or animation) try to inherit something different.
    opacity: "1",
    visibility: "visible",
  });
  document.body.appendChild(container);

  const root = createRoot(container);

  try {
    root.render(
      createElement(
        "div",
        { dir: manifest.direction },
        manifest.slides.map((slide) =>
          createElement(
            "div",
            {
              key: slide.slideId,
              className: "hx-slide",
              style: { width: 1920, height: 1080, marginBottom: 20 },
            },
            createElement(SlideRenderer, {
              slide,
              theme: manifest.theme,
              direction: manifest.direction,
              language: manifest.language,
              scale: 1,
            })
          )
        )
      )
    );

    // Wait for React commit + a settled paint frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    // Wait for any webfonts referenced in the manifest to be ready, so
    // dom-to-pptx measures the right glyph metrics.
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    // Wait for every <img> inside the offscreen tree to finish loading.
    // If we hand the DOM to dom-to-pptx while images are still loading,
    // they'll have 0×0 bounding rects and the library will skip them.
    const images = Array.from(container.querySelectorAll("img"));
    if (images.length > 0) {
      await Promise.all(
        images.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
              }
              const done = () => {
                img.removeEventListener("load", done);
                img.removeEventListener("error", done);
                resolve();
              };
              img.addEventListener("load", done);
              img.addEventListener("error", done);
            })
        )
      );
    }

    // One more paint frame after everything's loaded, so the browser
    // commits final layout before we measure.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );

    const slideNodes = Array.from(
      container.querySelectorAll<HTMLElement>(".hx-slide")
    );
    if (slideNodes.length === 0) {
      throw new Error("html-export: no slide nodes rendered");
    }

    // Diagnostic — log to console so the user can compare against PPT output.
    if (typeof console !== "undefined") {
      const firstRect = slideNodes[0].getBoundingClientRect();
      console.log(
        `[html-export] ${slideNodes.length} slides, first rect ${firstRect.width}x${firstRect.height}, ${images.length} images, fonts ready`
      );
    }

    const [{ exportToPptx }, JSZipImport] = await Promise.all([
      import("dom-to-pptx"),
      import("jszip"),
    ]);
    const JSZip =
      (JSZipImport as { default?: unknown }).default ?? JSZipImport;

    const rawBlob = (await exportToPptx(slideNodes, {
      fileName,
      skipDownload: true,
      // Keep inline <svg> as native OOXML vectors (editable in PowerPoint,
      // recolourable, infinite zoom). Without this, dom-to-pptx rasterises
      // every SVG to a PNG, including Material icons and decorative shapes —
      // they end up tiny / pixelated / missing depending on viewBox.
      svgAsVector: true,
    } as unknown as { fileName: string })) as unknown as Blob;

    if (!(rawBlob instanceof Blob)) {
      throw new Error(
        `html-export: dom-to-pptx returned ${typeof rawBlob}, expected Blob`
      );
    }

    const stats = makeStats();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fixedBlob = await fixBiDiInPptxBlob(rawBlob, JSZip as any, stats);

    downloadBlob(fixedBlob, fileName);

    return { stats, slideCount: slideNodes.length };
  } finally {
    root.unmount();
    container.remove();
  }
}
