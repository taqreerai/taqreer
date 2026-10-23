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
 * What extraction recorded for this user's /enhance upload: the Rework or
 * Preserve call (lib/extract/rework-score.ts) and the audience the start
 * questions read (lib/extract/enhance-questions.ts). Both null when the job
 * is missing or older than the fields. The audience is read here, never taken
 * from the request.
 */
export async function uploadedEnhanceAnalysis(
  supabaseUserId: string,
  sourcePath: string,
): Promise<{ mode: "rework" | "preserve" | null; audience: string | null }> {
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
    const out = job?.outputJson as { rework?: { mode?: unknown }; questions?: { audience?: unknown } | null } | null;
    const mode = out?.rework?.mode;
    const audience = out?.questions?.audience;
    return {
      mode: mode === "rework" || mode === "preserve" ? mode : null,
      audience: typeof audience === "string" && audience ? audience.slice(0, 80) : null,
    };
  } catch {
    return { mode: null, audience: null };
  }
}
