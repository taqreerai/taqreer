// Shared helper for turning a private brand-asset storage path into a
// long-lived signed HTTPS URL. Used by both the `/api/projects` POST
// (when assembling the brief for Claude) and `/api/brand-kits` GET
// (when hydrating the brand page from a saved kit so the <img src>
// preview actually loads).

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

export async function signBrandAssetUrl(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const admin = createSupabaseAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // 1 year. If we ever need permanent URLs, switch the bucket to public read.
  const { data } = await admin.storage
    .from("brand-assets")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}
