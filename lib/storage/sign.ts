// Shared helper for turning a private brand-asset storage path into a
// long-lived signed HTTPS URL. Used by both the `/api/projects` POST
// (when assembling the brief for Claude) and `/api/brand-kits` GET
// (when hydrating the brand page from a saved kit so the <img src>
// preview actually loads).

import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

// Authorization check for `storageUrl` values arriving from the client.
// Upload route writes paths as `${supabaseUserId}/create/${folder}/...`,
// so a non-owned path is a forged request — any authenticated caller
// could otherwise mint a long-lived signed URL for any object whose path
// they can guess. Returns true only when the path is in the caller's
// namespace AND contains no `..` traversal segments (defensive — Supabase
// keys aren't filesystem paths, but stripping `..` is cheap insurance).
export function isOwnedBrandAssetPath(
  path: string | null | undefined,
  supabaseUserId: string,
): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.includes("..")) return false;
  return path.startsWith(`${supabaseUserId}/`);
}

export async function signBrandAssetUrl(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  try {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // 1 year. If we ever need permanent URLs, switch the bucket to public read.
    const { data, error } = await admin.storage
      .from("brand-assets")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
