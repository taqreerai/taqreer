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
import {
  GENCHAT_MAX,
  GenChatEntrySchema,
  type GenChatEntry,
} from "@/lib/schema/slide";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";

/**
 * ATOMIC push-only append - for writers that may run CONCURRENTLY (a
 * multi-slide partial regen fans its per-slide steps out via Promise.all,
 * and Inngest may execute them in separate invocations, so the
 * read-modify-write appendGenChat below could lose entries there - CR PR
 * #128). One SQL statement: merge + cap-trim + write under the row lock,
 * RETURNING the post-write feed for the live broadcast. No locks beyond
 * the row UPDATE itself (advisory/session SQL is banned on the prod
 * transaction pooler). Use appendGenChat instead when the mutation must
 * EDIT existing entries (the bake's in-place thinking ticker - a single
 * sequential writer by construction).
 */
export async function appendGenChatEntries(
  projectId: string,
  versionId: string,
  entries: GenChatEntry[],
  warn: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  try {
    const valid = entries.filter(
      (e) => GenChatEntrySchema.safeParse(e).success,
    );
    if (valid.length !== entries.length) {
      warn("deck_genchat_invalid_entries_dropped", {
        versionId,
        dropped: entries.length - valid.length,
      });
    }
    if (valid.length === 0) return;
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.$queryRaw<{ chat: unknown }[]>(
      Prisma.sql`UPDATE "PresentationVersion" SET "slideJson" = jsonb_set(
        "slideJson",
        '{genChat}',
        (
          SELECT COALESCE(jsonb_agg(t.e ORDER BY t.ord), '[]'::jsonb)
          FROM jsonb_array_elements(
            COALESCE("slideJson"->'genChat', '[]'::jsonb) || ${JSON.stringify(valid)}::jsonb
          ) WITH ORDINALITY AS t(e, ord)
          WHERE t.ord > jsonb_array_length(
            COALESCE("slideJson"->'genChat', '[]'::jsonb) || ${JSON.stringify(valid)}::jsonb
          ) - ${GENCHAT_MAX}
        )
      )
      WHERE id = ${versionId}
      RETURNING "slideJson"->'genChat' AS chat`,
    );
    const chat: GenChatEntry[] = Array.isArray(rows[0]?.chat)
      ? (rows[0].chat as GenChatEntry[])
      : valid;
    broadcastToProject(projectId, "deck.genchat", {
      versionId,
      entries: chat.map((e) => (e.thumbs ? { ...e, thumbs: undefined } : e)),
    }).catch((err) => {
      warn("deck_genchat_broadcast_failed", {
        versionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    warn("deck_genchat_write_failed", {
      versionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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
    // Persist only schema-valid entries (CR PR #128): the mutate callbacks
    // carry model-derived text (thinking summaries, verdict lines) and the
    // stored array is DB state read back by every client - one malformed
    // entry would ride forever. Writers construct valid shapes, so a drop
    // here is a bug signal worth a warn, never a crash.
    const valid = chat.filter((e) => GenChatEntrySchema.safeParse(e).success);
    if (valid.length !== chat.length) {
      warn("deck_genchat_invalid_entries_dropped", {
        versionId,
        dropped: chat.length - valid.length,
      });
    }
    while (valid.length > GENCHAT_MAX) valid.shift();
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "PresentationVersion" SET "slideJson" = jsonb_set("slideJson", '{genChat}', ${JSON.stringify(valid)}::jsonb) WHERE id = ${versionId}`,
    );
    // LIVE tick (owner directive 2026-07-10: "the chat broadcast needs to
    // be live"): push the feed over the project channel so the studio
    // updates the instant the server writes - polls stay as the no-replay
    // fallback. Thumbs stripped for the wire; the client keeps the thumbs
    // it already has. Detached on purpose, but a rejection must not become
    // an unhandled-rejection crash (CR PR #128).
    broadcastToProject(projectId, "deck.genchat", {
      versionId,
      entries: valid.map((e) => (e.thumbs ? { ...e, thumbs: undefined } : e)),
    }).catch((err) => {
      warn("deck_genchat_broadcast_failed", {
        versionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    warn("deck_genchat_write_failed", {
      versionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
