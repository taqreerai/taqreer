// GET /api/realtime/token[?projectId=…]
//
// Mints the short-lived Realtime authorization JWT (lib/realtime/
// mint-token.ts) that lets the browser join PRIVATE Supabase channels.
// The `topics` claim is the entire authorization decision:
//
//   user:{supabaseUserId}  - always included for signed-in callers;
//                            only the account owner ever gets their
//                            own user topic.
//   project:{id}           - included when resolveProjectAccess grants
//                            at least `view` (owner / accepted share /
//                            public link - anonymous callers included,
//                            matching the old realtime-token route).
//
// `enabled: false` (secret not configured) tells clients to keep using
// public channels - the pre-private status quo - so this route is also
// the rollout switch: configure SUPABASE_JWT_SECRET after applying the
// realtime.messages policies and every new socket upgrades to private.
//
// Replaces /api/projects/[id]/realtime-token (whose header comment
// reserved exactly this seam: "once we wire Realtime's setAuth(token)
// path").

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { mintRealtimeToken } from "@/lib/realtime/mint-token";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";

const TOKEN_TTL_SECONDS = 1800;

export async function GET(request: Request) {
  // Generous flood guard only: tokens last 30 min, so a legit client mints a
  // couple per hour; this just stops a deliberate mint flood. Keyed by IP.
  const limited = rateLimited(`realtime-token:${clientIp(request)}`, 60, 60_000);
  if (limited) return limited;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { enabled: false, token: null, expiresAt: null, topics: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const topics: string[] = [];
  if (user) topics.push(`user:${user.id}`);

  const projectId = new URL(request.url).searchParams.get("projectId");
  let role: string | null = null;
  if (projectId) {
    const access = await resolveProjectAccess(projectId, "view");
    if (!("error" in access)) {
      topics.push(`project:${projectId}`);
      role = access.role;
    } else if (!user) {
      // Anonymous caller with no joinable project: nothing to mint.
      return NextResponse.json(
        { error: access.error },
        { status: access.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Signed-in caller without access to the requested project still
    // gets their user topic - the bell must keep working even when a
    // stale tab asks for a revoked project.
  }

  if (topics.length === 0) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { token, expiresAt } = mintRealtimeToken({
    secret,
    sub: user?.id ?? `anon-${randomUUID()}`,
    topics,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  return NextResponse.json(
    { enabled: true, token, expiresAt, topics, role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
