import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Request-deduped Supabase auth lookup for server components.
//
// `getUser()` round-trips to Supabase Auth (a real network call, ~150-250 ms
// from the box) so a forged/stale cookie can't pass a protected gate. The
// (app) layout AND its pages each need that guarantee, but paying the round
// trip twice per navigation is pure latency: React's cache() memoizes the
// result for the lifetime of one server render pass, so the layout's call is
// reused by the page (and anything else in the same request).
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
