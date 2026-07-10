// GenChat persistence - the backend-transparency feed's single writer.
// Shared by deck-freeze-bake (review ask / thinking / verdicts / revision
// proof / baked) and deck-regenerate-partial (per-slide redesign milestones),
// so the studio shows ONE continuous chat across generation, bake, and regen.
//
// Writes go through jsonb_set targeting ONLY the genChat key, so a
// concurrent slide edit can never be clobbered by a chat tick. Best-effort
// by contract: the feed must never fail the job that writes it - errors are
// reported through the caller's `warn` and swallowed.

import { Prisma } from "@prisma/client";
import { GENCHAT_MAX, type GenChatEntry } from "@/lib/schema/slide";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

export async function appendGenChat(
  projectId: string,
  versionId: string,
  mutate: (chat: GenChatEntry[]) => void,
  warn: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<{ chat: unknown }[]>(
      Prisma.sql`SELECT "slideJson"->'genChat' AS chat FROM "PresentationVersion" WHERE id = ${versionId}`,
    );
    const chat: GenChatEntry[] = Array.isArray(rows[0]?.chat)
      ? (rows[0].chat as GenChatEntry[])
      : [];
    mutate(chat);
    while (chat.length > GENCHAT_MAX) chat.shift();
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "PresentationVersion" SET "slideJson" = jsonb_set("slideJson", '{genChat}', ${JSON.stringify(chat)}::jsonb) WHERE id = ${versionId}`,
    );
    // LIVE tick (owner directive 2026-07-10: "the chat broadcast needs to
    // be live"): push the feed over the project channel so the studio
    // updates the instant the server writes - polls stay as the no-replay
    // fallback. Thumbs stripped for the wire; the client keeps the thumbs
    // it already has.
    void broadcastToProject(projectId, "deck.genchat", {
      versionId,
      entries: chat.map((e) => (e.thumbs ? { ...e, thumbs: undefined } : e)),
    });
  } catch (err) {
    warn("deck_genchat_write_failed", {
      versionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
