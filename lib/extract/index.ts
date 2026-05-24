// Phase 17.A/B — Extraction dispatcher.
//
// Pivoted architecture (2026-05-25): Claude reads source files
// natively via Anthropic Files API + `document` block. No local
// pdfjs/canvas rasterization. The dispatcher's job is:
//
//   1. Normalize the input file to PDF (PDFs pass through; PPTXs
//      go through LibreOffice via lib/extract/pptx-to-pdf.ts)
//   2. For PPTX inputs ONLY: extract structural data from the zip
//      that Claude can't easily recover from the PDF alone:
//        • Embedded images (logos, photos, separators) → uploaded
//          to project-assets/ so generated HTML can reference them
//          by URL
//        • Typeface family names → Claude uses them as the brand
//          font baseline; resolves to Google Fonts where possible
//        • Theme palette (Tier-1 accents from <a:clrScheme>) →
//          baseline brand colors shown on the /enhance/brand page
//      For PDFs these stay empty; Claude picks up structure from
//      the PDF itself + user fills in brand fields on /enhance/brand.
//
// Caller (inngest/functions/extract-source.ts) takes our output,
// uploads the PDF to Anthropic Files API → gets file_id → writes
// the SourceMeta blob with anthropicFileId + extractedAssets +
// fonts + colors.

import { pptxToPdf } from "./pptx-to-pdf";
import { extractAssetsFromPptx, type ExtractedPptxAsset } from "./assets-pptx";
import { extractFontsFromPptx } from "./fonts-pptx";
import { extractColorsFromPptx } from "./colors-pptx";

// ─── Public types ─────────────────────────────────────────────────

export type ExtractionInput = {
  buffer: Buffer;
  mime: string;
};

export type ExtractionResult = {
  /** PDF bytes — feed to Anthropic Files API upload. */
  pdfBytes: Buffer;
  /**
   * Embedded image assets pulled from the source (PPTX only).
   * Empty for PDFs in 17.B.A — PDF image extraction is harder and
   * deferred. Claude can still re-create visuals from the PDF
   * document block alone.
   */
  embeddedAssets: ExtractedPptxAsset[];
  /**
   * Typeface family names from the PPTX theme XML. Empty for PDFs.
   * Used as a "preferred fonts" hint to Claude.
   */
  fonts: string[];
  /**
   * Brand-color palette as hex strings (PPTX theme accent1..accent6).
   * Empty for PDFs and for PPTXs with an unmodified Office theme
   * (`colors-pptx.ts` returns null in that case → empty here).
   * User can edit/add on the brand page; Claude can also surface
   * colors from the PDF visually.
   */
  colors: string[];
};

// ─── Public API ────────────────────────────────────────────────────

/**
 * Normalize the upload to PDF + extract PPTX structural data.
 *
 * Throws if the file isn't a parseable PDF/PPTX (caller surfaces
 * as a NonRetriable error to Inngest).
 */
export async function extract(
  input: ExtractionInput,
): Promise<ExtractionResult> {
  const { buffer, mime } = input;

  const isPptx =
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint";
  const isPdf = mime === "application/pdf";

  if (!isPptx && !isPdf) {
    throw new Error(`Unsupported source MIME for extraction: ${mime}`);
  }

  // Step 1: normalize to PDF. PDFs pass through. PPTXs go through
  // LibreOffice — see lib/extract/pptx-to-pdf.ts header for the
  // concurrency-safety details (per-call profile dir, etc).
  const pdfBytes = isPdf ? buffer : await pptxToPdf(buffer);

  // Step 2: PPTX structural extraction. Each extractor walks the
  // zip directly without rendering. Run in parallel — they share
  // no state. Failures are swallowed (best-effort): we'd rather
  // ship a deck with weaker brand pre-fill than fail the whole
  // extraction for a missing theme accent.
  let embeddedAssets: ExtractedPptxAsset[] = [];
  let fonts: string[] = [];
  let themeColors: string[] | null = null;
  if (isPptx) {
    const [assetsResult, fontsResult, colorsResult] = await Promise.allSettled([
      extractAssetsFromPptx(buffer),
      extractFontsFromPptx(buffer),
      extractColorsFromPptx(buffer),
    ]);
    if (assetsResult.status === "fulfilled") embeddedAssets = assetsResult.value;
    if (fontsResult.status === "fulfilled") fonts = fontsResult.value;
    if (colorsResult.status === "fulfilled") themeColors = colorsResult.value;
  }

  return {
    pdfBytes,
    embeddedAssets,
    fonts,
    colors: themeColors ?? [],
  };
}

// ─── Re-exports for callers ───────────────────────────────────────
export type { ExtractedPptxAsset } from "./assets-pptx";
