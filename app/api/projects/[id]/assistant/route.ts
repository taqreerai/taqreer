// GET  /api/projects/[id]/assistant  - the editor assistant thread (latest 60)
// POST /api/projects/[id]/assistant  - ask: { message, scope }
//
// Editor assistant (lib/assistant/assistant.ts). Edit access only: the thread
// can propose paid edits on the deck. Asking is free (Haiku), capped per user
// per day; an edit comes back as a PRICED proposal the user confirms through
// ./[messageId]/route.ts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { rateLimited } from "@/lib/api/rate-limit";
import { regenCreditGate, toJson } from "@/lib/api/regen-helpers";
import { regenCost } from "@/lib/credits/cost";
import { creditCostFor, ensureFresh, getRegenBaseCredits, regenPresetFor } from "@/lib/config/runtime-config";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { scanGenImages } from "@/lib/images/slide-images";
import { IMAGE_CREDITS_PER_IMAGE } from "@/lib/credits/cost";
import { ASSISTANT_DAILY_CAP, askAssistant, type AssistantProposal, type AssistantScope } from "@/lib/assistant/assistant";

export const runtime = "nodejs";

const BoundsSchema = z.object({
  x: z.number().min(0).max(1920),
  y: z.number().min(0).max(1920),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1920),
});
const AskSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  // The studio's interface language (the reply follows the user, this is the fallback).
  lang: z.enum(["ar", "en"]).optional(),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("deck") }),
    z.object({ kind: z.literal("slide"), slideId: z.string().min(1).max(128) }),
    z.object({ kind: z.literal("area"), slideId: z.string().min(1).max(128), bounds: BoundsSchema }),
  ]),
});


const SELECT = { id: true, role: true, content: true, proposalJson: true, status: true, createdAt: true } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const rows = await prisma.assistantMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: SELECT,
  });
  return NextResponse.json({ messages: rows.reverse() });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveProjectAccess(id, "edit");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const userId = access.user.prismaId;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = rateLimited(`assistant:${userId}`, 8, 60_000);
  if (limited) return limited;

  const parsed = AskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { message } = parsed.data;
  const scope = parsed.data.scope as AssistantScope;

  // Free daily cap (questions and edit requests alike; the model call is the cost).
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await prisma.assistantMessage.count({ where: { userId, role: "user", createdAt: { gte: since } } });
  if (used >= ASSISTANT_DAILY_CAP) {
    return NextResponse.json({ error: "assistant_daily_cap", cap: ASSISTANT_DAILY_CAP }, { status: 429 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      userId: true,
      user: { select: { role: true, plan: true } },
      presentation: { select: { id: true, currentVersionId: true } },
    },
  });
  const version = project?.presentation?.currentVersionId
    ? await prisma.presentationVersion.findUnique({
        where: { id: project.presentation.currentVersionId },
        select: { slideJson: true },
      })
    : null;
  const manifest = SlideManifestSchema.safeParse(version?.slideJson);
  if (!project?.presentation || !manifest.success || manifest.data.slides.length === 0) {
    return NextResponse.json({ error: "Deck not ready" }, { status: 409 });
  }
  const slides = manifest.data.slides;
  let scopeSlideNumber: number | null = null;
  if (scope.kind !== "deck") {
    const idx = slides.findIndex((s) => s.slideId === scope.slideId);
    if (idx < 0) return NextResponse.json({ error: "Slide not found" }, { status: 404 });
    scopeSlideNumber = idx + 1;
  }

  const history = await prisma.assistantMessage.findMany({
    where: { projectId: id, userId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });

  // What each of the user's own pictures shows (Enhance analysis), so "the
  // think, pair, share picture" can be matched to its id.
  let pictureNotes: Map<string, string> | undefined;
  if (slides.some((s) => s.html.includes("data-asset="))) {
    const job = await prisma.job.findFirst({
      where: { projectId: id, type: "deck.generate", status: "succeeded" },
      orderBy: { createdAt: "desc" },
      select: { inputJson: true },
    });
    const pictures = (job?.inputJson as { carried?: { pictures?: unknown } } | null)?.carried?.pictures;
    if (Array.isArray(pictures)) {
      pictureNotes = new Map(
        pictures.flatMap((p: { assetId?: unknown; shows?: unknown }) =>
          typeof p?.assetId === "string" && typeof p.shows === "string" ? [[p.assetId, p.shows.slice(0, 80)] as const] : [],
        ),
      );
    }
  }

  let answer;
  try {
    answer = await askAssistant({
      slides,
      pictureNotes,
      scope,
      scopeSlideNumber,
      message,
      history: history.reverse().map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
      language: parsed.data.lang ?? (manifest.data.language === "en" ? "en" : "ar"),
    });
  } catch (err) {
    console.warn("assistant_ask_failed", { projectId: id, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "assistant_unavailable" }, { status: 502 });
  }

  // Price an edit exactly like the partial regen will (same preset, same formula).
  let proposal: AssistantProposal | null = null;
  if (answer.edit) {
    const locks = await prisma.slideState.findMany({
      where: { presentationId: project.presentation.id, lockedAt: { not: null } },
      select: { slideKey: true },
    });
    const locked = new Set(locks.map((l) => l.slideKey));
    const numbers = answer.edit.slides.filter((n) => !locked.has(slides[n - 1].slideId));
    if (numbers.length > 0) {
      await ensureFresh();
      const genJob = await prisma.job.findFirst({
        where: { projectId: id, type: "deck.generate", status: "succeeded" },
        orderBy: { createdAt: "desc" },
        select: { quality: true },
      });
      const cost = regenCost(regenPresetFor(genJob?.quality), numbers.length, creditCostFor, getRegenBaseCredits());
      const gate = await regenCreditGate({
        ownerId: project.userId,
        ownerRole: project.user?.role ?? "user",
        ownerPlan: project.user?.plan ?? null,
        cost,
      });
      proposal = {
        instruction: answer.edit.instruction,
        slideIds: numbers.map((n) => slides[n - 1].slideId),
        slideNumbers: numbers,
        cost,
        bounds: scope.kind === "area" ? scope.bounds : null,
        gate,
      };
    }
  }

  // An AI image re-roll: the box must exist on that slide; priced per image.
  if (!proposal && answer.image) {
    const slide = slides[answer.image.slide - 1];
    const box = scanGenImages(slide.html).find((g) => g.genid === answer.image!.genid);
    const lock = await prisma.slideState.findFirst({
      where: { presentationId: project.presentation.id, slideKey: slide.slideId, lockedAt: { not: null } },
      select: { id: true },
    });
    if (box && !lock) {
      const gate = await regenCreditGate({
        ownerId: project.userId,
        ownerRole: project.user?.role ?? "user",
        ownerPlan: project.user?.plan ?? null,
        cost: IMAGE_CREDITS_PER_IMAGE,
      });
      proposal = {
        kind: "image",
        instruction: answer.image.change,
        change: answer.image.change,
        genid: box.genid,
        slideIds: [slide.slideId],
        slideNumbers: [answer.image.slide],
        cost: IMAGE_CREDITS_PER_IMAGE,
        bounds: null,
        gate,
      };
    }
  }

  const [userRow, botRow] = await prisma.$transaction([
    prisma.assistantMessage.create({
      data: { projectId: id, userId, role: "user", content: message, proposalJson: toJson({ scope }) },
      select: SELECT,
    }),
    prisma.assistantMessage.create({
      data: {
        projectId: id,
        userId,
        role: "assistant",
        content: answer.reply,
        ...(proposal ? { proposalJson: toJson(proposal), status: "proposed" } : {}),
      },
      select: SELECT,
    }),
  ]);
  return NextResponse.json({ messages: [userRow, botRow], remaining: ASSISTANT_DAILY_CAP - used - 1 });
}
