// Phase 17.A/B — Extraction dispatcher.
//
// Pivoted architecture (2026-05-25): Claude reads source files
// natively via Anthropic Files API + `document` block. No local
// pdfjs/canvas rasterization. The dispatcher's job is:
//
//   1. Normalize the input file to PDF (PDFs pass through; PPTXs
//      go through LibreOffice via lib/extract/pptx-to-pdf.ts)
//   2. For PPTX inputs ONLY: extract STRUCTURAL data the PDF
//      doesn't preserve clearly:
//        • Typeface family names from theme XML — used as the
//          brand font baseline; system-vs-custom classification +
//          Google-font resolution happens in deck-generate
//        • Theme palette (Tier-1 accents from <a:clrScheme>) —
//          baseline brand colors shown on the brand step
//      For PDFs these stay empty; Claude reads palette/typefaces
//      visually from the PDF document block.
//
// ─── Asset-extraction removed (2026-05-25) ─────────────────────────
// We used to also pull embedded images (logos, photos) from the
// PPTX zip and upload them to a `project-assets/{jobId}/` Supabase
// bucket, then expose URLs to Claude via `<img src>` references.
// Removed entirely — extracted raster/SVG assets clashed visually
// with Claude's clean inline-SVG output style and made redesigned
// decks look uneven. Claude SEES every asset rendered as pixels
// via the PDF document block; he can recreate what matters and
// skip what doesn't. Brand identity now flows through palette +
// fonts + the PDF itself.
//
// Caller (inngest/functions/extract-source.ts) takes our output,
// uploads the PDF to Anthropic Files API → gets file_id → writes
// the SourceMeta blob with anthropicFileId + fonts + colors.

import { PDFDocument } from "pdf-lib";
import { pptxToPdf, docxToPdf } from "./pptx-to-pdf";
import { extractFontsFromPptx } from "./fonts-pptx";
import { extractColorsFromPptx } from "./colors-pptx";
import { detectPptxLanguage } from "./language-pptx";
import { detectStringLanguage } from "./language-text";
import { extractTextPerSlide } from "./text-pptx";
import { pdfToText } from "./pdf-to-text";

// ─── Public types ─────────────────────────────────────────────────

export type ExtractionInput = {
  buffer: Buffer;
  mime: string;
};

export type ExtractionResult = {
  /** PDF bytes — feed to Anthropic Files API upload. */
  pdfBytes: Buffer;
  /**
   * Page count derived from the PDF (post-LibreOffice for PPTX
   * inputs; native for PDF inputs). Used as the canonical slide
   * count for the generated deck — the /enhance flow no longer
   * shows a manual slide-count picker (user feedback 2026-05-25).
   */
  pageCount: number;
  /**
   * Slide format derived from the FIRST page's aspect ratio:
   *   w >= h  → "16:9"
   *   else    → "9:16"
   * Used as the canonical slide format — /enhance no longer shows
   * a manual size picker.
   */
  format: "16:9" | "9:16";
  /**
   * Typeface family names from the PPTX theme XML. Empty for PDFs.
   * Used as a "preferred fonts" hint to Claude. Classification
   * into system vs custom happens in deck-generate when building
   * the directive.
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
  /**
   * Detected dominant language of the source file. PPTX inputs go
   * through `detectPptxLanguage()` (zip text sampling); PDF inputs now
   * go through `pdfToText()` + `detectStringLanguage()` (2026-07-11 —
   * previously null, which silently defaulted /mimic to Arabic and
   * translated English content). Threaded into the brief so the deck's
   * language/direction follow the SOURCE from the first paint.
   */
  language: "ar" | "en" | null;
  /**
   * Verbatim text per slide in PRESENTATION order (PPTX only — empty
   * for PDFs). Index `i` maps to rendered page `i + 1`. Fed to Claude
   * per slide so the /enhance redesign reproduces content word-for-word.
   */
  textPerSlide: string[];
  /**
   * The whole PDF's text layer as one string (2026-07-11). Empty for
   * PPTX (use textPerSlide) and for scanned/image-only PDFs (no text
   * layer). /mimic inlines this as the content instead of attaching the
   * PDF as a vision block, so Claude reads FACTS and can't reproduce the
   * source document's own boxes/layout as content.
   */
  fullText: string;
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
  const isDocx =
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword";
  const isPdf = mime === "application/pdf";

  if (!isPptx && !isPdf && !isDocx) {
    throw new Error(`Unsupported source MIME for extraction: ${mime}`);
  }

  // Step 1: normalize to PDF. PDFs pass through. PPTX + DOCX go through
  // LibreOffice — see lib/extract/pptx-to-pdf.ts header for the
  // concurrency-safety details (per-call profile dir, etc). DOCX is a
  // /create content source (a Word brief Claude reads as a PDF document
  // block); it has no slide/theme structure, so the PPTX-only extraction
  // below is skipped and its fonts/colours/text stay empty.
  const pdfBytes = isPdf
    ? buffer
    : isDocx
      ? await docxToPdf(buffer)
      : await pptxToPdf(buffer);

  // Step 2: PPTX structural extraction. Each extractor walks the
  // zip directly without rendering. Run in parallel — they share
  // no state. Failures are swallowed (best-effort): we'd rather
  // ship a deck with weaker brand pre-fill than fail the whole
  // extraction for a missing theme accent.
  let fonts: string[] = [];
  let themeColors: string[] | null = null;
  let language: "ar" | "en" | null = null;
  let textPerSlide: string[] = [];
  let fullText = "";
  if (isPptx) {
    const [fontsResult, colorsResult, langResult, textResult] =
      await Promise.allSettled([
        extractFontsFromPptx(buffer),
        extractColorsFromPptx(buffer),
        detectPptxLanguage(buffer),
        extractTextPerSlide(buffer),
      ]);
    if (fontsResult.status === "fulfilled") fonts = fontsResult.value;
    if (colorsResult.status === "fulfilled") themeColors = colorsResult.value;
    if (langResult.status === "fulfilled") language = langResult.value;
    if (textResult.status === "fulfilled") textPerSlide = textResult.value;
  } else if (isPdf || isDocx) {
    // PDF (native) + DOCX (already converted to pdfBytes above) text
    // layer → language + the full content text. Best-effort like the
    // PPTX extractors: a poppler hiccup or a scanned/image-only PDF
    // (no text layer) leaves language null + fullText "" and the flow
    // falls back to the vision document block. 2026-07-11.
    try {
      const text = await pdfToText(pdfBytes);
      if (text) {
        fullText = text;
        language = detectStringLanguage(text);
      }
    } catch (err) {
      // A missing text layer returns "" (no throw); reaching here means a
      // REAL failure - poppler missing on the host, a malformed PDF, or a
      // timeout. Non-fatal (we fall back to the vision document block), but
      // LOG it: a silently-degraded prod (e.g. poppler uninstalled) would
      // otherwise regress language + text fidelity with no signal.
      console.error("[extract] pdfToText failed, falling back to vision:", err);
    }
  }

  // Step 3: read PDF metadata for slide count + format.
  // pdf-lib is in package.json already (used elsewhere). Parsing
  // is ~tens of ms for a typical deck — no measurable overhead.
  //
  // Fail-fast on parse error (CR #36, 2026-05-25). Pre-fix we
  // swallowed the catch + defaulted to pageCount=0 + format="16:9",
  // which let the extraction job "succeed" with unusable metadata —
  // the generated deck would commit to the wrong slide count + size
  // silently. A LibreOffice-converted PDF that pdf-lib can't read is
  // a real failure; surface it so the job marks as failed and the
  // /enhance page shows a clear error instead of a misshapen deck.
  let pageCount: number;
  let format: "16:9" | "9:16";
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pageCount = pdfDoc.getPageCount();
    if (pageCount > 0) {
      const firstPage = pdfDoc.getPage(0);
      const { width, height } = firstPage.getSize();
      format = width >= height ? "16:9" : "9:16";
    } else {
      // 0-page PDF — also unusable. Treat as a parse failure.
      throw new Error("PDF reports zero pages");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // pdf-lib refuses encrypted documents ("Input document to
    // `PDFDocument.load` is encrypted"). That's a user-fixable input
    // problem, not a pipeline fault: say so in a stable phrase the
    // extract-error classifier maps to `pdf_encrypted`
    // (lib/extract/error-codes.ts).
    if (/is encrypted/i.test(message)) {
      throw new Error(
        "This PDF is password-protected: remove the password and upload it again.",
      );
    }
    throw new Error(`Failed to parse normalized PDF metadata: ${message}`);
  }

  return {
    pdfBytes,
    pageCount,
    format,
    fonts,
    colors: themeColors ?? [],
    language,
    textPerSlide,
    fullText,
  };
}
