// Source assets (Enhance phase 1, docs/enhance-visuals-plan.md, 2026-10-15).
//
// Pictures, charts and tables CARRIED OVER from a user's uploaded deck are
// stored here, in a PRIVATE bucket (owner decision 2026-10-15): they are crops
// of the user's own document, so they are never public. Slide HTML never holds
// a storage URL. It references `/api/assets/{projectId}/{assetId}`, and that
// route checks deck access before redirecting to a short-lived signed URL.
// Server-side consumers (bake, thumbnails, exports) read the bytes directly
// with the service role via readSourceAsset.
//
// Layout: `${projectId}/${assetId}` (no extension; the content type is stored
// on the object). Deleting a project removes its whole folder.

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const SOURCE_ASSETS_BUCKET = "source-assets";

// Signed URL lifetime. The asset route answers every request with a fresh
// redirect, so this only bounds how long a leaked signed URL keeps working.
export const SOURCE_ASSET_URL_TTL_S = 60 * 60;

// Ids are generated server-side (e.g. "s07-a1"). Both parts end up in a storage
// key, so they are validated strictly: no dots, no slashes, no traversal.
const PROJECT_ID_RE = /^[a-z0-9]{8,40}$/i;
const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function isValidSourceAssetRef(projectId: string, assetId: string): boolean {
  return PROJECT_ID_RE.test(projectId) && ASSET_ID_RE.test(assetId);
}

function assetKey(projectId: string, assetId: string): string {
  if (!isValidSourceAssetRef(projectId, assetId)) {
    throw new Error("Invalid source asset reference");
  }
  return `${projectId}/${assetId}`;
}

// Server-side headless renders (freeze bake, thumbnails, PDF / PNG export) load
// slide HTML with setContent, where a relative `/api/assets/...` has nothing to
// resolve against. buildHtmlDocumentServer sets this as the document <base>,
// and guardPageEgress answers `${RENDER_ORIGIN}/api/assets/...` straight from
// the private bucket, for the rendered deck's OWN project only. The slide's
// src attribute stays relative, so a bake that writes HTML back never
// persists anything but `/api/assets/...`. Not a real host: never resolvable.
export const RENDER_ORIGIN = "https://render.taqreer.invalid";

/** `/api/assets/{projectId}/{assetId}` -> its parts, or null. */
export function parseSourceAssetPath(pathname: string): { projectId: string; assetId: string } | null {
  const m = pathname.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
  if (!m || !isValidSourceAssetRef(m[1], m[2])) return null;
  return { projectId: m[1], assetId: m[2] };
}

/** The app-relative URL slide HTML uses for an asset (never a storage URL). */
export function sourceAssetHref(projectId: string, assetId: string): string {
  assetKey(projectId, assetId);
  return `/api/assets/${projectId}/${assetId}`;
}

export async function uploadSourceAsset(opts: {
  projectId: string;
  assetId: string;
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(SOURCE_ASSETS_BUCKET)
    .upload(assetKey(opts.projectId, opts.assetId), opts.bytes, {
      contentType: opts.contentType,
      upsert: true,
    });
  if (error) throw new Error(`source asset upload failed: ${error.message}`);
}

/** Short-lived signed URL, or null when the object does not exist. */
export async function signSourceAsset(
  projectId: string,
  assetId: string,
): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(SOURCE_ASSETS_BUCKET)
    .createSignedUrl(assetKey(projectId, assetId), SOURCE_ASSET_URL_TTL_S);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Raw bytes for server-side consumers (bake, thumbnails, exports). */
export async function readSourceAsset(
  projectId: string,
  assetId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(SOURCE_ASSETS_BUCKET)
    .download(assetKey(projectId, assetId));
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type };
}

/**
 * Remove every asset of a project (project delete). Best-effort by contract:
 * returns the error message instead of throwing so the caller's delete
 * proceeds, same as the thumbnail cleanup.
 */
export async function removeProjectSourceAssets(projectId: string): Promise<string | null> {
  if (!PROJECT_ID_RE.test(projectId)) return "invalid project id";
  const bucket = getSupabaseAdmin().storage.from(SOURCE_ASSETS_BUCKET);
  for (;;) {
    const { data, error } = await bucket.list(projectId, { limit: 1000 });
    if (error) return error.message;
    const keys = (data ?? []).filter((o) => o.id !== null).map((o) => `${projectId}/${o.name}`);
    if (keys.length === 0) return null;
    const { error: rmError } = await bucket.remove(keys);
    if (rmError) return rmError.message;
    if (keys.length < 1000) return null;
  }
}
