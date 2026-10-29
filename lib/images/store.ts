// Generated-image storage — Phase 0 of context/images.md.
//
// Takes the base64 PNG from gpt-image.ts and persists it to the PUBLIC
// `generated-images` Supabase bucket, returning a permanent public URL.
//
// Public (not signed) on purpose: these images are decorative, get
// embedded as <img src> directly in the saved slide HTML, and must keep
// resolving in exports (Puppeteer/PPTX) and in decks older than a year —
// a 1-year signed URL would eventually 404 inside persisted manifests.
//
// Uses the supabase-js admin client (same as lib/storage/sign.ts) — it
// handles the project's `sb_secret_…` API-key format, which the raw
// Storage REST endpoint rejects as a non-JWT.

import { createHash, randomUUID } from "node:crypto";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "generated-images";

// Short, stable fingerprint of a box's PROMPT. The identity of a generated
// image is (genid + promptHash), NOT genid alone — this is what makes the
// fill drift-resilient (context/images.md §12). On the highest preset Claude
// often DISCARDS a draft manifest mid-stream and re-emits a polished one
// (parser.didReset()); a reused data-genid whose prompt CHANGED must NOT
// collide with the draft's already-stored image. Folding the prompt into
// the storage path means:
//   • same genid + same prompt  → same path → adopt it (zero re-bill), and
//   • same genid + changed prompt → different path → fresh, never stale.
// sha256→12 hex (48 bits) is collision-free across a deck's ≤12 prompts; the
// path is already scoped by projectId + genid, so this only disambiguates
// prompt VERSIONS of one box (no cross-tenant or security surface — a crafted
// brief can at worst self-collide two of its own boxes).
export function genImageHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

// Identity hash for a box = prompt + (optional) reference image. A product
// photo changes what gpt-image produces for the SAME prompt, so the ref
// must fold into the identity or a ref'd generation would adopt (and serve)
// a stale no-ref image at the same path - and vice versa. The prompt-only
// branch stays byte-identical to genImageHash so every existing no-ref deck
// keeps its paths, warm idempotency keys, and adopt matches; the ref branch
// encodes the fields structurally (JSON) so no crafted prompt can collide
// with a prompt+ref pair across the field boundary (CR PR #186).
export function genImageIdentityHash(
  prompt: string,
  refUrl?: string | null,
): string {
  return genImageHash(
    refUrl ? JSON.stringify({ version: 1, prompt, refUrl }) : prompt,
  );
}

// Single source for the stored generated-image filename. `.jpg` because
// storeGeneratedImage re-encodes the gpt-image PNG to JPEG. Used by the path
// builder, the existence check, the safe-filename guard, AND the status
// route's warm-fill membership test — keep the extension in exactly ONE place
// so they can never drift (a .png/.jpg mismatch silently re-bills every image).
export function genImageFileName(genid: string, hash: string): string {
  return `${genid}-${hash}.jpg`;
}

// Deterministic per-image path — `${projectId}/gen/${genid}-${hash}.jpg`.
// Stable for a given (projectId, genid, promptHash), which is what lets the
// warm-during-stream fill, the end-of-deck reconcile, AND the status-route
// live poll all agree on the same object without a shared DB row mid-stream
// (context/images.md async fill).
function genImagePath(projectId: string, genid: string, hash: string): string {
  return `${projectId}/gen/${genImageFileName(genid, hash)}`;
}

// Static thumbnail sibling — `${projectId}/gen/thumb/${genid}-${hash}.webp`.
// Written by storeGeneratedImage (+ the one-off backfill script) and consumed
// by the gallery/library tiles via a pure client-side URL rewrite (ThumbImg),
// replacing Supabase's render/image transformations (billed per distinct
// origin image per month — 510 last period and climbing with SEO traffic).
// `.webp` in exactly ONE place, same rationale as genImageFileName above.
// The nested `thumb/` folder is invisible to listWarmedImageFiles /
// generatedImageExists: its folder entry fails SAFE_GEN_FILENAME's `.jpg$`.
export function genThumbFileName(genid: string, hash: string): string {
  return `${genid}-${hash}.webp`;
}
export function genThumbPath(
  projectId: string,
  genid: string,
  hash: string,
): string {
  return `${projectId}/gen/thumb/${genThumbFileName(genid, hash)}`;
}

// Where a stored image came from (GeneratedImage.size: "1536x1024" for
// gpt-image, "pexels:<id>", "lib:<id>"), kept beside a WARMED image: the
// mid-stream warm has no row to write it on, and the end reconcile that
// adopts the file would otherwise mark the row with no source (prod
// 2026-10-29: Pexels photos and library copies read as our own generations,
// so they entered the reuse library and the public gallery). Same invisible
// nested-folder rule as thumb/.
function genSourcePath(projectId: string, genid: string, hash: string): string {
  return `${projectId}/gen/src/${genid}-${hash}.txt`;
}

// Shared by the live write below and scripts/backfill-image-thumbs.ts so the
// two can never drift. 700px bounding box: tiles render ≤ ~350px (x2 retina);
// `fit: "inside"` preserves aspect (the gpt-image outputs are 3:2 / 2:3 / 1:1).
export const THUMB_MAX_EDGE_PX = 700;
export const THUMB_WEBP_QUALITY = 65;
export async function makeThumbBytes(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .resize({
      width: THUMB_MAX_EDGE_PX,
      height: THUMB_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_WEBP_QUALITY })
    .toBuffer();
}

// Memoised module singleton — the admin client is stateless (no session
// persistence), and `publicGeneratedImageUrl` / `listWarmedGenids` are called
// in a loop on the every-6s image-fills poll; constructing a fresh client each
// time allocated N+1 fetch/auth/storage wrappers per request for nothing.
let _adminClient: ReturnType<typeof createSupabaseAdminClient> | null = null;
function adminClient() {
  if (_adminClient) return _adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin env (URL / service role key) not set");
  }
  _adminClient = createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

/**
 * Re-encode the gpt-image PNG to JPEG and upload it, returning the permanent
 * public URL. Path is `${projectId}/gen/${genid}-${hash}.jpg`; upsert so a
 * re-store of the SAME prompt (same hash) overwrites in place, while a CHANGED
 * prompt lands at a fresh path. Throws on missing env / upload error.
 *
 * Why JPEG: gpt-image-2 returns a lossless PNG (~1-2MB at 1536x1024). These are
 * opaque, full-bleed photos (no transparency to lose), so JPEG q82 is ~7x
 * smaller, which shrinks the viewer load AND every export (PPTX/PDF/PNG embed
 * the stored bytes). If the re-encode ever fails we fall back to the raw PNG
 * bytes (still valid at the .jpg path — consumers read the content-type).
 */
export async function storeGeneratedImage(opts: {
  projectId: string;
  genid: string;
  hash: string;
  b64: string;
  // The image's source (see genSourcePath); stored only when given.
  source?: string;
}): Promise<string> {
  const admin = adminClient();
  const path = genImagePath(opts.projectId, opts.genid, opts.hash);
  const pngBytes = Buffer.from(opts.b64, "base64");

  let bytes: Buffer = pngBytes;
  let contentType = "image/png";
  try {
    bytes = await sharp(pngBytes).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    contentType = "image/jpeg";
  } catch {
    /* keep the raw PNG bytes on any sharp failure */
  }

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true, // regenerate overwrites the same path
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(`generated-images upload failed: ${error.message}`);
  }

  // Static thumbnail for the gallery/library tiles — replaces Supabase
  // render/image transformations (billed per origin image). Generated from
  // the RAW PNG (not the JPEG re-encode: avoids double-lossy output and still
  // works when the re-encode above fell back). Independent try/catch: a thumb
  // failure must never fail the image store — the tiles' retry ladder falls
  // back to the full original, and the backfill script sweeps up gaps.
  try {
    const thumb = await makeThumbBytes(pngBytes);
    const { error: thumbError } = await admin.storage
      .from(BUCKET)
      .upload(genThumbPath(opts.projectId, opts.genid, opts.hash), thumb, {
        contentType: "image/webp",
        upsert: true,
        cacheControl: "31536000",
      });
    if (thumbError) throw new Error(thumbError.message);
  } catch (err) {
    console.warn(
      `[gen-thumb] thumb store failed for ${opts.projectId}/${opts.genid}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (opts.source) {
    const { error: srcError } = await admin.storage
      .from(BUCKET)
      .upload(genSourcePath(opts.projectId, opts.genid, opts.hash), Buffer.from(opts.source.slice(0, 100)), {
        contentType: "text/plain",
        upsert: true,
      });
    if (srcError) console.warn(`[gen-src] source store failed for ${opts.projectId}/${opts.genid}: ${srcError.message}`);
  }

  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Raster MIME → file extension. Deliberately NO SVG: SVGs can carry inline
// scripts, and these objects are served from a public bucket — a raster-only
// allowlist removes the stored-XSS surface entirely.
const UPLOAD_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Persist a USER-uploaded image (the in-canvas "replace image" action) to the
 * same PUBLIC bucket under `uploads/<userId>/<uuid>.<ext>`, returning a
 * permanent public URL. Public + permanent for the same reason as generated
 * images: the URL is written straight into the saved slide HTML and must keep
 * resolving in exports and in decks older than a year. The caller MUST have
 * already authenticated the user and validated `contentType` against an image
 * allowlist (see the route). Throws on unsupported type / upload error.
 */
export async function storeUploadedImage(opts: {
  userId: string;
  bytes: Buffer;
  contentType: string;
}): Promise<string> {
  const ext = UPLOAD_EXT[opts.contentType];
  if (!ext) throw new Error(`unsupported image type: ${opts.contentType}`);
  const path = `uploads/${opts.userId}/${randomUUID()}.${ext}`;
  const admin = adminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, opts.bytes, {
    contentType: opts.contentType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`image upload failed: ${error.message}`);
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The deterministic public URL for an image WITHOUT touching storage.
 * `getPublicUrl` just formats a path, so this is safe to call before the
 * object exists — pair with `generatedImageExists` to know if it's real.
 */
export function publicGeneratedImageUrl(
  projectId: string,
  genid: string,
  hash: string,
): string {
  return adminClient()
    .storage.from(BUCKET)
    .getPublicUrl(genImagePath(projectId, genid, hash)).data.publicUrl;
}

/**
 * True if a box's image for THIS prompt (genid + hash) is already stored
 * (e.g. filled by the warm-during-stream pass). Lets the end-of-deck
 * reconcile ADOPT warmed images — mark them ready with the deterministic URL
 * instead of re-generating — so a box is billed to gpt-image-2 at most once.
 */
/** The source stored beside a warmed image, or "" when none was stored. */
export async function generatedImageSource(projectId: string, genid: string, hash: string): Promise<string> {
  try {
    const { data } = await adminClient().storage.from(BUCKET).download(genSourcePath(projectId, genid, hash));
    return data ? (await data.text()).trim().slice(0, 100) : "";
  } catch {
    return "";
  }
}

export async function generatedImageExists(
  projectId: string,
  genid: string,
  hash: string,
): Promise<boolean> {
  const filename = genImageFileName(genid, hash);
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .list(`${projectId}/gen`, { search: filename, limit: 1 });
  // Do NOT treat a Storage lookup FAILURE as "missing" — that would make warm
  // + reconcile fall through to a billed generateImage() on a transient blip,
  // breaking "bill at most once" for a deterministic path. Throw so the caller
  // retries/skips (warm → reconcile safety net; reconcile → re-claimable box).
  if (error) {
    throw new Error(
      `generated-images existence check failed (${projectId}/${filename}): ${error.message}`,
    );
  }
  return (data ?? []).some((f) => f.name === filename);
}

// Filenames safe to surface as an <img src> — `${genid}-${hash}.jpg` where
// genid is SAFE_GENID and hash is lowercase hex. Belt-and-suspenders against
// any future write path that bypasses the writer-side genid guard, keeping a
// `../`-style name from ever reaching the client.
const SAFE_GEN_FILENAME = /^[A-Za-z0-9._-]+-[0-9a-f]{12}\.jpg$/;

/**
 * The set of STORED image FILENAMES under `${projectId}/gen/` (e.g.
 * `img-cover-3f9a1c2b7e44.jpg`). Used by the status route to surface WARM
 * (during-stream) images BEFORE the end-of-deck reconcile writes their
 * GeneratedImage rows — so the live-fill poll can deliver them while the deck
 * is still generating, in dev (where realtime broadcasts don't arrive) and
 * across the `/preview`→`/project` gap. Returns FILENAMES (not bare genids)
 * because identity is now (genid + promptHash): the caller computes each
 * box's expected `${genid}-${hash}.jpg` from the live manifest and checks
 * membership, so a stale draft hash is never mistaken for the live prompt's
 * image. One storage `list` call.
 */
export async function listWarmedImageFiles(
  projectId: string,
): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .list(`${projectId}/gen`, { limit: 1000 });
  // A real Storage error must NOT collapse to an empty set: that reads as "no
  // warmed files this tick" and was swallowed silently (the caller's failure
  // log never fired). Throw so the caller's catch logs it and still degrades to
  // DB-ready fills. A genuinely empty bucket returns `data: []` with no error.
  if (error) {
    throw new Error(`Storage list failed for ${projectId}/gen: ${error.message}`);
  }
  if (!data) return new Set();
  return new Set(
    data.map((f) => f.name).filter((name) => SAFE_GEN_FILENAME.test(name)),
  );
}
