// Server-side data loader for the auth-layout marquee background.
//
// Picks a randomized batch of project thumbnails to scroll behind the
// signup / login / forgot-password modal. Cached for 60 s via
// `unstable_cache` so a refresh during testing doesn't hammer Postgres,
// but short enough that the wall stays "alive" across sessions.
//
// Privacy policy (user-direction 2026-05-28): the marquee is gated to
// thumbnails from a single source account (`MARQUEE_OWNER_EMAIL`
// below) — we do NOT surface other users' decks on the public auth
// pages. Earlier draft pulled from ALL projects with a thumbnail;
// reverted because it exposed unrelated users' work-in-progress.
// To rotate accounts (or open up to a list), update the constant or
// switch to an `IN (...)` filter.

// The marquee is fed exclusively by this account's published work.
// Change this constant to point the wall at a different curator.
const MARQUEE_OWNER_EMAIL = "taqreermail@gmail.com";
//
// Output shape: 4 columns × variable thumbs (see `COLUMN_COUNT`).
// The shuffler interleaves 16:9 and 9:16 formats across columns so
// the mosaic doesn't end up with all landscape on one side and all
// portrait on the other.

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

export type MarqueeThumbnail = {
  // Composite key (project id + slide index) so React's `key` prop stays
  // stable across renders even though we de-aggregate the per-slide URLs.
  id: string;
  thumbnail: string;
  // "16:9" | "9:16" — drives the aspect-ratio CSS for the column tile.
  format: string;
};

export type MarqueeColumns = MarqueeThumbnail[][];

// 4 columns × ~10 rows each = 40 thumbs. Paired with the 30°
// rotation of the wall and the centered modal, the 4-col grid reads
// as a tilted mosaic with enough variety to feel populated.
// (12 → 6 → 3 → 4 over four iterations, 2026-05-28 — user iterating
// on visual weight.)
const COLUMN_COUNT = 4;
const ROWS_PER_COLUMN = 10;
const SAMPLE_SIZE = COLUMN_COUNT * ROWS_PER_COLUMN;

/**
 * Fetch a random batch of project thumbnails grouped into `COLUMN_COUNT` columns.
 * Cached 60 s so repeated /signup hits during the same session reuse
 * the same wall (avoids the visual flicker of every page-nav reshuffling).
 */
export const getMarqueeColumns = unstable_cache(
  async (): Promise<MarqueeColumns> => {
    try {
      // Raw SQL because Prisma doesn't expose ORDER BY random(); doing
      // it in JS over a large set would mean reading every row. The
      // LIMIT after random() lets Postgres do the work efficiently.
      //
      // Source is `Project.thumbnailUrls` (an array of per-slide WebP
      // URLs in Supabase storage), NOT `Project.thumbnail` (legacy
      // single-shot column that's empty on most decks). UNNEST so each
      // slide becomes its own marquee tile — a 5-slide deck contributes
      // 5 distinct images, giving the wall more variety. The composite
      // `id || '-' || slide_index` keeps React keys stable across
      // re-renders.
      //
      // Inner join on `User` filters to the curator account
      // (`MARQUEE_OWNER_EMAIL`) so the public auth pages only ever
      // show that account's work — no risk of leaking other users'
      // private decks.
      const rows = await prisma.$queryRaw<MarqueeThumbnail[]>`
        SELECT
          id || '-' || slide_index AS id,
          thumbnail,
          format
        FROM (
          SELECT p.id, p.format,
                 unnest(p."thumbnailUrls") AS thumbnail,
                 generate_subscripts(p."thumbnailUrls", 1) AS slide_index
          FROM "Project" p
          INNER JOIN "User" u ON p."userId" = u.id
          WHERE u.email = ${MARQUEE_OWNER_EMAIL}
            AND p."thumbnailUrls" IS NOT NULL
            AND array_length(p."thumbnailUrls", 1) > 0
        ) slides
        ORDER BY random()
        LIMIT ${SAMPLE_SIZE}
      `;

      if (rows.length === 0) return Array.from({ length: COLUMN_COUNT }, () => []);

      // Distribute across columns round-robin so adjacent indices land
      // in different columns (avoids visual clumping when the sample
      // happens to have multiple thumbs from the same brand).
      const columns: MarqueeColumns = Array.from(
        { length: COLUMN_COUNT },
        () => [],
      );
      rows.forEach((row, idx) => {
        columns[idx % COLUMN_COUNT].push(row);
      });
      return columns;
    } catch (err) {
      // DB hiccup → render with no thumbnails (the modal still works,
      // the background falls back to --tq-bg solid).
      console.error("[auth/marquee] random-thumbnails query failed", err);
      return Array.from({ length: COLUMN_COUNT }, () => []);
    }
  },
  ["auth-marquee-columns"],
  { revalidate: 60, tags: ["auth-marquee-columns"] },
);

export const MARQUEE_COLUMN_COUNT = COLUMN_COUNT;
