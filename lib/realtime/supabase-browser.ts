// Singleton Supabase BROWSER client for Realtime use.
//
// `lib/supabase/client.ts` already exports a `createClient()` factory
// but it instantiates a fresh client on every call. For Realtime that's
// wasteful - every call opens a new websocket. Phase 16 (live editing)
// wants the same socket reused across DeckView mounts, presence
// tracking, comment subscriptions, and the bell, so we wrap a
// module-scoped singleton.
//
// Since the private-channel hardening this is a DEDICATED
// @supabase/supabase-js client (not the @supabase/ssr auth client):
// its `accessToken` option feeds the socket the minted Realtime
// authorization JWT from token-manager.ts instead of the user's
// session token. That matters because private-channel policies key off
// the minted token's `topics` claim, and because the ssr client's auth
// integration would clobber a custom token on every session refresh.
// This client is REALTIME-ONLY - never call .auth / .from on it.

import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  bindRealtimeAuthPush,
  getRealtimeAccessToken,
} from "./token-manager";

let cached: SupabaseClient | null = null;

/**
 * Get the shared browser-side Supabase client. Lazy-initialised on
 * first call (so server-side imports of files that transitively touch
 * this module don't crash when env vars are absent at SSR time - the
 * client is only built when we're actually in the browser).
 */
export function getRealtimeBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "[realtime] getRealtimeBrowserClient called server-side - Realtime is browser-only",
    );
  }
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("[realtime] Supabase env missing in the browser bundle");
    }
    cached = createSupabaseJsClient(url, anonKey, {
      // The socket asks this callback for its token on connect/join.
      // null (private mode off / mint unavailable) falls back to the
      // anon key - the pre-hardening public-channel behaviour.
      accessToken: async () => getRealtimeAccessToken(),
    });
    const client = cached;
    // Token refreshes / project-topic re-mints push straight to the
    // live socket so already-joined channels re-run authorization
    // without re-subscribing.
    bindRealtimeAuthPush((token) => {
      void client.realtime.setAuth(token);
    });
  }
  return cached;
}
