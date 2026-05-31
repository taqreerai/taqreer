import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Build a Supabase admin client with the service-role key.
 *
 * Used by server / Inngest code that runs OUTSIDE a user's auth context
 * (the service role bypasses RLS — never expose it to the browser).
 * Centralized so the env-var names + the no-refresh / no-persist auth
 * options live in one grep-able place instead of being re-declared in
 * every function that needs storage access.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail with a clear, named error rather than a downstream "Invalid URL" /
  // 401 — this runs in Inngest jobs + API routes where a missing env var
  // would otherwise surface as a confusing cascade far from the cause.
  if (!url || !serviceKey) {
    throw new Error(
      "getSupabaseAdmin: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
