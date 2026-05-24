// Phase 17.B-7 — Anthropic Files API client helpers.
//
// Centralized so every flow that uploads/deletes files goes through
// the same beta-header + SDK-shape contract. Used by:
//
//   • Inngest extract-source.ts — uploads source PDF for /enhance
//   • Inngest deck-generate.ts  — could delete files post-run if
//                                  we wanted (not currently doing
//                                  it; files are free to keep)
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

/**
 * Delete an uploaded file. Called post-generation cleanup to avoid
 * indefinite retention; safe to call multiple times (the SDK will
 * 404 on the second call, which we swallow).
 *
 * Best-effort — a failed delete doesn't undo a successful
 * generation, so we don't throw on errors.
 */
export async function deleteFileFromAnthropic(fileId: string): Promise<void> {
  try {
    const client = getClient();
    await client.beta.files.delete(fileId, { betas: [FILES_API_BETA] });
  } catch {
    // best-effort
  }
}

// Re-export the beta constant for callers that need to pass it
// through to messages.stream / messages.create alongside other
// beta headers (the deck-generate function combines this with the
// existing prompt-caching beta when invoking Claude).
export const ANTHROPIC_FILES_API_BETA = FILES_API_BETA;
