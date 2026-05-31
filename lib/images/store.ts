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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin env (URL / service role key) not set");
  }

  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const path = `${opts.projectId}/gen/${opts.genid}.png`;
  const bytes = Buffer.from(opts.b64, "base64");

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true, // regenerate overwrites the same path
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(`generated-images upload failed: ${error.message}`);
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
