// Mints a fresh Anthropic Files `file_id` for a template's stored deck PDF
// (Template.pdfUrl): the design reference a template generation reads.
// file_ids expire, so one is minted per use, never persisted. Shared by
// POST /api/templates/[id]/use (the picker) and POST /api/projects, which
// re-mints server-side for free-plan template runs instead of trusting a
// client-sent file id (2026-10-02).

import { uploadFileToAnthropic } from "@/lib/anthropic/files";

export async function mintTemplateDesignFile(
  templateId: string,
  pdfUrl: string,
): Promise<string> {
  // 20s abort so a slow/hanging upstream can't tie up the worker before the
  // (also-bounded) Anthropic upload.
  const pdfRes = await fetch(pdfUrl, { signal: AbortSignal.timeout(20_000) });
  if (!pdfRes.ok) {
    throw new Error(`PDF download failed (${pdfRes.status})`);
  }
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  return uploadFileToAnthropic({
    bytes,
    fileName: `template-${templateId}.pdf`,
    contentType: "application/pdf",
  });
}
