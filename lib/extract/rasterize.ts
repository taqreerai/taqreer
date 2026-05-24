// Phase 17.A — Slide rasterization for upload-driven flows.
//
// Takes an uploaded file (PDF in 17.A; PPTX in 17.B once LibreOffice
// lands on the host) and returns one PNG per slide/page. Used by:
//   • lib/extract/index.ts as the first step of every extraction
//   • The Mimic flow's "design reference" rasterization too
//
// PNGs land in caller's memory; the caller is responsible for
// uploading them to Supabase under `extract-temp/{jobId}/` and
// returning the URLs in SourceMeta. Rasterizer doesn't touch
// storage — pure transform.
//
// ─── Server-only ──────────────────────────────────────────────────
// pdfjs-dist v5 + @napi-rs/canvas are server-side bindings. This
// file should NEVER end up in a client bundle. The "node:" imports
// (path, url) make accidental client imports fail fast at bundle
// time.

import { Canvas, type CanvasRenderingContext2D } from "@napi-rs/canvas";

// pdfjs-dist v5 ships ESM-only. We import the legacy build because
// the modern build assumes a DOM-y environment (DOMMatrix, etc.) at
// module load time, which Node doesn't have. The legacy build only
// requires DOMMatrix when it actually renders — and our canvas
// factory below provides it via the canvas context.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");
type PDFDocumentProxy = unknown;
type PDFPageProxy = {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (params: unknown) => { promise: Promise<void> };
  cleanup: () => void;
};

export type RasterizeOptions = {
  // Output PNG dimensions. Phase 17 targets 1920×1080 for 16:9 decks
  // and 1080×1920 for 9:16 — the rasterizer can't infer the target
  // ratio from the input file (PDFs can be any size), so callers
  // pass the spec they want and we scale-to-fit while preserving the
  // page's own aspect ratio (letterboxing on a transparent
  // background when the source ratio doesn't match the target).
  width: number;
  height: number;
};

export type RasterizedSlide = {
  index: number;   // 1-based page number — matches user-facing slide numbering
  png: Buffer;     // raw PNG bytes
};

// ─── PDF rasterization ─────────────────────────────────────────────
// Renders each page via pdfjs-dist onto a @napi-rs/canvas Canvas at
// the requested dimensions. Aspect-ratio mismatch (e.g. a portrait
// PDF rasterized to a 16:9 1920×1080 canvas) is handled with a
// fit-inside scale + centered placement; the surrounding canvas
// stays transparent so downstream consumers can letterbox or crop
// as needed.
export async function rasterizePdf(
  pdfBuffer: Buffer,
  options: RasterizeOptions,
): Promise<RasterizedSlide[]> {
  const { width: targetW, height: targetH } = options;

  // `data` is the right input for in-memory PDF bytes; `url` would
  // fetch from a URL and is the wrong choice here. `disableWorker`
  // keeps the parse on the main loop — Node doesn't need a separate
  // worker process and the alternative requires registering a worker
  // script which adds setup we don't need.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    // pdfjs polls these to draw vector text and fills. We're not
    // running fonts through the rasterizer for now — Claude reads
    // text from the rendered image, which means we don't need
    // pixel-perfect font rendering, just visual approximation.
    standardFontDataUrl: undefined,
  });
  const pdf = (await loadingTask.promise) as PDFDocumentProxy & {
    numPages: number;
    getPage: (n: number) => Promise<PDFPageProxy>;
    cleanup: () => Promise<void>;
    destroy: () => Promise<void>;
  };

  const out: RasterizedSlide[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      // Get the unscaled viewport to learn the page's intrinsic
      // dimensions. PDFs measure in PostScript points (1pt = 1/72").
      const unscaled = page.getViewport({ scale: 1 });
      // Fit-inside scale: largest scale that keeps the page within
      // the target box on both axes. Aspect-ratio mismatch → one
      // dimension gets letterboxed (transparent background).
      const scale = Math.min(
        targetW / unscaled.width,
        targetH / unscaled.height,
      );
      const scaled = page.getViewport({ scale });

      // Canvas is always the TARGET size (so all output PNGs are
      // uniform); we draw the scaled page centered within it.
      const canvas = new Canvas(targetW, targetH);
      const ctx = canvas.getContext("2d") as unknown as
        CanvasRenderingContext2D & {
          // pdfjs writes a `_transformMatrix` property; our @napi-rs/canvas
          // ctx doesn't declare it in its public types but does support
          // the API surface pdfjs touches at runtime.
          [key: string]: unknown;
        };

      // White background — PDFs sometimes assume an opaque white
      // page (e.g. text without an explicit background fill); a
      // transparent canvas would render those as black. Matches what
      // Acrobat Reader and Chrome's PDF viewer do.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, targetW, targetH);

      // Center the scaled page within the canvas.
      const dx = (targetW - scaled.width) / 2;
      const dy = (targetH - scaled.height) / 2;
      ctx.translate(dx, dy);

      await page.render({
        canvasContext: ctx,
        viewport: scaled,
      } as unknown as Parameters<PDFPageProxy["render"]>[0]).promise;

      // PDFs can hold onto rendered resources — cleanup() frees the
      // per-page intermediate buffers. Without it a large PDF leaks
      // memory across pages on the same loading task.
      page.cleanup();

      out.push({
        index: pageNum,
        png: canvas.toBuffer("image/png"),
      });
    }
  } finally {
    // Always tear down the document — pdfjs holds parsed structures
    // and a worker (or worker-shim) alive until `destroy()`.
    await pdf.cleanup();
    await pdf.destroy();
  }

  return out;
}

// ─── PPTX rasterization (stub for 17.A; full impl in 17.B) ─────────
// Production path: LibreOffice CLI converts PPTX → PDF, then we
// rasterize the PDF via the function above. LibreOffice is a host-
// level binary (no npm equivalent that's both reliable and free at
// scale), so it's a deployment dep — `brew install --cask
// libreoffice` on Mac, `apt-get install libreoffice` on Linux.
//
// In 17.A we ship PDF-only; PPTX throws a clear error so the Enhance
// /Mimic upload UI can surface "convert your PPT to PDF first" or
// "this feature is coming in the next release." Concrete impl drops
// in 17.B alongside the deployment Dockerfile update.
export async function rasterizePptx(
  _pptxBuffer: Buffer,
  _options: RasterizeOptions,
): Promise<RasterizedSlide[]> {
  throw new Error(
    "PPTX rasterization is not yet wired — install LibreOffice on the " +
      "server and re-run. Tracked as Phase 17.B follow-up. For now, " +
      "convert your deck to PDF before uploading.",
  );
}

// ─── Dispatcher by MIME ────────────────────────────────────────────
// Called from lib/extract/index.ts. Unknown MIME types throw so the
// API route surfaces a clear "unsupported file type" error to the
// client UI.
export async function rasterize(
  buffer: Buffer,
  mime: string,
  options: RasterizeOptions,
): Promise<RasterizedSlide[]> {
  if (mime === "application/pdf") {
    return rasterizePdf(buffer, options);
  }
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint"
  ) {
    return rasterizePptx(buffer, options);
  }
  throw new Error(`Unsupported file type for rasterization: ${mime}`);
}
