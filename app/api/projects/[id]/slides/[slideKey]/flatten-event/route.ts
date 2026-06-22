// POST /api/projects/[id]/slides/[slideKey]/flatten-event
//
// Telemetry sink for the flatten fidelity observatory (generate > learn > enhance).
// The in-canvas editor's flatten pass returns a parity report; DeckView POSTs here
// ONLY when there is signal (a content shortfall today; measurable style drift once
// the Phase 1 census lands). It records a FlattenEvent row + a PostHog event for the
// offline learn loop.
//
// Advisory + best-effort: it NEVER gates anything (the lossless content gate lives in
// flatten.ts) and NEVER throws to the client - a telemetry hiccup must not disrupt
// editing, so DB errors return 200 { ok: false }.
//
// PRIVACY: IDs + STRUCTURAL metadata only. A dropped-word COUNT (never the words) and
// (Phase 1) drift property names + getComputedStyle values (a colour / radius is
// structural, not content). No user HTML; the offline miner reconstructs it from the
// user's own slideJson stores under existing access control.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { captureServerEvent } from "@/lib/analytics/posthog-server";

// A fidelity payload is ~1-2 KB (the drift list is capped); reject an order of
// magnitude larger rather than letting a runaway payload balloon the row.
const MAX_BYTES = 16 * 1024;
const MAX_DRIFTS = 20;

type DriftIn = {
  fidx?: unknown;
  prop?: unknown;
  src?: unknown;
  out?: unknown;
  severity?: unknown;
};
type Payload = {
  parityOk?: unknown;
  missingCount?: unknown;
  fidelityScore?: unknown;
  leafCount?: unknown;
  highDrift?: unknown;
  styleDrifts?: unknown;
};

const num = (v: unknown, d = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slideKey: string }> },
) {
  const { id: projectId, slideKey } = await params;
  // Edit access required (same gate as the edit / restore routes).
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  // No app user row to attribute the FK to (anonymous / pending share): accept + drop.
  if (!access.user.prismaId) return NextResponse.json({ ok: false });

  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.parityOk !== "boolean") {
    return NextResponse.json({ error: "parityOk required" }, { status: 400 });
  }

  const parityOk = body.parityOk;
  const missingCount = Math.max(0, Math.round(num(body.missingCount)));
  const fidelityScore =
    typeof body.fidelityScore === "number" && Number.isFinite(body.fidelityScore)
      ? Math.min(1, Math.max(0, body.fidelityScore))
      : null;
  const leafCount = Math.max(0, Math.round(num(body.leafCount)));
  const highDrift = Math.max(0, Math.round(num(body.highDrift)));
  // Drift detail: capped + STRUCTURAL fields only (prop names + computed values), never content.
  const drifts = Array.isArray(body.styleDrifts)
    ? (body.styleDrifts as DriftIn[]).slice(0, MAX_DRIFTS).map((d) => ({
        fidx: num(d?.fidx),
        prop: typeof d?.prop === "string" ? d.prop.slice(0, 64) : "",
        src: typeof d?.src === "string" ? d.src.slice(0, 128) : "",
        out: typeof d?.out === "string" ? d.out.slice(0, 128) : "",
        severity: d?.severity === "high" ? "high" : "low",
      }))
    : [];

  try {
    await prisma.flattenEvent.create({
      data: {
        userId: access.user.prismaId,
        projectId,
        slideId: slideKey,
        parityOk,
        missingCount,
        fidelityScore,
        leafCount,
        highDrift,
        metadata: drifts.length ? { styleDrifts: drifts } : undefined,
      },
    });
  } catch (err) {
    // A telemetry write must never break the editor.
    console.error("[flatten-event] insert failed:", err);
    return NextResponse.json({ ok: false });
  }

  // Audit tier: server-side capture (not consent-gated, same as every posthog-node
  // event), keyed on the Supabase uid so it lines up with the client identity.
  if (access.user.id) {
    captureServerEvent(access.user.id, "flatten.fidelity", {
      parityOk,
      missingCount,
      fidelityScore,
      highDrift,
      leafCount,
    });
  }
  return NextResponse.json({ ok: true });
}
