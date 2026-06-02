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

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

const BUCKET = "generated-images";

// Deterministic per-image path — `${projectId}/gen/${genid}.png`. Stable
// for a given (projectId, genid), which is what lets the warm-during-
// stream fill and the end-of-deck reconcile agree on the same object
// without a shared DB row mid-stream (context/images.md async fill).
function genImagePath(projectId: string, genid: string): string {
  return `${projectId}/gen/${genid}.png`;
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
 * Path is `${projectId}/gen/${genid}.png`; upsert so a regenerate
 * (same genid) overwrites in place. Throws on missing env / upload error.
 */
export async function storeGeneratedImage(opts: {
  projectId: string;
  genid: string;
  b64: string;
}): Promise<string> {
  const admin = adminClient();
  const path = genImagePath(opts.projectId, opts.genid);
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
): string {
  return adminClient()
    .storage.from(BUCKET)
    .getPublicUrl(genImagePath(projectId, genid)).data.publicUrl;
}

/**
 * True if a box's image is already stored (e.g. filled by the warm-
 * during-stream pass). Lets the end-of-deck reconcile ADOPT warmed
 * images — mark them ready with the deterministic URL instead of
 * re-generating — so a box is billed to gpt-image-2 at most once.
 */
export async function generatedImageExists(
  projectId: string,
  genid: string,
): Promise<boolean> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .list(`${projectId}/gen`, { search: `${genid}.png`, limit: 1 });
  // Do NOT treat a Storage lookup FAILURE as "missing" — that would make warm
  // + reconcile fall through to a billed generateImage() on a transient blip,
  // breaking "bill at most once" for a deterministic path. Throw so the caller
  // retries/skips (warm → reconcile safety net; reconcile → re-claimable box).
  if (error) {
    throw new Error(
      `generated-images existence check failed (${projectId}/${genid}): ${error.message}`,
    );
  }
  return (data ?? []).some((f) => f.name === `${genid}.png`);
}

/**
 * Genids that already have a STORED image under `${projectId}/gen/`. Used by
 * the status route to surface WARM (during-stream) images BEFORE the end-of-
 * deck reconcile writes their GeneratedImage rows — so the live-fill poll can
 * deliver them while the deck is still generating, in dev (where realtime
 * broadcasts don't arrive) and across the `/preview`→`/project` gap. One
 * storage `list` call; pair each with `publicGeneratedImageUrl`.
 */
export async function listWarmedGenids(projectId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .storage.from(BUCKET)
    .list(`${projectId}/gen`, { limit: 1000 });
  if (error || !data) return [];
  return data
    .filter((f) => f.name.endsWith(".png"))
    .map((f) => f.name.slice(0, -".png".length))
    // Defensive: only surface filename-safe genids. Writers already gate on
    // SAFE_GENID (slide-images.ts) before storing, so this never filters a
    // real image — it's belt-and-suspenders against any future write path
    // that bypasses that guard, keeping a `../`-style name from ever reaching
    // the client as an <img src>.
    .filter((genid) => /^[A-Za-z0-9._-]{1,64}$/.test(genid));
}
