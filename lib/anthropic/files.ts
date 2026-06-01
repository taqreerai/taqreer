// Phase 17.B-7 — Anthropic Files API client helper.
//
// Centralized so every flow that uploads files goes through the same
// beta-header + SDK-shape contract. Used by:
//
//   • Inngest extract-source.ts — uploads source PDF for /enhance
//
// `deleteFileFromAnthropic` + `ANTHROPIC_FILES_API_BETA` were removed
// 2026-05-25 in the dead-code audit pass — neither had any importer.
// Anthropic doesn't charge for file storage and we never set up a
// cleanup pass, so delete-on-completion stayed theoretical. The beta
// header is referenced internally via the local `FILES_API_BETA`
// constant.
//
// ─── Why a beta header ───────────────────────────────────────────
// Per the official docs (verified 2026-05-25), the Files API is
// in beta and every call must carry `anthropic-beta: files-api-
// 2025-04-14`. The SDK threads this through the `betas: [...]`
// parameter on each call.

import Anthropic from "@anthropic-ai/sdk";

const FILES_API_BETA = "files-api-2025-04-14";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set in the runtime environment",
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Upload a PDF (or any supported document) to Anthropic's Files
 * API. Returns the `file_id` to reference in a subsequent Messages
 * call via a `document` block:
 *
 *   { type: "document", source: { type: "file", file_id } }
 *
 * Throws on upload failure; caller (Inngest) wraps with retry /
 * NonRetriable semantics.
 *
 * @param bytes        Raw file bytes
 * @param fileName     Filename to display in Anthropic's dashboard
 *                     (also used by Claude for citation labels)
 * @param contentType  MIME type, e.g. "application/pdf"
 */
export async function uploadFileToAnthropic({
  bytes,
  fileName,
  contentType,
}: {
  bytes: Buffer;
  fileName: string;
  contentType: string;
}): Promise<string> {
  const client = getClient();
  const file = await client.beta.files.upload({
    file: await Anthropic.toFile(bytes, fileName, { type: contentType }),
    // SDK transforms `betas` into the `anthropic-beta` header.
    betas: [FILES_API_BETA],
  });
  if (!file.id) {
    throw new Error(
      `Anthropic Files API returned no file_id for ${fileName}`,
    );
  }
  return file.id;
}

