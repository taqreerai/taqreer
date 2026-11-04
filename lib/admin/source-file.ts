// The file behind a deck, for the admin compare page (owner, 2026-11-04).
//
// Enhance keeps the upload's path on the brief; Create and mimic keep only an
// Anthropic file id, which leads back to its source-extract job. That id comes
// from the client, so the file found must sit in the deck owner's own folder.
// Uploads stay in the private source-files bucket for 7 days
// (inngest/functions/source-files-cleanup.ts), so an older deck has none, and
// a deck made from a typed prompt never had one. Server-only.

import "server-only";
import { prisma } from "@/lib/prisma";

export const SOURCE_FILES_BUCKET = "source-files";
export const SOURCE_RETENTION_DAYS = 7;

export type SourceFileRef = {
  path: string;
  mime: string;
  uploadedAt: Date;
};

type BriefSource = {
  sourcePath?: unknown;
  sourceMime?: unknown;
  anthropicFileId?: unknown;
  uglyAnthropicFileId?: unknown;
};

/** Where this deck's upload was stored, or null when it was made without one. */
export async function findSourceFile(projectId: string): Promise<SourceFileRef | null> {
  const owner = await prisma.project.findUnique({
    where: { id: projectId },
    select: { user: { select: { supabaseUserId: true } } },
  });
  const ownerPrefix = owner?.user.supabaseUserId ? `${owner.user.supabaseUserId}/` : null;
  if (!ownerPrefix) return null;
  const jobs = await prisma.job.findMany({
    where: { projectId, type: "deck.generate" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { inputJson: true, createdAt: true },
  });
  for (const job of jobs) {
    const source = (job.inputJson as { brief?: { source?: BriefSource } } | null)?.brief?.source;
    if (!source) continue;
    if (typeof source.sourcePath === "string" && typeof source.sourceMime === "string") {
      if (!source.sourcePath.startsWith(ownerPrefix)) continue;
      return { path: source.sourcePath, mime: source.sourceMime, uploadedAt: job.createdAt };
    }
    const fileId = source.anthropicFileId ?? source.uglyAnthropicFileId;
    if (typeof fileId === "string") {
      const extract = await prisma.job.findFirst({
        where: {
          type: "source-extract",
          outputJson: { path: ["anthropicFileId"], equals: fileId },
        },
        orderBy: { createdAt: "desc" },
        select: { outputJson: true, createdAt: true },
      });
      const out = (extract?.outputJson ?? {}) as { sourcePath?: unknown; sourceMime?: unknown };
      if (extract && typeof out.sourcePath === "string" && out.sourcePath.startsWith(ownerPrefix) && typeof out.sourceMime === "string") {
        return { path: out.sourcePath, mime: out.sourceMime, uploadedAt: extract.createdAt };
      }
    }
  }
  return null;
}
