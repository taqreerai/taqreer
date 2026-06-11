// Server-only HS256 signer for Supabase Realtime authorization tokens.
//
// Why hand-rolled: we only SIGN here (Supabase verifies); HMAC-SHA256
// over `base64url(header).base64url(payload)` is the whole algorithm,
// and no JWT library is in the dependency tree. We never parse or
// verify untrusted tokens with this module.
//
// The token's job is to carry a `topics` claim - the realtime.messages
// RLS policies (scratch/realtime-policies.sql) allow joining a private
// channel ONLY when its topic is listed in the claim. Which topics a
// caller gets is decided server-side by /api/realtime/token using the
// session + resolveProjectAccess, so the Supabase policies stay a dumb
// claim-membership check and all access logic lives in app code where
// the data (docker Postgres) actually is.

import { createHmac } from "node:crypto";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function mintRealtimeToken(args: {
  secret: string;
  // JWT sub. The supabase auth uid for signed-in users; a random
  // `anon-…` id for anonymous public-view callers (nothing reads it -
  // the policies only look at `topics` - but Realtime requires a sub).
  sub: string;
  topics: string[];
  ttlSeconds?: number;
}): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (args.ttlSeconds ?? 1800);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: args.sub,
    // Maps to the `authenticated` Postgres role so the `to authenticated`
    // realtime.messages policies apply. This is OUR token - the role
    // claim selects the policy set, it does not grant table access
    // (Supabase's DB holds no app data; see project-channel.ts header).
    role: "authenticated",
    aud: "authenticated",
    iss: "taqreer-realtime",
    topics: args.topics,
    iat: now,
    exp,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", args.secret)
    .update(signingInput)
    .digest("base64url");
  return { token: `${signingInput}.${signature}`, expiresAt: exp * 1000 };
}
