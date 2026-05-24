// Phase 17.A — Extraction dispatcher.
//
// Single entry point that takes an uploaded file (PDF or PPTX) and
// produces the four data streams the upload-driven flows need:
//
//   1. slides         — rasterized PNGs of every page (1920×1080 or
//                       1080×1920 depending on detected ratio)
//   2. embeddedAssets — raw bytes of every <img>-renderable image
//                       found inside the deck, with the slide
//                       indices where each appeared
//   3. fonts          — typeface family names ("Cairo", "IBM Plex
//                       Sans Arabic", ...) preferred by the source
//   4. colors         — brand palette hex strings, ordered by
//                       priority (Tier 1 theme XML > Tier 2 pixel
//                       histogram)
//
// The dispatcher is STORAGE-AGNOSTIC. It returns raw bytes; the
// caller (inngest/functions/extract-source.ts) handles uploading
// slide PNGs to the `extract-temp/{jobId}/` bucket and embedded
// assets to `project-assets/{jobId}/` (then deletes extract-temp
// after deck-generate completes).
//
// ─── Tier strategy for colors ──────────────────────────────────────
// Per the architecture decision in context.md §21:
//   • PPTX input → try Tier 1 (colors-pptx.ts theme XML). If non-
//     null, USE THOSE. Else fall through.
//   • PDF input → Tier 1 doesn't apply, always falls through.
//   • Tier 2 → colors-rasterized.ts pixel histogram on the
//     rasterized PNGs we just produced. Catches logo fills,
//     per-slide overrides, and decks with no theme palette.
// Returns up to 5 colors total. May return fewer if the deck is
// monochrome or the histogram couldn't find enough non-neutral
// candidates (caller's responsibility to supply a default palette
// in that case — typically by reusing the create-flow defaults).

import { rasterize, type RasterizedSlide } from "./rasterize";
import { extractAssetsFromPptx, type ExtractedPptxAsset } from "./assets-pptx";
import { extractFontsFromPptx } from "./fonts-pptx";
import { extractColorsFromPptx } from "./colors-pptx";
import { extractColorsFromSlides } from "./colors-rasterized";

// Cap returned palette at 5 entries. Histogram tier (colors-
// rasterized.ts) already caps at this via TARGET_COUNT; theme tier
// (colors-pptx.ts) can return up to 6 accents — clamp here so the
// API contract stays consistent regardless of which tier won.
const MAX_PALETTE = 5;

// ─── Public types ─────────────────────────────────────────────────

export type ExtractionInput = {
  buffer: Buffer;
  mime: string;
  // Target raster dimensions. Caller passes the spec they want;
  // dispatcher doesn't try to infer the aspect ratio from the file
  // (PDFs can be any size). 16:9 and 9:16 are the two formats
  // Taqreer supports.
  width: number;
  height: number;
};

export type ExtractionResult = {
  /** Rasterized slide PNGs in 1-based page order. */
  slides: RasterizedSlide[];
  /**
   * Embedded image assets pulled from the source. Empty for PDFs in
   * Phase 17.A (PDF image extraction is harder and deferred —
   * Claude still reads the rasterized PNGs and can recreate visuals
   * from those). Always populated for PPTX when present.
   */
  embeddedAssets: ExtractedPptxAsset[];
  /**
   * Typeface family names from the source's theme XML (PPTX) or []
   * for PDFs in 17.A. Used as a "preferred fonts" hint to Claude.
   */
  fonts: string[];
  /**
   * Brand-color palette as hex strings. Tier 1 theme XML if the
   * PPTX has a customized palette; otherwise Tier 2 histogram on
   * the rasterized PNGs. Up to 5 colors, ordered by aggregated
   * frequency. May be empty if the deck is monochrome.
   */
  colors: string[];
  /**
   * Which color tier produced the palette. Diagnostic / for the
   * "extraction quality" indicator on the create-summary page if
   * we ever want to surface it. Not currently shown in UI.
   */
  colorTier: "theme" | "histogram" | "none";
};

// ─── Public API ────────────────────────────────────────────────────

/**
 * Run the full extraction pipeline on an uploaded file.
 *
 * Performance notes:
 *  • Rasterization is the slow step — pdfjs renders one page at a
 *    time, ~1-3s per page on a 1920×1080 target. A 12-slide deck
 *    takes 15-30s. We render serially because pdfjs's worker shim
 *    isn't safe under Promise.all and parallel rendering can race
 *    on shared state.
 *  • Tier 1 / Tier 2 color extraction runs on the in-memory PNGs we
 *    just produced — no extra decode cost.
 *  • PPTX asset extraction is fast — zip seek + xmldom parse.
 *
 * Throws if rasterization fails (file isn't a parseable PDF/PPTX).
 * Embedded-asset / font / color failures are caught internally and
 * silently fall through to defaults — the caller still gets a
 * usable result with just the slide PNGs.
 */
export async function extract(
  input: ExtractionInput,
): Promise<ExtractionResult> {
  const { buffer, mime, width, height } = input;

  // Step 1: rasterize. This is the throw-y operation — if the file
  // isn't a valid PDF/PPTX, this is where we find out.
  const slides = await rasterize(buffer, mime, { width, height });

  // Step 2-4 only apply to PPTX in Phase 17.A. PDF asset/font
  // extraction is deferred — see context.md §21 for the rationale
  // (Claude reads rasterized PNGs and can recreate from there).
  const isPptx =
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint";

  let embeddedAssets: ExtractedPptxAsset[] = [];
  let fonts: string[] = [];
  let themeColors: string[] | null = null;

  if (isPptx) {
    // Each extractor is independent — run in parallel. They all
    // load the same zip internally; the JSZip instance isn't shared
    // (would need refactoring to share). The duplicated zip parse
    // is fast (~tens of ms) and not worth the indirection.
    const [assetsResult, fontsResult, colorsResult] = await Promise.allSettled([
      extractAssetsFromPptx(buffer),
      extractFontsFromPptx(buffer),
      extractColorsFromPptx(buffer),
    ]);
    if (assetsResult.status === "fulfilled") {
      embeddedAssets = assetsResult.value;
    }
    if (fontsResult.status === "fulfilled") {
      fonts = fontsResult.value;
    }
    if (colorsResult.status === "fulfilled") {
      themeColors = colorsResult.value;
    }
  }

  // Step 5: color decision. Tier 1 if available, else Tier 2 on
  // the rasterized PNGs we already have in memory.
  let colors: string[] = [];
  let colorTier: ExtractionResult["colorTier"] = "none";

  if (themeColors && themeColors.length > 0) {
    colors = themeColors.slice(0, MAX_PALETTE);
    colorTier = "theme";
  } else {
    try {
      const histogramColors = await extractColorsFromSlides(
        slides.map((s) => s.png),
      );
      if (histogramColors.length > 0) {
        // Histogram tier already caps internally, but slice
        // defensively in case its TARGET_COUNT ever changes.
        colors = histogramColors.slice(0, MAX_PALETTE);
        colorTier = "histogram";
      }
    } catch {
      // Color extraction is nice-to-have; fall back to none and let
      // the caller supply a default palette.
    }
  }

  return {
    slides,
    embeddedAssets,
    fonts,
    colors,
    colorTier,
  };
}

// ─── Re-exports for callers ───────────────────────────────────────
// Callers (inngest extract-source) want the types but not the
// individual extractors directly.
export type { RasterizedSlide } from "./rasterize";
export type { ExtractedPptxAsset } from "./assets-pptx";
