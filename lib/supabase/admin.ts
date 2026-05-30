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
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
