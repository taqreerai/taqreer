// POST /api/projects/[id]/assistant/[messageId]  { action: "apply" | "cancel" }
//
// Confirm (or dismiss) an editor-assistant edit proposal. Apply creates one
// forAi comment per target slide, holding the proposal's instruction (and the
// drawn area for an area edit), then runs the normal partial regen on ONLY
// those comments (lib/api/partial-regen.ts): the same credit gate, version,
// worker and realtime as an AI comment, so the quoted price is the charged one.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { applyAiComments } from "@/lib/api/partial-regen";
import { toJson } from "@/lib/api/regen-helpers";
import type { AssistantProposal } from "@/lib/assistant/assistant";

export const runtime = "nodejs";

// "done": an IMAGE proposal ran through the image regen route (charged there),
// the studio only records the outcome here.
const BodySchema = z.object({ action: z.enum(["apply", "cancel", "done"]) });
// A quote older than this is re-asked rather than applied (prices and the deck move).
const PROPOSAL_TTL_MS = 60 * 60 * 1000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { id, messageId } = await params;
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const userId = access.user.prismaId;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const msg = await prisma.assistantMessage.findFirst({
    where: { id: messageId, projectId: id, role: "assistant", status: "proposed" },
    select: { id: true, proposalJson: true, createdAt: true },
  });
  if (!msg) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  if (body.data.action === "cancel") {
    await prisma.assistantMessage.updateMany({ where: { id: msg.id, status: "proposed" }, data: { status: "cancelled" } });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }
  const kind = (msg.proposalJson as { kind?: string } | null)?.kind;
  if (body.data.action === "done") {
    if (kind !== "image") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    await prisma.assistantMessage.updateMany({ where: { id: msg.id, status: "proposed" }, data: { status: "applied" } });
    return NextResponse.json({ ok: true, status: "applied" });
  }
  if (kind === "image") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (Date.now() - msg.createdAt.getTime() > PROPOSAL_TTL_MS) {
    return NextResponse.json({ error: "proposal_expired" }, { status: 410 });
  }
  const proposal = msg.proposalJson as AssistantProposal | null;
  if (!proposal || !Array.isArray(proposal.slideIds) || proposal.slideIds.length === 0) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Claim it (a double click or two tabs must not apply twice).
  const claimed = await prisma.assistantMessage.updateMany({
    where: { id: msg.id, status: "proposed" },
    data: { status: "applying" },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "Already applied" }, { status: 409 });
  const release = () =>
    prisma.assistantMessage.updateMany({ where: { id: msg.id, status: "applying" }, data: { status: "proposed" } });

  const presentation = await prisma.presentation.findUnique({
    where: { projectId: id },
    select: { id: true, currentVersionId: true },
  });
  if (!presentation?.currentVersionId) {
    await release();
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  // Slides locked since the quote are left out (never edited by the AI).
  const locks = await prisma.slideState.findMany({
    where: { presentationId: presentation.id, slideKey: { in: proposal.slideIds }, lockedAt: { not: null } },
    select: { slideKey: true },
  });
  const locked = new Set(locks.map((l) => l.slideKey));
  const targets = proposal.slideIds.filter((s) => !locked.has(s));
  if (targets.length === 0) {
    await release();
    return NextResponse.json({ error: "All target slides are locked" }, { status: 423 });
  }

  const created = await prisma.$transaction(
    targets.map((slideId) =>
      prisma.comment.create({
        data: {
          presentationId: presentation.id,
          versionId: presentation.currentVersionId!,
          slideId,
          authorId: userId,
          content: proposal.instruction,
          boundsJson: toJson(proposal.bounds ?? null),
          status: "draft",
          forAi: true,
        },
        select: { id: true },
      }),
    ),
  );
  const commentIds = created.map((c) => c.id);

  const res = await applyAiComments(id, { commentIds });
  const data = (await res.clone().json().catch(() => null)) as { versionId?: string } | null;
  if (!res.ok || !data?.versionId) {
    // Nothing ran: drop the comments (still drafts) and reopen the proposal, so
    // a top-up and a second Confirm work. The gate body passes through.
    await prisma.comment.deleteMany({ where: { id: { in: commentIds }, status: "draft" } });
    await release();
    return res;
  }
  await prisma.assistantMessage.update({
    where: { id: msg.id },
    data: { status: "applied", proposalJson: toJson({ ...proposal, versionId: data.versionId }) },
  });
  return res;
}
