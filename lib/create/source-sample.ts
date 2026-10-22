// The text of a /create content upload, for the Auto design-style pick
// (2026-10-19). The upload reaches generation as an Anthropic file id only; its
// text layer sits on the completed source-extract Job that produced that id
// (fullText for PDFs, textPerSlide for PPTX). Scoped to the caller's own jobs
// from the last day. "" when nothing is found. Server-only.

import { prisma } from "@/lib/prisma";

export async function uploadedSourceText(
  supabaseUserId: string,
  anthropicFileId: string,
): Promise<string> {
  try {
    const job = await prisma.job.findFirst({
      where: {
        type: "source-extract",
        status: "completed",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        inputJson: { path: ["supabaseUserId"], equals: supabaseUserId },
        outputJson: { path: ["anthropicFileId"], equals: anthropicFileId },
      },
      orderBy: { createdAt: "desc" },
      select: { outputJson: true },
    });
    const out = (job?.outputJson ?? {}) as {
      fullText?: unknown;
      textPerSlide?: unknown;
    };
    if (typeof out.fullText === "string" && out.fullText.trim()) return out.fullText;
    if (Array.isArray(out.textPerSlide)) {
      return out.textPerSlide.filter((t): t is string => typeof t === "string").join("\n");
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Enhance "Auto" change level: the Rework / Preserve decision the extract job
 * recorded for this user's uploaded source (lib/extract/rework-score.ts).
 * Null when the job is missing or older than the field.
 */
export async function uploadedReworkMode(
  supabaseUserId: string,
  sourcePath: string,
): Promise<"rework" | "preserve" | null> {
  try {
    const job = await prisma.job.findFirst({
      where: {
        type: "source-extract",
        status: "completed",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        inputJson: { path: ["supabaseUserId"], equals: supabaseUserId },
        outputJson: { path: ["sourcePath"], equals: sourcePath },
      },
      orderBy: { createdAt: "desc" },
      select: { outputJson: true },
    });
    const mode = (job?.outputJson as { rework?: { mode?: unknown } } | null)?.rework?.mode;
    return mode === "rework" || mode === "preserve" ? mode : null;
  } catch {
    return null;
  }
}
