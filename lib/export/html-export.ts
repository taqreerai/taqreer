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

const STRONG_RTL =
  /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﻿]/;
const LATIN_LETTERS = /[A-Za-z]/;

// Arabic letter-spacing breaks contextual shaping (the letters that should
// connect don't, because letter-spacing inserts a horizontal gap between
// every glyph). Claude is reminded against this in the prompt but still
// occasionally lets `letter-spacing` cascade through to Arabic descendants.
// Walk the offscreen tree, find every element whose computed letter-spacing
// resolves to a non-zero value AND whose direct text contains Arabic
// glyphs, and override letter-spacing to "normal" inline. Latin siblings
// keep their tracking; only the Arabic-bearing elements are reset.
function stripArabicLetterSpacing(root: HTMLElement): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of elements) {
    const ls = window.getComputedStyle(el).letterSpacing;
    if (!ls || ls === "normal" || ls === "0px") continue;
    // Only flatten if THIS element directly bears Arabic text. If a child
    // does, the child's own (likely zero) letter-spacing already applies
    // to its glyphs; we don't need to flatten the ancestor.
    let hasDirectArabic = false;
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE && STRONG_RTL.test(n.textContent ?? "")) {
        hasDirectArabic = true;
        break;
      }
    }
    if (!hasDirectArabic) continue;
    el.style.letterSpacing = "normal";
  }
}

// Claude sometimes emits numbers / Latin words flush against Arabic without
// a separating space ("1إنشاء", "70%faster", "تقريرTAQREER"). The prompt
// rule says to add a space at every script transition; he doesn't always.
// Walk every text node in the offscreen tree and insert a space at any
// adjacency where an Arabic glyph touches a Latin letter or digit (in
// either direction). The space goes into the offscreen DOM only — the
// preview the user is looking at on screen is untouched.
function insertScriptTransitionSpaces(root: HTMLElement): void {
  // Compiled patterns: pairs that need a space between them.
  const PATTERNS: Array<[RegExp, string]> = [
    // Arabic glyph immediately followed by Latin letter
    [/([֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﻿])([A-Za-z])/g, "$1 $2"],
    // Latin letter immediately followed by Arabic glyph
    [/([A-Za-z])([֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﻿])/g, "$1 $2"],
    // Arabic glyph immediately followed by a digit
    [/([֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﻿])([0-9])/g, "$1 $2"],
    // Digit immediately followed by Arabic glyph
    [/([0-9])([֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﻿])/g, "$1 $2"],
  ];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  for (const tn of textNodes) {
    let text = tn.nodeValue ?? "";
    if (!text) continue;
    let next = text;
    for (const [re, replacement] of PATTERNS) {
      next = next.replace(re, replacement);
    }
    if (next !== text) tn.nodeValue = next;
  }
}

function splitMixedScriptFlexChildren(root: HTMLElement): void {
  // querySelectorAll snapshot before mutation so the iteration is stable.
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of elements) {
    const childNodes = Array.from(el.childNodes);

    // Candidates have BOTH direct text AND at least one element child —
    // that's the structural pattern that traps dom-to-pptx's
    // isTextContainer (the element check is one-child-uniform-script).
    let hasDirectText = false;
    const elementChildren: HTMLElement[] = [];
    for (const n of childNodes) {
      if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) {
        hasDirectText = true;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        elementChildren.push(n as HTMLElement);
      }
    }
    if (!hasDirectText || elementChildren.length === 0) continue;

    // Script mix across direct text + element children.
    const scripts = new Set<"rtl" | "ltr">();
    for (const n of childNodes) {
      const text = (n.textContent ?? "").trim();
      if (!text) continue;
      if (STRONG_RTL.test(text)) scripts.add("rtl");
      if (LATIN_LETTERS.test(text)) scripts.add("ltr");
    }
    if (scripts.size <= 1) continue;

    // Two signals tell us this is intentional language separation rather
    // than inline emphasis:
    //   (a) any element child has an explicit `dir` attribute — Claude
    //       writes <em dir="ltr">English</em> to mark the language island.
    //       This is the semantic HTML signal; matches the spec intent of
    //       the `dir` attribute.
    //   (b) parent uses a flex/grid display — Claude used the container
    //       as a visual separator (e.g. justify-content: space-between).
    // Either signal alone triggers the wrap. Together they cover the
    // dir-with-flex case and dir-without-flex case (e.g. a block parent
    // with an explicitly LTR child).
    //
    // Crucially, this skips ordinary inline emphasis like
    //   <p>عربي <strong>bold</strong> نص</p>
    // — no dir on <strong>, p is display:block → neither signal → merge
    // stays, paragraph stays intact, BiDi post-processor handles the
    // multi-script run via lang retag + run merge.
    const hasExplicitDir = elementChildren.some((c) => c.hasAttribute("dir"));
    const display = window.getComputedStyle(el).display || "";
    const isLayoutContainer =
      display === "flex" ||
      display === "inline-flex" ||
      display === "grid" ||
      display === "inline-grid";
    if (!hasExplicitDir && !isLayoutContainer) continue;

    // Wrap each non-empty direct text node in a span at its current slot.
    // The wrapped text now becomes an element child, so patched
    // isTextContainer in dom-to-pptx sees mixed-script element children
    // and recurses — one shape per child at its measured position.
    for (const n of childNodes) {
      if (n.nodeType !== Node.TEXT_NODE) continue;
      const text = n.textContent ?? "";
      if (!text.trim()) continue;
      const span = document.createElement("span");
      span.textContent = text;
      el.replaceChild(span, n);
    }
  }
}

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

    // Mixed-script siblings inside a flex/grid container: Claude often
    // writes <div class="row" style="display:flex"><div>Arabic<em>English</em></div></div>
    // where the Arabic is a direct text node and the English is the only
    // element child. dom-to-pptx's isTextContainer() looks at element
    // children only, sees one LTR <em>, declares the parent a uniform-
    // script text container, and merges everything into one PPT text frame.
    // The English ends up trailing the Arabic on the same line instead of
    // being anchored to the opposite end of the row, as Claude intended.
    //
    // Fix: walk the offscreen DOM and wrap each direct text node in a
    // <span> when its parent is a flex/grid container AND its parent's
    // direct content mixes scripts. This gives every script run its own
    // real element child, which the patched dom-to-pptx isTextContainer
    // now sees as "non-uniform script" → it returns false → the walker
    // recurses → one shape per child at its flex/grid position.
    //
    // Gated on flex/grid specifically so regular prose with inline emphasis
    // (`<p>عربي <strong>bold</strong> نص</p>`) is left alone — that's one
    // paragraph with inline bold, not a row of distinct labels.
    for (const slideNode of slideNodes) {
      splitMixedScriptFlexChildren(slideNode);
      stripArabicLetterSpacing(slideNode);
      insertScriptTransitionSpaces(slideNode);
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
