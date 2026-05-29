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

// ─── Landing-page templates grid ──────────────────────────────────
//
// Distinct from the marquee: the landing "#templates" section renders a
// 2 × 4 grid of whole templates (not de-aggregated slides), each tile
// scrubbing through its own deck slides on hover. So this loader returns
// per-template slide arrays rather than a flat thumbnail list.

export type LandingTemplate = {
  id: string;
  // Shown in the lightbox header when a tile is opened.
  title: string;
  // "16:9" | "9:16" — drives the tile's object-fit crop.
  format: string;
  // Premium templates show the "مميز" badge + gate their use behind the
  // Pro plan (enforced server-side in /api/templates/[id]/use).
  isPremium: boolean;
  // Per-slide WebP URLs in deck order (cover first), showcase slides
  // excluded. The hover-scrub walks this array.
  slides: string[];
};

// 2 rows × 4 columns on the landing templates section.
const LANDING_TEMPLATE_COUNT = 8;

/**
 * Fetch up to 8 random public curator templates for the landing grid,
 * each with its real deck slides (synthetic typography/palette showcase
 * slides stripped). Same curator-gating + 60 s cache as the marquee.
 */
export const getLandingTemplates = unstable_cache(
  async (): Promise<LandingTemplate[]> => {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string;
          title: string;
          format: string | null;
          isPremium: boolean;
          thumbnails: string[];
        }[]
      >`
        SELECT t.id,
               t.title,
               (t.brand->>'format') AS format,
               t."isPremium" AS "isPremium",
               t."thumbnailUrls" AS thumbnails
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
        ORDER BY random()
        LIMIT ${LANDING_TEMPLATE_COUNT}
      `;

      return rows
        .map((row) => ({
          id: row.id,
          title: row.title,
          format: row.format ?? "16:9",
          isPremium: row.isPremium,
          // Drop the synthetic typography + palette showcase slides
          // (template-prefix showcase-*.webp); keep the real deck
          // slides (cover + rest) in their stored order.
          slides: (row.thumbnails ?? []).filter(
            (url) => url && !url.includes("/showcase-"),
          ),
        }))
        .filter((tpl) => tpl.slides.length > 0);
    } catch (err) {
      // DB hiccup → render no grid (the section just collapses).
      console.error("[landing/templates] query failed", err);
      return [];
    }
  },
  ["landing-templates"],
  { revalidate: 60, tags: ["landing-templates"] },
);
