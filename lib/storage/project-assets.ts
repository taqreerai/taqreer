// Phase 17.A — Supabase storage helpers for the upload-driven flows.
//
//   project-assets/{jobId}/{contentHash}.{ext}
//     Embedded images extracted from the source (PPTX `ppt/media/*`).
//     Persisted for the project's lifetime — the generated HTML
//     references them by public URL, so deletion would break the
//     deck. Keyed by jobId during extraction (project doesn't exist
//     yet) and remain under that path forever. Deleted only when
//     the user deletes the project.
//
// ─── Phase 17.B-7 pivot ──────────────────────────────────────────
// The `extract-temp` bucket + uploadSlideRasters helper are gone —
// we no longer rasterize PDFs to PNGs locally. Claude reads the
// source PDF directly via Anthropic Files API + `document` block.
// The only persistent storage we need is `project-assets` for the
// embedded images the generated HTML references.
//
// ─── Why jobId, not projectId ─────────────────────────────────────
// Extraction runs BEFORE /api/projects POST — the project record
// doesn't exist yet. Using jobId as the (permanent) namespace lets
// the upload happen during extraction; the project record stores
// the jobId so cascade-delete can target the right path when the
// user trashes a project.
//
// ─── Why a public bucket ──────────────────────────────────────────
// Generated HTML embeds `<img src="...">` URLs. The deck preview
// loads in an iframe on /preview/[id], and the export pipeline
// (Puppeteer-based PDF/PNG export) fetches the URLs too. Signed
// URLs would expire mid-export. Public bucket + unguessable jobId
// (UUID v4) is the standard pattern.

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const PROJECT_ASSETS_BUCKET = "project-assets";

// ─── Public API ────────────────────────────────────────────────────

export type UploadedAsset = {
  /** Public URL — embedded into the generated HTML by Claude. */
  url: string;
  /** 1-based slide indices where this asset originally appeared. */
  slideIndices: number[];
  /**
   * IDs of PowerPoint shape-groups this image is part of. Threaded
   * through from assets-pptx.ts. Empty array when ungrouped. See
   * ExtractedPptxAsset.groupIds for full semantics.
   */
  groupIds: string[];
};

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
    groupIds: string[];
  }>,
): Promise<UploadedAsset[]> {
  const admin = makeAdminClient();

  // ─── Step 1: dedupe by content hash, merge slideIndices + groupIds ─
  // The hash is the storage path's namespace inside this jobId. If
  // two ExtractedPptxAssets have the same bytes (rare but possible
  // — PowerPoint copy-paste, or images-of-images in slide layouts),
  // they collapse into one upload with the union of their indices
  // AND the union of their group IDs.
  type Pending = {
    contentType: string;
    bytes: Buffer;
    ext: string;
    slideIndices: Set<number>;
    groupIds: Set<string>;
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
      for (const gid of asset.groupIds) existing.groupIds.add(gid);
    } else {
      pendingByHash.set(hash, {
        contentType: asset.contentType,
        bytes: asset.bytes,
        ext,
        slideIndices: new Set(asset.slideIndices),
        groupIds: new Set(asset.groupIds),
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
      groupIds: [...pending.groupIds].sort(),
    });
  }
  return out;
}

/**
 * Delete a project's persisted assets. Called from the project
 * cascade-delete path (DELETE /api/projects/[id]) when a user
 * trashes a project — its embedded images become orphans otherwise.
 *
 * Best-effort: project deletion shouldn't fail because we couldn't
 * clean up storage.
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
