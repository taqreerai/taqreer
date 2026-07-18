// POST /api/projects/[id]/export/log
//
// Durable export-activity logging for the CLIENT-side export pipelines (PPTX +
// Google Slides), which build the artifact in the browser and so have no server
// route to write an ExportEvent from. The server-side pdf/png routes write their
// own rows directly; this endpoint exists only for the browser-built formats.
//
// Auth: SAME check the pdf/png routes use (resolveProjectAccess "view"): the
// caller must be able to see the deck. The row is attributed to the exporter's
// prisma id; anonymous public-view callers (no prismaId) are a silent no-op.
// The format is whitelisted to the client-built values so a forged request
// can't spoof a "pdf"/"png" row (those are authoritative from their routes).

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";

export const runtime = "nodejs";

const CLIENT_FORMATS = new Set(["pptx", "gslides", "gslides_fallback_pptx"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimited(`export-log:${clientIp(request)}`, 60, 5 * 60_000);
  if (limited) return limited;

  const { id: projectId } = await params;
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  // Anonymous public-view exporter: nothing to attribute, silent no-op.
  if (!access.user.prismaId) {
    return NextResponse.json({ logged: false });
  }

  const body = (await request.json().catch(() => null)) as {
    format?: unknown;
    slideCount?: unknown;
  } | null;
  const format = typeof body?.format === "string" ? body.format : "";
  if (!CLIENT_FORMATS.has(format)) {
    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  }
  const slideCount =
    typeof body?.slideCount === "number" &&
    Number.isInteger(body.slideCount) &&
    body.slideCount >= 0
      ? body.slideCount
      : null;

  try {
    await prisma.exportEvent.create({
      data: { userId: access.user.prismaId, projectId, format, slideCount },
    });
  } catch (err) {
    console.error("[export/log] activity log failed", err);
    // Best-effort: never surface a logging failure as a client error.
    return NextResponse.json({ logged: false });
  }
  return NextResponse.json({ logged: true });
}
