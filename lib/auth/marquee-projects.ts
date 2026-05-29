// Server-side data loader for the auth-layout marquee background AND the
// landing "قوالب جاهزة" slideshow (both consume getMarqueeColumns).
//
// Picks a randomized batch of TEMPLATE slide thumbnails — the curator
// account's PUBLIC templates — to scroll behind the signup / login /
// forgot-password modal + the landing card. Cached for 60 s via
// `unstable_cache` so a refresh during testing doesn't hammer Postgres,
// but short enough that the wall stays "alive" across sessions.
//
// The synthetic typography + palette showcase slides are excluded — only
// the real deck slides (cover + rest) ride the marquee.
//
// Privacy / curation policy: gated to a single curator account
// (`MARQUEE_OWNER_EMAIL`) — we do NOT surface other users' templates on
// the public surfaces. To rotate accounts (or open up to a list),
// update the constant or switch to an `IN (...)` filter.

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
  // Composite key (template id + slide index) so React's `key` prop stays
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
 * Fetch a random batch of public-template slide thumbnails grouped into
 * `COLUMN_COUNT` columns (showcase typography/palette slides excluded).
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
      // Source is `Template.thumbnailUrls` (per-slide WebP URLs).
      // UNNEST so each slide becomes its own marquee tile. The outer
      // `NOT LIKE '%/showcase-%'` drops the synthetic typography +
      // palette slides (template-prefix files) — only real deck slides
      // ride the wall. `format` comes from the brand JSON. The composite
      // `id || '-' || slide_index` keeps React keys stable.
      //
      // Inner join on `User` + `isPublic = true` gates to the curator
      // account's PUBLISHED templates — no other users' templates leak
      // onto the public surfaces.
      const rows = await prisma.$queryRaw<MarqueeThumbnail[]>`
        SELECT
          id || '-' || slide_index AS id,
          thumbnail,
          format
        FROM (
          SELECT t.id, (t.brand->>'format') AS format,
                 unnest(t."thumbnailUrls") AS thumbnail,
                 generate_subscripts(t."thumbnailUrls", 1) AS slide_index
          FROM "Template" t
          INNER JOIN "User" u ON t."ownerId" = u.id
          WHERE u.email = ${MARQUEE_OWNER_EMAIL}
            AND t."isPublic" = true
            AND t."thumbnailUrls" IS NOT NULL
            AND array_length(t."thumbnailUrls", 1) > 0
        ) slides
        -- Exclude the synthetic typography + palette showcase slides
        -- (stored under the template prefix as showcase-*.webp). Only the
        -- real deck slides (cover + rest, which point at the project's
        -- own storage path) should ride the marquee.
        WHERE thumbnail NOT LIKE '%/showcase-%'
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
