// One-off local-dev helper: mint a real Supabase session for an existing user
// WITHOUT the interactive login (admin generateLink → verifyOtp), then print
// the sb-<ref>-auth-token cookie value to plant on localhost via Playwright.
// Recipe from the 2026-08-02 session (PR #179 verification).
// Usage: npx tsx --env-file=.env.local scripts/sim-login.ts <email>

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.argv[2];
  if (!url || !service || !anon || !email) {
    console.error("missing env or email arg");
    process.exit(1);
  }

  // realtime transport ws: supabase-js EAGERLY constructs RealtimeClient in
  // createClient and throws on Node 20 without native WebSocket, so the
  // transport is required even for auth-only scripts. ws + @types/ws are
  // devDependencies (the bare import failed the prod Next build type-check
  // on 2026-08-09 - scripts/ is inside the build's tsconfig include).
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as undefined },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("generateLink failed:", error?.message);
    process.exit(1);
  }

  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as undefined },
  });
  const { data: verified, error: verifyErr } = await anonClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) {
    console.error("verifyOtp failed:", verifyErr?.message);
    process.exit(1);
  }

  const ref = new URL(url).hostname.split(".")[0];
  const value =
    "base64-" +
    Buffer.from(JSON.stringify(verified.session)).toString("base64url");
  console.log(JSON.stringify({ name: `sb-${ref}-auth-token`, value }));
}

void main();
