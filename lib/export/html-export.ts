"use client";

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import type { SlideManifest } from "@/lib/schema/slide";
import { dimensionsForFormat } from "@/lib/schema/slide";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import {
  downloadBlob,
  fixBiDiInPptxBlob,
  makeStats,
  type BiDiPostprocessStats,
} from "@/lib/export/bidi-postprocess";
import { extractGradientIntents } from "@/lib/export/gradient-text";
import { compressPptxMedia } from "@/lib/export/compress-pptx-media";
import { watermarkGeometry, watermarkImage, watermarkSide } from "@/lib/export/free-branding";
import {
  embedConvertedFontsInPptx,
  type ConvertedFont,
  type EmbedFontStats,
} from "@/lib/export/embed-fonts-client";

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

// SVG `pathLength` (2026-10-04): Claude draws donut / ring charts as stacked
// <circle>s with pathLength="100" so stroke-dasharray reads as percentages
// ("36 64" = a 36% arc). Browsers honour pathLength; PowerPoint's SVG renderer
// ignores it and reads the dashes as raw user units, so on an r=150 ring
// (~942 units round) every arc repeats ~9 times and the donut exports as a
// striped starburst. Rescale the dash values to the shape's REAL length
// (getTotalLength ignores pathLength) and drop the attribute, so the exported
// SVG means the same thing without it. Offscreen DOM only.
function normalizeSvgPathLength(root: HTMLElement): void {
  const shapes = root.querySelectorAll<SVGGeometryElement>("svg [pathLength]");
  for (const el of Array.from(shapes)) {
    const declared = parseFloat(el.getAttribute("pathLength") ?? "");
    if (typeof el.getTotalLength !== "function" || !(declared > 0)) continue;
    let real = 0;
    try {
      real = el.getTotalLength();
    } catch {
      continue;
    }
    if (!(real > 0)) continue;
    const k = real / declared;
    const cs = window.getComputedStyle(el);
    const dashes = cs.strokeDasharray;
    if (dashes && dashes !== "none") {
      const scaled = dashes
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((v) => String(parseFloat(v) * k))
        .join(" ");
      el.setAttribute("stroke-dasharray", scaled);
      el.style.strokeDasharray = scaled;
    }
    const offset = parseFloat(cs.strokeDashoffset);
    if (Number.isFinite(offset) && offset !== 0) {
      el.setAttribute("stroke-dashoffset", String(offset * k));
      el.style.strokeDashoffset = String(offset * k);
    }
    el.removeAttribute("pathLength");
  }
}

// Donut slices as ARCS (2026-10-04). Even with real-unit dashes, the export
// misplaces each slice: the dash LENGTH survives but stroke-dashoffset (the
// slice's start position) does not, so the rings came out rotated with gaps.
// A <circle> whose dash pattern draws ONE arc per revolution is rewritten as
// an explicit <path> arc from its start angle to its end angle, with no dashes
// at all, which every renderer draws the same. SVG geometry: a circle's stroke
// starts at 3 o'clock (cx + r, cy) and runs clockwise; a dashoffset `o` moves
// the dash start to arc length -o. Repeating dash patterns (decorative dashed
// rings) and full circles are left alone. Runs after normalizeSvgPathLength,
// so dash values are already in user units. Offscreen DOM only.
const SVG_NS = "http://www.w3.org/2000/svg";
function donutCirclesToArcs(root: HTMLElement): void {
  const circles = root.querySelectorAll<SVGCircleElement>("svg circle");
  for (const c of Array.from(circles)) {
    const cs = window.getComputedStyle(c);
    if (!cs.strokeDasharray || cs.strokeDasharray === "none") continue;
    const dashes = cs.strokeDasharray
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((v) => parseFloat(v));
    if (dashes.length < 1 || dashes.length > 2 || dashes.some((v) => !Number.isFinite(v))) continue;
    const cx = c.cx.baseVal.value;
    const cy = c.cy.baseVal.value;
    const r = c.r.baseVal.value;
    if (!(r > 0)) continue;
    const circumference = 2 * Math.PI * r;
    const dash = dashes[0];
    const period = dashes.length === 2 ? dashes[0] + dashes[1] : dashes[0] * 2;
    // One arc per revolution only; a full ring or an empty dash stays as is.
    if (period < circumference * 0.98) continue;
    if (!(dash > 0) || dash >= circumference * 0.999) continue;
    const offset = parseFloat(cs.strokeDashoffset) || 0;
    const a0 = -offset / r;
    const a1 = a0 + dash / r;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const largeArc = dash / r > Math.PI ? 1 : 0;
    const path = document.createElementNS(SVG_NS, "path");
    for (const attr of Array.from(c.attributes)) {
      if (["cx", "cy", "r", "pathLength", "stroke-dasharray", "stroke-dashoffset"].includes(attr.name)) continue;
      path.setAttribute(attr.name, attr.value);
    }
    path.setAttribute(
      "d",
      `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`,
    );
    path.style.strokeDasharray = "";
    path.style.strokeDashoffset = "";
    path.setAttribute("fill", "none");
    c.replaceWith(path);
  }
}

// Big titles carry a generous line-height for single-line breathing room
// (often ≥ 1.5, and the Arabic-typography rule asks for it), but on a TWO-line
// heading that ratio becomes a huge gap between the lines: dom-to-pptx converts
// CSS line-height straight into PPTX <a:lnSpc> (absolute points), so a 36pt
// title at line-height 1.5 exports as 54pt line spacing. Force single line
// spacing on TITLES / big text so multi-line headings sit tight.
//
// Targets headings (h1–h6 — Claude's reliable title selector) unconditionally,
// plus any element that DIRECTLY bears text at a large computed font-size (big
// non-heading titles). The direct-text guard on the big-text branch keeps the
// unitless `line-height:1` from cascading onto nested smaller / body text (body
// keeps its Arabic-safe line-height). Offscreen DOM only — the preview is
// untouched.
const BIG_TEXT_PX = 40;
function tightenHeadingLineSpacing(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (/^H[1-6]$/.test(el.tagName)) {
      // A heading is a title — no body text lives inside, so tighten directly.
      el.style.setProperty("line-height", "1", "important");
      continue;
    }
    const fontPx = parseFloat(window.getComputedStyle(el).fontSize) || 0;
    if (fontPx < BIG_TEXT_PX) continue;
    let hasDirectText = false;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) {
        hasDirectText = true;
        break;
      }
    }
    if (hasDirectText) el.style.setProperty("line-height", "1", "important");
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
    const text = tn.nodeValue ?? "";
    if (!text) continue;
    let next = text;
    for (const [re, replacement] of PATTERNS) {
      next = next.replace(re, replacement);
    }
    if (next !== text) tn.nodeValue = next;
  }
}

// Replace every <img src="*.svg"> in the offscreen tree with the actual
// inline <svg> markup fetched from the src URL. dom-to-pptx's svgAsVector
// path only emits OOXML vectors for INLINE <svg> elements — when the
// source is an <img> pointing at an SVG file, dom-to-pptx fetches the
// image and rasterises it to PNG (loses vector fidelity AND blocks
// per-slide recolouring). Inlining the markup before dom-to-pptx walks
// the DOM gives us vector output and an authoring hook for recolouring.
//
// Per-slide recolouring contract:
//   Claude marks an <img> with `data-fill="#hex"` when it wants the logo
//   recoloured for contrast on that slide. The inliner then walks the
//   parsed SVG and overwrites every `fill=` / `stroke=` attribute (except
//   `none`) with that hex. Polychrome logos that should NOT be recoloured
//   simply omit `data-fill` — the SVG inlines with its original fills.
async function inlineSvgImages(root: HTMLElement): Promise<void> {
  // Find <img> tags whose src looks like an SVG file (with or without
  // query string — Supabase Storage signed URLs append a ?token=...).
  const imgs = Array.from(
    root.querySelectorAll<HTMLImageElement>(
      "img[src$='.svg'], img[src*='.svg?']"
    )
  ).filter(
    // Country flags (flagcdn.com) are left as <img> so dom-to-pptx
    // RASTERISES them to PNG. Many national flags carry intricate coats
    // of arms (Spain, Argentina, Brazil, Portugal, Mexico…) whose SVGs
    // use clip-paths / nested <use> / dense path sets that dom-to-pptx's
    // SVG→OOXML vector path can't translate — the flag came out broken in
    // PPTX. Rasterising is reliable for every flag, and at slide-export
    // DPI a flag the size we use is visually identical to a vector. The
    // browser preview + PDF/PNG (Puppeteer) still render the crisp SVG —
    // only this PPTX path rasterises.
    (img) => !/(^|\/\/|\.)flagcdn\.com\//i.test(img.src),
  );
  if (imgs.length === 0) return;

  await Promise.all(
    imgs.map(async (img) => {
      try {
        // Abort the fetch after 8 s so a stuck Supabase signed-URL
        // request doesn't leave the export promise hanging forever
        // (the offscreen DOM stays mounted until tab reload otherwise).
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(img.src, { signal: controller.signal });
        } finally {
          window.clearTimeout(timeoutId);
        }
        if (!res.ok) return;
        const svgText = await res.text();
        const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
        if (parsed.getElementsByTagName("parsererror").length > 0) return;
        const svg = parsed.querySelector("svg");
        if (!svg) return;

        // SANITIZE — slide-authored `img.src` could point to a remote
        // URL whose SVG carries `<script>`, event-handler attributes,
        // `<foreignObject>` (which can host HTML/JS), or external
        // references. Strip those before injecting into the live DOM
        // (this code path runs in the user's browser; the offscreen
        // export tree is still part of `document`). Defence-in-depth
        // on top of the upload-route's MIME / extension whitelist.
        svg.querySelectorAll("script, foreignObject").forEach((el) => el.remove());
        const ALLOWED_HREF_RX = /^(#|data:image\/|https:\/\/)/i;
        const walk = (el: Element) => {
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            // on* event handlers (onclick, onload, etc.).
            if (name.startsWith("on")) {
              el.removeAttribute(attr.name);
              continue;
            }
            // href / xlink:href that point at `javascript:` or
            // off-allowlist destinations.
            if (name === "href" || name === "xlink:href") {
              const v = attr.value.trim();
              if (!ALLOWED_HREF_RX.test(v)) el.removeAttribute(attr.name);
            }
          }
          for (const child of Array.from(el.children)) walk(child);
        };
        walk(svg);

        // Recolour pass — if Claude tagged the img with data-fill="#hex",
        // overwrite every fill / stroke attribute inside the SVG (except
        // "none", which is intentional negative space). Also stamp a root
        // `fill` attribute so SVGs that rely on CSS / inherited fill get
        // the colour applied. Hex is validated cheaply to avoid CSS
        // injection if the data-fill ever comes from untrusted input.
        const requestedFill = img.getAttribute("data-fill");
        const fillHex = requestedFill && /^#[0-9A-Fa-f]{3,8}$/.test(requestedFill)
          ? requestedFill
          : null;
        if (fillHex) {
          svg.querySelectorAll("[fill]").forEach((el) => {
            const f = el.getAttribute("fill");
            if (f && f !== "none") el.setAttribute("fill", fillHex);
          });
          svg.querySelectorAll("[stroke]").forEach((el) => {
            const s = el.getAttribute("stroke");
            if (s && s !== "none") el.setAttribute("stroke", fillHex);
          });
          if (!svg.hasAttribute("fill")) svg.setAttribute("fill", fillHex);
        }

        // Carry the <img>'s sizing onto the <svg> so geometry is preserved.
        // The <img> may have set width/height via attributes, inline style,
        // or external CSS. Read computed style first for the source of truth.
        const computed = window.getComputedStyle(img);
        const w = parseFloat(computed.width);
        const h = parseFloat(computed.height);
        if (Number.isFinite(w) && w > 0) svg.setAttribute("width", String(w));
        if (Number.isFinite(h) && h > 0) svg.setAttribute("height", String(h));
        // Preserve inline style — dom-to-pptx reads it for position/transform
        // pass-through. We drop conflicting width/height inline rules since
        // they're now on the SVG attributes.
        const imgStyle = img.getAttribute("style");
        if (imgStyle) {
          const cleaned = imgStyle
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s && !/^(width|height)\s*:/i.test(s))
            .join("; ");
          if (cleaned) svg.setAttribute("style", cleaned);
        }

        img.replaceWith(svg);
      } catch {
        // Network / parse failure: leave the <img> in place so the export
        // at least has the raster fallback (better than a blank).
      }
    })
  );
}

// Strip inline-element backgrounds (and their padding / border-radius) from
// any descendant inline element (`span`, `em`, `strong`, `b`, `i`, `mark`)
// that sits inside flowing prose. Claude occasionally emits the "highlight
// one word" pattern — `<h1>...<span style="background:#...">word</span>...</h1>` —
// which the browser renders inline cleanly, but dom-to-pptx splits into
// three independent shapes (prefix, fill-bearing middle, suffix) because
// PPT can't apply a background to a text RUN. The three split shapes then
// overlap in PowerPoint thanks to Arabic glyph drift.
//
// Earlier attempt: inject a positioned `<div>` BEHIND the span with the
// same fill to preserve the highlight visual. Removed 2026-05-19 because
// (a) PASS 3 widens the parent heading and PPT wraps to fewer lines than
// the browser → the measured pill position is wrong, and (b) the slide
// root's white background emits AFTER the pill and paints over it. See
// the commit history if you need the full breakdown.
//
// Current behaviour: just NEUTRALISE the inline-background pattern. We
// lose the highlight visual but the heading survives as a single, sane
// text shape — much better than three overlapping fragments. A future
// pass could implement OOXML `<a:highlight>` server-side to restore the
// highlight (wrap-robust by construction), but for now this guard is
// what protects the export from Claude reintroducing the bug.
function stripInlineBackgrounds(root: HTMLElement): void {
  const inlines = Array.from(
    root.querySelectorAll<HTMLElement>(
      "span, em, strong, b, i, mark, u, code",
    ),
  );
  for (const el of inlines) {
    const cs = window.getComputedStyle(el);
    // Only neutralise GENUINE inline highlights — a background applied to
    // words that FLOW within a line of text (display:inline). A span that's
    // been promoted to a box (display:block / inline-block / flex / grid — a
    // standalone styled PILL like slide-5's feature tags, or a flex item,
    // which CSS blockifies to display:block) keeps its fill, padding and
    // radius. The original highlight bug this guards against is an inline
    // <span> inside a heading, which stays display:inline.
    if (cs.display !== "inline") continue;
    const bg = cs.backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
    // Drop background + padding + border-radius. Padding/border-radius
    // were only meaningful in service of the pill visual; without the
    // fill they're invisible and just shift surrounding text-flow.
    el.style.background = "";
    el.style.backgroundColor = "";
    el.style.padding = "";
    el.style.paddingInline = "";
    el.style.paddingLeft = "";
    el.style.paddingRight = "";
    el.style.borderRadius = "";
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

    // Only fire when the parent is a flex / grid container — that's the
    // unambiguous "visual layout intent" signal: Claude used the container
    // as a row of distinct labels (e.g. justify-content: space-between).
    //
    // Earlier versions also fired on any child with an explicit `dir`
    // attribute, on the theory that Claude marks language islands with
    // `<span dir="ltr">English</span>` and wants those split out. That was
    // wrong: <span dir="ltr"> inside an Arabic block-level <p> or <div>
    // is INLINE PROSE, not a separated label — splitting it puts the
    // English on its own shape and breaks the sentence visually
    // (especially when the final period ends up alone too). The author
    // signal for "split" is the LAYOUT (flex/grid), not the `dir`.
    //
    // Skipped: ordinary inline emphasis (<p>عربي <strong>bold</strong> نص</p>),
    // inline language islands (<p>قوالب ل <span dir="ltr">modern</span>.</p>),
    // and any other block-level container with mixed-script inline children.
    const display = window.getComputedStyle(el).display || "";
    const isLayoutContainer =
      display === "flex" ||
      display === "inline-flex" ||
      display === "grid" ||
      display === "inline-grid";
    if (!isLayoutContainer) continue;

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
  fileName: string,
  opts?: {
    skipDownload?: boolean;
    // Free plan (2026-10-02): a PRESENT-READY deck. One full-slide picture per
    // entry (the server's PNG renders, which already carry the "Made with
    // taqreer.ai" watermark + the branded closing slide). Nothing in the file
    // is editable text, so the watermark can't be edited out. Paid plans omit
    // this and get the fully editable deck.
    imageSlides?: string[];
    // Free plan, EDITABLE PPTX (2026-10-05 free trial): the deck language;
    // adds the quiet watermark picture on slides 2+ plus the file credits
    // and the clickable link over the mark.
    freeWatermark?: "ar" | "en";
  }
): Promise<{ stats: BiDiPostprocessStats; slideCount: number; blob?: Blob }> {
  // Slide canvas dimensions from the manifest's format (16:9 → 1920×1080;
  // 9:16 → 1080×1920). Used for the offscreen render container, each
  // slide's inline width/height, dom-to-pptx's PPT layout, and the BiDi
  // post-processor's bounds checks. Falls back to 16:9 for legacy
  // manifests written before the field existed.
  const { width: canvasW, height: canvasH } = dimensionsForFormat(manifest.format);
  const slideFormat = manifest.format === "9:16" ? "9:16" : "16:9";

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
    width: `${canvasW}px`,
    pointerEvents: "none",
    // Keep opacity:1 + visibility:visible explicitly in case parent styles
    // (e.g. a transition or animation) try to inherit something different.
    opacity: "1",
    visibility: "visible",
  });
  document.body.appendChild(container);

  const root = createRoot(container);

  const imageSlides = opts?.imageSlides ?? null;
  const freeWatermark = opts?.freeWatermark
    ? watermarkImage(opts.freeWatermark, { width: canvasW, height: canvasH })
    : null;

  try {
    const slideEls = imageSlides
      ? imageSlides.map((src, i) =>
          createElement(
            "div",
            {
              key: `img-${i}`,
              className: "hx-slide",
              style: { width: canvasW, height: canvasH, marginBottom: 20, position: "relative" as const },
            },
            createElement("img", {
              src,
              alt: "",
              style: { position: "absolute" as const, left: 0, top: 0, width: canvasW, height: canvasH },
            }),
          ),
        )
      : manifest.slides.map((slide, slideIndex) =>
      createElement(
        "div",
        {
          key: slide.slideId,
          className: "hx-slide",
          style: { width: canvasW, height: canvasH, marginBottom: 20, position: "relative" as const },
        },
        createElement(SlideRenderer, {
          slide,
          theme: manifest.theme,
          direction: manifest.direction,
          language: manifest.language,
          width: canvasW,
          height: canvasH,
          scale: 1,
        }),
        // Free plan, editable PPTX: the quiet watermark as a picture on every
        // slide but the cover (lib/export/free-branding watermarkImage).
        freeWatermark && slideIndex > 0
          ? createElement("img", {
              src: freeWatermark.src,
              alt: "",
              "data-tq-watermark": "",
              style: {
                position: "absolute" as const,
                left: freeWatermark.x,
                top: freeWatermark.y,
                width: freeWatermark.width,
                height: freeWatermark.height,
              },
            })
          : null,
      ),
    );
    root.render(createElement("div", { dir: manifest.direction }, slideEls));

    // SlideRenderer sanitises slide HTML inside `useEffect` (client-only,
    // fail-closed). The first commit renders empty containers; useEffect
    // fires after that commit, calls setState, schedules the second
    // commit. A `setTimeout(0)` here flushes the pending microtasks +
    // queues a macrotask, by which point useEffect has run and the
    // re-render has been scheduled. The double-rAF below then settles
    // the second commit's paint.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Wait for React commit + a settled paint frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    // Race every "wait for resource" promise against a hard timeout so
    // export can still proceed in a degraded state (raster img, system
    // font, unstyled fallback) instead of hanging forever — e.g. a
    // Supabase signed URL that 503s without resolving the load event,
    // or a Google Fonts request blocked by an ad-blocker.
    const RESOURCE_TIMEOUT_MS = 8000;
    const raceWithTimeout = (p: Promise<unknown>) =>
      Promise.race([p, new Promise<void>((r) => setTimeout(r, RESOURCE_TIMEOUT_MS))]);

    // Wait for any slide-local <link rel="stylesheet"> to finish loading.
    // The export path allows arbitrary stylesheet links inside slide HTML,
    // and DOMPurify keeps them. dom-to-pptx reads computed styles from the
    // offscreen DOM, so a stylesheet that hasn't applied its rules yet
    // would be measured against the unstyled fallback layout. Same
    // pattern as the <img> + fonts.ready waits below.
    const stylesheets = Array.from(
      container.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    );
    if (stylesheets.length > 0) {
      await raceWithTimeout(
        Promise.all(
          stylesheets.map(
            (link) =>
              new Promise<void>((resolve) => {
                if (link.sheet) {
                  resolve();
                  return;
                }
                const done = () => {
                  link.removeEventListener("load", done);
                  link.removeEventListener("error", done);
                  resolve();
                };
                link.addEventListener("load", done);
                link.addEventListener("error", done);
              })
          )
        )
      );
    }

    // Wait for any webfonts referenced in the manifest to be ready, so
    // dom-to-pptx measures the right glyph metrics.
    if (document.fonts && document.fonts.ready) {
      await raceWithTimeout(document.fonts.ready);
    }

    // Wait for every <img> inside the offscreen tree to finish loading.
    // If we hand the DOM to dom-to-pptx while images are still loading,
    // they'll have 0×0 bounding rects and the library will skip them.
    const images = Array.from(container.querySelectorAll("img"));
    if (images.length > 0) {
      await raceWithTimeout(
        Promise.all(
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
    // Inline any <img src="*.svg"> as actual <svg> markup, applying the
    // optional data-fill recolour. Done BEFORE the sync preprocess passes
    // so the rest of the pipeline walks the inlined SVG (not the img).
    // Runs in parallel across slides — each slide's fetches are independent.
    await Promise.all(slideNodes.map((s) => inlineSvgImages(s)));

    for (const slideNode of slideNodes) {
      normalizeSvgPathLength(slideNode);
      donutCirclesToArcs(slideNode);
      splitMixedScriptFlexChildren(slideNode);
      stripArabicLetterSpacing(slideNode);
      insertScriptTransitionSpaces(slideNode);
      stripInlineBackgrounds(slideNode);
      tightenHeadingLineSpacing(slideNode);
    }

    // Walk the offscreen slides for any element using CSS `background-clip:
    // text` + linear/radial gradient. Each match is mutated in-place to a
    // solid sentinel hex (#FExxxx), and the recipe is stashed in `intents`.
    // dom-to-pptx then emits a normal solidFill on that run with the sentinel
    // colour; PASS 4 of fixBiDiInPptxBlob swaps the solidFill for a real
    // <a:gradFill> built from the recipe.
    const intents = extractGradientIntents(slideNodes);

    // Diagnostic — dev only. Helps compare offscreen render against
    // PPT output during BiDi / layout debugging. Production builds
    // strip this branch via the NODE_ENV guard.
    if (process.env.NODE_ENV !== "production") {
      const firstRect = slideNodes[0].getBoundingClientRect();
      console.log(
        `[html-export] ${slideNodes.length} slides, first rect ${firstRect.width}x${firstRect.height}, ${images.length} images, fonts ready`,
      );
    }

    const [{ exportToPptx }, JSZipImport] = await Promise.all([
      import("dom-to-pptx"),
      import("jszip"),
    ]);
    const JSZip =
      (JSZipImport as { default?: unknown }).default ?? JSZipImport;

    // svgAsVector keeps inline <svg> as native OOXML vectors (editable in
    // PowerPoint, recolourable, infinite zoom). Without it, dom-to-pptx
    // rasterises every SVG to a PNG — Material icons and decorative shapes
    // end up tiny / pixelated / missing depending on viewBox.
    //
    // width / height (in inches) drives dom-to-pptx's `pptx.defineLayout`
    // call so the resulting PPT has the correct page size:
    //   16:9 → 10″ × 5.625″
    //   9:16 → 5.625″ × 10″
    // Without these, the lib defaults to LAYOUT_16x9 and a vertical 9:16
    // deck would render as a landscape PPT with shapes outside the page.
    const slideWidthIn = canvasW / 192; // 1920px → 10″, 1080px → 5.625″
    const slideHeightIn = canvasH / 192;
    const rawBlob = await exportToPptx(slideNodes, {
      fileName,
      skipDownload: true,
      svgAsVector: true,
      width: slideWidthIn,
      height: slideHeightIn,
    } as const);

    if (!(rawBlob instanceof Blob)) {
      throw new Error(
        `html-export: dom-to-pptx returned ${typeof rawBlob}, expected Blob`
      );
    }

    const stats = makeStats();
    // Embed the theme fonts (Google Fonts heading + body, weights 400 + 700).
    // CONVERSION (woff2 → EOT) runs server-side because wawoff2's WASM bridge
    // needs Node's `fs`; the SPLICE runs HERE in the browser. We send only the
    // font URLs (a few hundred bytes) and get back the EOT bytes (~0.5 MB), so
    // the deck never crosses the network — an images-mode deck (15–40 MB) used
    // to blow past the route's body cap and ship with NO embedded fonts, which
    // is what made PowerPoint substitute the heaviest Cairo on edit.
    // Best-effort: any failure falls through with the unembedded blob.
    let fontEmbeddedBlob: Blob = rawBlob;
    try {
      // Google fonts carry a CSS `url`; uploaded brand fonts carry signed
      // `fontFaces` (one font file per uploaded weight). Embed both — the
      // server route host-pins each (fonts.googleapis.com / Supabase storage).
      // Image-only (free) decks carry no text, so there is nothing to embed.
      const fontTargets = (imageSlides ? [] : [manifest.theme.font])
        .filter(
          (f) =>
            f && f.name && (f.url || (f.fontFaces && f.fontFaces.length > 0)),
        )
        .map((f) =>
          f.url
            ? { name: f.name, url: f.url }
            : { name: f.name, faces: f.fontFaces as { weight: number; src: string }[] },
        );
      if (fontTargets.length > 0) {
        const res = await fetch("/api/export/embed-fonts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fonts: fontTargets }),
        });
        if (res.ok) {
          const payload = (await res.json()) as { fonts?: ConvertedFont[] };
          const embedStats: EmbedFontStats = {
            attempted: 0,
            embedded: 0,
            failed: 0,
          };
          fontEmbeddedBlob = await embedConvertedFontsInPptx(
            rawBlob,
            payload.fonts ?? [],
            JSZip,
            embedStats,
          );
          if (process.env.NODE_ENV !== "production") {
            console.log(
              `[html-export] font-embed: attempted=${embedStats.attempted} embedded=${embedStats.embedded} failed=${embedStats.failed}`,
            );
          }
        } else if (typeof console !== "undefined") {
          console.warn(
            `[html-export] font-embed: server returned ${res.status}, continuing without embed`,
          );
        }
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[html-export] font-embed: skipped due to error:", err);
      }
    }
    const fixedBlob = await fixBiDiInPptxBlob(
      fontEmbeddedBlob,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      JSZip as any,
      stats,
      intents,
      slideFormat
    );

    // Free (image-slide) decks: quiet, invisible-on-screen credits (owner
    // direction 2026-10-04) - the file's Company property and a speaker note
    // on the last slide. Best-effort: a failure ships the deck without them.
    let creditedBlob: Blob = fixedBlob;
    if (imageSlides || freeWatermark) {
      try {
        creditedBlob = await addFreeFileCredits(
          fixedBlob,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          JSZip as any,
          slideNodes.length,
          manifest.language === "en" ? "en" : "ar",
          { width: canvasW, height: canvasH },
        );
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("[html-export] free file credits skipped:", err);
        }
      }
    }

    // Recompress embedded media (dom-to-pptx rasterises every image to PNG):
    // opaque parts → JPEG, transparent stay PNG, long edge capped at 1920px.
    // Best-effort — a failure ships the uncompressed (but valid) blob.
    let finalBlob = creditedBlob;
    // Image-slide (free) decks skip recompression: the 2x (3840px) slide
    // renders stay lossless PNG so text is crisp on 4K screens.
    if (!imageSlides) try {
      const mediaStats = {
        scanned: 0,
        recompressed: 0,
        renamed: 0,
        bytesBefore: 0,
        bytesAfter: 0,
      };
      finalBlob = await compressPptxMedia(
        fixedBlob,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        JSZip as any,
        mediaStats,
      );
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[html-export] media-compress: ${mediaStats.recompressed}/${mediaStats.scanned} parts, ${(mediaStats.bytesBefore / 1024 / 1024).toFixed(1)}MB → ${(mediaStats.bytesAfter / 1024 / 1024).toFixed(1)}MB`,
        );
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[html-export] media-compress skipped:", err);
      }
    }

    if (opts?.skipDownload) {
      return { stats, slideCount: slideNodes.length, blob: finalBlob };
    }
    downloadBlob(finalBlob, fileName);

    return { stats, slideCount: slideNodes.length };
  } finally {
    root.unmount();
    container.remove();
  }
}

// ─── Free-plan file credits ─────────────────────────────────────────
// Also: a clickable link over the baked-in "Designed with taqreer" mark on
// every slide but the cover (no mark there), so clicking it in slideshow
// opens taqreer.ai. An invisible rectangle (fill at 0% opacity, which
// PowerPoint still hit-tests) carrying an external hyperlink.
// The Company document property (File > Info in PowerPoint) and a speaker
// note on the LAST slide. Neither shows on screen while presenting. pptxgenjs
// writes an empty notes slide for every slide, so the note goes into the
// existing body placeholder's first run.
const FREE_NOTE = {
  ar: "صُمم هذا العرض باستخدام taqreer (taqreer.ai)",
  en: "Designed with taqreer (taqreer.ai)",
} as const;

async function addFreeFileCredits(
  blob: Blob,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  JSZip: any,
  slideCount: number,
  lang: "ar" | "en",
  canvas: { width: number; height: number },
): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  await addWatermarkLinks(zip, slideCount, lang, canvas);
  const appPath = "docProps/app.xml";
  const app = await zip.file(appPath)?.async("string");
  if (app) {
    zip.file(
      appPath,
      app.replace(/<Company>[^<]*<\/Company>/, "<Company>taqreer</Company>"),
    );
  }
  const notesPath = `ppt/notesSlides/notesSlide${slideCount}.xml`;
  const notes = await zip.file(notesPath)?.async("string");
  if (notes) {
    const rtl = lang === "ar";
    zip.file(
      notesPath,
      notes.replace(
        /(<p:ph type="body" idx="1"\/>[\s\S]*?<a:p>)(<a:r><a:rPr lang="en-US" dirty="0"\/>)<a:t>([^<]*)<\/a:t>/,
        (_m: string, head: string, _run: string, existing: string) =>
          `${head.replace(/<a:p>$/, rtl ? '<a:p><a:pPr rtl="1" algn="r"/>' : "<a:p>")}<a:r><a:rPr lang="${rtl ? "ar-SA" : "en-US"}" dirty="0"/><a:t>${existing ? `${existing} ` : ""}${FREE_NOTE[lang]}</a:t>`,
      ),
    );
  }
  return zip.generateAsync({ type: "blob" });
}

const WATERMARK_LINK_SHAPE_ID = 9001;

async function addWatermarkLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip: any,
  slideCount: number,
  lang: "ar" | "en",
  canvas: { width: number; height: number },
): Promise<void> {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const sz = pres?.match(/<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!sz) return;
  const emu = Number(sz[1]) / canvas.width; // EMU per slide pixel
  // Same geometry as lib/export/free-branding watermarkHtml (x0.8 scale).
  // The mark's width depends on the font, so the hit box is a little wider
  // than the drawn pill; a few extra pixels of corner are harmless.
  const base = watermarkGeometry(canvas);
  const h = Math.round(base.height * 0.8);
  const w = Math.round(h * 5.8);
  const x = watermarkSide(lang) === "left" ? base.margin : canvas.width - base.margin - w;
  const y = canvas.height - base.margin - h;
  const url = `https://taqreer.ai/${lang}?utm_source=pptx&amp;utm_medium=watermark`;
  const shape =
    `<p:sp><p:nvSpPr><p:cNvPr id="${WATERMARK_LINK_SHAPE_ID}" name="taqreer"><a:hlinkClick r:id="rIdTqLink"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${Math.round(x * emu)}" y="${Math.round(y * emu)}"/><a:ext cx="${Math.round(w * emu)}" cy="${Math.round(h * emu)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const rel = `<Relationship Id="rIdTqLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${url}" TargetMode="External"/>`;
  // Slide 1 is the cover: no mark, no link.
  for (let n = 2; n <= slideCount; n++) {
    const slidePath = `ppt/slides/slide${n}.xml`;
    const relsPath = `ppt/slides/_rels/slide${n}.xml.rels`;
    const slide = await zip.file(slidePath)?.async("string");
    const rels = await zip.file(relsPath)?.async("string");
    if (!slide || !rels || !slide.includes("</p:spTree>") || rels.includes("rIdTqLink")) continue;
    zip.file(slidePath, slide.replace("</p:spTree>", `${shape}</p:spTree>`));
    zip.file(relsPath, rels.replace("</Relationships>", `${rel}</Relationships>`));
  }
}

