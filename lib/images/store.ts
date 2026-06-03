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

import { createHash } from "node:crypto";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

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

// Deterministic per-image path — `${projectId}/gen/${genid}-${hash}.png`.
// Stable for a given (projectId, genid, promptHash), which is what lets the
// warm-during-stream fill, the end-of-deck reconcile, AND the status-route
// live poll all agree on the same object without a shared DB row mid-stream
// (context/images.md async fill).
function genImagePath(projectId: string, genid: string, hash: string): string {
  return `${projectId}/gen/${genid}-${hash}.png`;
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
 * Upload a base64 PNG and return its permanent public URL.
 * Path is `${projectId}/gen/${genid}-${hash}.png`; upsert so a re-store of
 * the SAME prompt (same hash) overwrites in place, while a CHANGED prompt
 * lands at a fresh path. Throws on missing env / upload error.
 */
export async function storeGeneratedImage(opts: {
  projectId: string;
  genid: string;
  hash: string;
  b64: string;
}): Promise<string> {
  const admin = adminClient();
  const path = genImagePath(opts.projectId, opts.genid, opts.hash);
  const bytes = Buffer.from(opts.b64, "base64");

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true, // regenerate overwrites the same path
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(`generated-images upload failed: ${error.message}`);
  }

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
export async function generatedImageExists(
  projectId: string,
  genid: string,
  hash: string,
): Promise<boolean> {
  const filename = `${genid}-${hash}.png`;
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

// Filenames safe to surface as an <img src> — `${genid}-${hash}.png` where
// genid is SAFE_GENID and hash is lowercase hex. Belt-and-suspenders against
// any future write path that bypasses the writer-side genid guard, keeping a
// `../`-style name from ever reaching the client.
const SAFE_GEN_FILENAME = /^[A-Za-z0-9._-]+-[0-9a-f]{12}\.png$/;

/**
 * The set of STORED image FILENAMES under `${projectId}/gen/` (e.g.
 * `img-cover-3f9a1c2b7e44.png`). Used by the status route to surface WARM
 * (during-stream) images BEFORE the end-of-deck reconcile writes their
 * GeneratedImage rows — so the live-fill poll can deliver them while the deck
 * is still generating, in dev (where realtime broadcasts don't arrive) and
 * across the `/preview`→`/project` gap. Returns FILENAMES (not bare genids)
 * because identity is now (genid + promptHash): the caller computes each
 * box's expected `${genid}-${hash}.png` from the live manifest and checks
 * membership, so a stale draft hash is never mistaken for the live prompt's
 * image. One storage `list` call.
 */
export async function listWarmedImageFiles(
  projectId: string,
): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .list(`${projectId}/gen`, { limit: 1000 });
  if (error || !data) return new Set();
  return new Set(
    data.map((f) => f.name).filter((name) => SAFE_GEN_FILENAME.test(name)),
  );
}
