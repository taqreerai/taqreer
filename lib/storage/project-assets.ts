// Phase 17.A — Supabase storage helpers for upload-driven flows.
//
// Two buckets, two lifecycles:
//
//   extract-temp/{jobId}/slide-{N}.png
//     Rasterized slide PNGs. Used by deck-generate to build the
//     multipart Claude message. Deleted in a post-generation cleanup
//     step — these are transient, the rendered HTML doesn't
//     reference them.
//
//   project-assets/{jobId}/{assetId}.{ext}
//     Embedded images extracted from the source (PPTX `ppt/media/*`).
//     Persisted for the project's lifetime — the generated HTML
//     references them by public URL, so deletion would break the
//     deck. Keyed by jobId during extraction (project doesn't exist
//     yet) and remain under that path forever. Deleted only when
//     the user deletes the project.
//
// ─── Why jobId, not projectId ─────────────────────────────────────
// Extraction runs BEFORE /api/projects POST — the project record
// doesn't exist yet. We can't write to project-assets/{projectId}/
// because we don't have a projectId yet. Using jobId as the
// (permanent) namespace lets the upload happen during extraction;
// the project record stores the jobId so cascade-delete can target
// the right path when the user trashes a project.
//
// ─── Why a public bucket ──────────────────────────────────────────
// Generated HTML embeds `<img src="...">` URLs. The deck preview
// loads in an iframe on /preview/[id], and the export pipeline
// (Puppeteer-based PDF/PNG export) fetches the URLs too. Signed
// URLs would expire mid-export. Public bucket + unguessable jobId
// (UUID v4) is the standard pattern.

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Bucket names. Both need to exist in Supabase before the upload
// routes are called — operations cost: one-time bucket creation in
// the Supabase dashboard. See deploy/SETUP.md (Phase 17.A) for the
// exact steps.
const EXTRACT_TEMP_BUCKET = "extract-temp";
const PROJECT_ASSETS_BUCKET = "project-assets";

// ─── Public API ────────────────────────────────────────────────────

export type UploadedSlide = {
  /** Public URL — fed to deck-generate's multipart Claude message. */
  url: string;
  /** 1-based slide index — matches the originating page number. */
  index: number;
};

export type UploadedAsset = {
  /** Public URL — embedded into the generated HTML by Claude. */
  url: string;
  /** 1-based slide indices where this asset originally appeared. */
  slideIndices: number[];
};

/**
 * Upload rasterized slide PNGs to `extract-temp/{jobId}/`.
 * Returns the public URLs in the same order as the input.
 *
 * @throws if the storage env vars are missing or any upload fails.
 *   Failures are NOT individually retried — the caller (Inngest
 *   function) gets the retry semantics via Inngest's step.run
 *   wrapping.
 */
export async function uploadSlideRasters(
  jobId: string,
  slides: Array<{ index: number; png: Buffer }>,
): Promise<UploadedSlide[]> {
  const admin = makeAdminClient();
  const out: UploadedSlide[] = [];
  for (const slide of slides) {
    const path = `${jobId}/slide-${slide.index}.png`;
    const { error } = await admin.storage
      .from(EXTRACT_TEMP_BUCKET)
      .upload(path, slide.png, {
        contentType: "image/png",
        upsert: true, // idempotent — re-extraction of same job overwrites
      });
    if (error) {
      throw new Error(
        `extract-temp upload failed for ${path}: ${error.message}`,
      );
    }
    out.push({
      url: publicUrl(EXTRACT_TEMP_BUCKET, path),
      index: slide.index,
    });
  }
  return out;
}

/**
 * Upload embedded assets to `project-assets/{jobId}/`. Returns the
 * public URLs paired with the slide indices where each asset
 * originally appeared (passed through from the extractor).
 *
 * Idempotent on retries. assetId is derived from a SHA-256 of the
 * bytes (first 32 hex chars — 128 bits of entropy, no realistic
 * collision risk for the small number of images per deck), and the
 * upload uses upsert:true. That means:
 *   • Inngest retrying the upload step re-uploads to the same path,
 *     so no orphaned blobs accumulate.
 *   • Bytes-identical assets the extractor reported twice (e.g.
 *     copy-paste duplicates in PowerPoint) collapse into a single
 *     stored object, with their slideIndices merged in the return.
 */
export async function uploadProjectAssets(
  jobId: string,
  assets: Array<{
    fileName: string;
    contentType: string;
    bytes: Buffer;
    slideIndices: number[];
  }>,
): Promise<UploadedAsset[]> {
  const admin = makeAdminClient();

  // ─── Step 1: dedupe by content hash, merge slideIndices ──────────
  // The hash is the storage path's namespace inside this jobId. If
  // two ExtractedPptxAssets have the same bytes (rare but possible
  // — PowerPoint copy-paste, or images-of-images in slide layouts),
  // they collapse into one upload with the union of their indices.
  type Pending = {
    contentType: string;
    bytes: Buffer;
    ext: string;
    slideIndices: Set<number>;
    hash: string;
  };
  const pendingByHash = new Map<string, Pending>();
  for (const asset of assets) {
    const ext = (asset.fileName.split(".").pop() ?? "bin").toLowerCase();
    const hash = createHash("sha256")
      .update(asset.bytes)
      .digest("hex")
      .slice(0, 32);
    const existing = pendingByHash.get(hash);
    if (existing) {
      for (const idx of asset.slideIndices) existing.slideIndices.add(idx);
    } else {
      pendingByHash.set(hash, {
        contentType: asset.contentType,
        bytes: asset.bytes,
        ext,
        slideIndices: new Set(asset.slideIndices),
        hash,
      });
    }
  }

  // ─── Step 2: upload each unique hash with upsert:true ────────────
  const out: UploadedAsset[] = [];
  for (const pending of pendingByHash.values()) {
    const path = `${jobId}/${pending.hash}.${pending.ext}`;
    const { error } = await admin.storage
      .from(PROJECT_ASSETS_BUCKET)
      .upload(path, pending.bytes, {
        contentType: pending.contentType,
        upsert: true, // idempotent — retry-safe, same bytes overwrite same path
      });
    if (error) {
      throw new Error(
        `project-assets upload failed for ${path}: ${error.message}`,
      );
    }
    out.push({
      url: publicUrl(PROJECT_ASSETS_BUCKET, path),
      slideIndices: [...pending.slideIndices].sort((a, b) => a - b),
    });
  }
  return out;
}

/**
 * Delete an entire `extract-temp/{jobId}/` directory. Called after
 * deck-generate completes — slide PNGs aren't needed anymore.
 *
 * Best-effort: errors are swallowed because failing to clean up
 * temp files isn't worth failing a successful deck generation. A
 * periodic cleanup job (TODO Phase 17.B) sweeps any leftover jobIds
 * older than 24h.
 */
export async function deleteExtractTemp(jobId: string): Promise<void> {
  try {
    const admin = makeAdminClient();
    const { data: list, error: listError } = await admin.storage
      .from(EXTRACT_TEMP_BUCKET)
      .list(jobId);
    if (listError || !list) return;
    const paths = list.map((f) => `${jobId}/${f.name}`);
    if (paths.length === 0) return;
    await admin.storage.from(EXTRACT_TEMP_BUCKET).remove(paths);
  } catch {
    // Cleanup is best-effort — see periodic-cleanup TODO.
  }
}

/**
 * Delete a project's persisted assets. Called from the project
 * cascade-delete path (DELETE /api/projects/[id]) when a user
 * trashes a project — its embedded images become orphans otherwise.
 *
 * Best-effort, same as deleteExtractTemp. Project deletion shouldn't
 * fail because we couldn't clean up storage.
 */
export async function deleteProjectAssets(jobId: string): Promise<void> {
  try {
    const admin = makeAdminClient();
    const { data: list, error: listError } = await admin.storage
      .from(PROJECT_ASSETS_BUCKET)
      .list(jobId);
    if (listError || !list) return;
    const paths = list.map((f) => `${jobId}/${f.name}`);
    if (paths.length === 0) return;
    await admin.storage.from(PROJECT_ASSETS_BUCKET).remove(paths);
  } catch {
    // Best-effort.
  }
}

// ─── Internals ─────────────────────────────────────────────────────

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase env vars missing — NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set on the server.",
    );
  }
  return createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function publicUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  }
  // Public bucket URLs follow the canonical Supabase pattern. Using
  // string construction (vs admin.storage.from().getPublicUrl())
  // avoids a roundtrip — the URL shape is documented and stable.
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
