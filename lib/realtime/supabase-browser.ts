// Singleton Supabase BROWSER client for Realtime use.
//
// `lib/supabase/client.ts` already exports a `createClient()` factory
// but it instantiates a fresh client on every call. For Realtime that's
// wasteful — every call opens a new websocket. Phase 16 (live editing)
// wants the same socket reused across DeckView mounts, presence
// tracking, comment subscriptions, and the bell, so we wrap the
// factory in a module-scoped singleton.
//
// Why a separate file (not extending `lib/supabase/client.ts` in place)?
//  • The auth flows that consume `createClient()` deliberately want a
//    fresh client per render — there are subtle SSR-cookie issues if
//    they share state. Leaving them alone preserves Phase 15 behaviour.
//  • Realtime is a different concern: a single shared socket for the
//    whole tab, kept alive across navigations within the SPA.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

let cached: SupabaseClient | null = null;

/**
 * Get the shared browser-side Supabase client. Lazy-initialised on
 * first call (so server-side imports of files that transitively touch
 * this module don't crash when env vars are absent at SSR time — the
 * client is only built when we're actually in the browser).
 */
export function getRealtimeBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "[realtime] getRealtimeBrowserClient called server-side — Realtime is browser-only",
    );
  }
  if (!cached) {
    cached = createClient();
  }
  return cached;
}
