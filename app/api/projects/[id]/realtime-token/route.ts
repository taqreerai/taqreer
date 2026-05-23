// GET /api/projects/[id]/realtime-token
//
// Pre-flight gate for opening a Supabase Realtime channel for a project.
// The channel name is just `project:{id}` (clients already know the
// projectId), so this isn't a cryptographic token — it's a
// `resolveProjectAccess` check the client runs BEFORE attaching the
// socket. Two purposes:
//
//   1. Avoid opening pointless sockets for viewers who don't have
//      access. Without this gate, a logged-in user could open a
//      socket for any projectId they invent and receive presence
//      pings; the broadcast payloads carry only pointers (no content),
//      but it's still cleaner to refuse the connection up front.
//
//   2. A clean place to add stricter signed-JWT auth later if we
//      tighten security. The response shape leaves room — clients
//      that see `{ channel, joinable: true }` today would see
//      `{ channel, token, joinable: true }` once we wire Realtime's
//      `setAuth(token)` path.
//
// Access policy:
//   `view` minimum. Anonymous public-view callers (no auth) on a
//   project with `publicAccessLevel = "view"` are allowed in. They
//   can observe presence + broadcasts but the underlying REST data
//   routes are still gated by their role.

import { NextResponse } from "next/server";
import { resolveProjectAccess } from "@/lib/api/project-access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await resolveProjectAccess(id, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  return NextResponse.json({
    channel: `project:${id}`,
    joinable: true,
    // Surface the caller's role so clients don't have to re-derive it
    // — DeckView already gets role via SSR props but other consumers
    // (e.g. the bell) may want it without a second round-trip.
    role: access.role,
  });
}
