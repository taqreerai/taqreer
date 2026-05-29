// Render a slide manifest to a multi-page PDF buffer (one slide per
// page at canvas dimensions). Shared by the template-render Inngest job
// (stores it) and the project "use as a template" route (uploads it to
// the Anthropic Files API as a Mimic design reference). Server-only —
// pulls in Puppeteer + the JSDOM-backed html-document-server builder.
//
// The caller is responsible for capping the manifest's slide count if
// needed (e.g. MAX_TEMPLATE_SLIDES).

import puppeteer from "puppeteer";
import { dimensionsForFormat, type SlideManifest } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";

export async function renderDeckPdf(manifest: SlideManifest): Promise<Buffer> {
  const { width: canvasW, height: canvasH } = dimensionsForFormat(
    manifest.format,
  );
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: canvasW,
      height: canvasH,
      deviceScaleFactor: 1,
    });
    // `printPageBreaks: true` emits @page + per-slide page-break-after,
    // so page.pdf() paginates one slide per page at canvas dimensions
    // (same recipe as the /export/pdf route).
    await page.setContent(
      buildHtmlDocumentServer(manifest, { printPageBreaks: true }),
      { waitUntil: ["domcontentloaded", "networkidle2"], timeout: 30_000 },
    );
    await page.evaluate(() => {
      const docFonts = (
        document as Document & { fonts?: { ready?: Promise<unknown> } }
      ).fonts;
      return docFonts?.ready ?? Promise.resolve();
    });
    // One extra settled frame after fonts load (avoids capturing a
    // mid-relayout frame on some Chrome builds).
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    // Inches, not px — page.pdf() mis-handles px units on portrait
    // (9:16 returned 0-byte PDFs). 1 px = 1/96in.
    const pxToIn = (px: number): string => `${px / 96}in`;
    const raw = await page.pdf({
      width: pxToIn(canvasW),
      height: pxToIn(canvasH),
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(raw);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
