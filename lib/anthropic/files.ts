// Phase 17.B-7 — Anthropic Files API client helper.
//
// Centralized so every flow that uploads files goes through the same
// beta-header + SDK-shape contract. Used by:
//
//   • Inngest extract-source.ts — uploads source PDF for /create + /mimic
//   • Inngest deck-generate.ts  — uploads per-slide PNGs for /enhance
//     (generation-time rasterization) + flushes them after the run
//
// `deleteFileFromAnthropic` was re-added 2026-05-30 for the enhance
// overhaul: the per-slide PNGs we upload at generation time are
// TRANSIENT and must be flushed (deck-generate deletes them after the
// deck saves AND in onFailure) so they don't accumulate. Anthropic
// doesn't charge for file storage, but unflushed images would orphan
// on every enhance run. The beta header is referenced internally via
// the local `FILES_API_BETA` constant.
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
 * Delete an uploaded file from Anthropic's Files API. Best-effort by
 * contract — callers (deck-generate's flush + onFailure) swallow
 * failures: a delete that doesn't land just leaves a free, unreferenced
 * file that a future sweep can reap; it must never fail the run or the
 * failure-cleanup path. Returns true on success, false on any error.
 *
 * Deletes are free and the API tolerates a missing/already-deleted id
 * (404) — we treat that as success-enough (the file is gone either way),
 * but still report false so the caller can log the anomaly if it wants.
 */
export async function deleteFileFromAnthropic(fileId: string): Promise<boolean> {
  try {
    const client = getClient();
    await client.beta.files.delete(fileId, { betas: [FILES_API_BETA] });
    return true;
  } catch {
    return false;
  }
}

