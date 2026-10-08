// Why a deck's generation failed, as far as the user needs to know
// (2026-10-08). "declined": the model wrote no slides for the request (a
// refusal / prose reply), so the screen asks the user to rephrase instead of
// offering a retry that would only decline again. null: a generic failure.
// Server-only.

import { prisma } from "@/lib/prisma";

export type GenerationFailReason = "declined" | null;

export async function generationFailReason(projectId: string): Promise<GenerationFailReason> {
  const job = await prisma.job.findFirst({
    where: { projectId, type: "deck.generate", status: "failed" },
    orderBy: { createdAt: "desc" },
    select: { outputJson: true },
  });
  const error = (job?.outputJson as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.startsWith("DECLINED") ? "declined" : null;
}
