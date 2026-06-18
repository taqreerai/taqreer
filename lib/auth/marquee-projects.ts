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

// Output shape: 4 columns × variable thumbs (see `COLUMN_COUNT`).
// The shuffler interleaves 16:9 and 9:16 formats across columns so
// the mosaic doesn't end up with all landscape on one side and all
// portrait on the other.

import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

// The curator account whose ADMIN-FEATURED templates (featuredOrder set) feed
// every public template surface. Exported for the admin curation console.
export const MARQUEE_OWNER_EMAIL = "dev@taqreer.ai";

// Bust every cached public template surface after an admin curation write
// (feature / unfeature / reorder / premium) so the landing marquee + grid +
// welcome-email strip reflect the change on the next request.
export function revalidateTemplateSurfaces(): void {
  // Next 16: the 2-arg form is required; "max" marks the tagged entries stale
  // (stale-while-revalidate) so the next visit refreshes them.
  revalidateTag("auth-marquee-columns", "max");
  revalidateTag("landing-templates", "max");
  revalidateTag("welcome-templates", "max");
}

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
          SELECT t.id, CASE WHEN (t.brand->>'format') = '9:16' THEN '9:16' ELSE '16:9' END AS format,
                 unnest(t."thumbnailUrls") AS thumbnail,
                 generate_subscripts(t."thumbnailUrls", 1) AS slide_index
          FROM "Template" t
          INNER JOIN "User" u ON t."ownerId" = u.id
          -- Skip templates whose source deck was deleted: their thumbnails
          -- point at the (now-cleaned) project storage and 404 (broken tiles).
          -- Source-less templates are kept (their previews are template-owned).
          LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
          WHERE u.email = ${MARQUEE_OWNER_EMAIL}
            AND t."isPublic" = true
            AND t."featuredOrder" IS NOT NULL
            AND t."thumbnailUrls" IS NOT NULL
            AND array_length(t."thumbnailUrls", 1) > 0
            AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
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
 * Fetch up to 8 of the most-recently-published public curator templates for
 * the landing grid, each with its real deck slides (synthetic typography/
 * palette showcase slides stripped). Templates whose source deck was deleted
 * (broken thumbnails) are excluded. Same curator-gating + 60 s cache as the
 * marquee.
 */
export const getLandingTemplates = unstable_cache(
  async (): Promise<LandingTemplate[]> => {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string;
          // Already normalized to "16:9" | "9:16" by the SQL CASE.
          format: string;
          isPremium: boolean;
          thumbnails: string[];
        }[]
      >`
        SELECT t.id,
               CASE WHEN (t.brand->>'format') = '9:16' THEN '9:16' ELSE '16:9' END AS format,
               t."isPremium" AS "isPremium",
               t."thumbnailUrls" AS thumbnails
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        -- Exclude templates whose source deck was deleted (broken thumbnails).
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t."featuredOrder" IS NOT NULL
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        -- Admin-curated featured order (admin console > Templates), not recency.
        ORDER BY t."featuredOrder" ASC
        LIMIT ${LANDING_TEMPLATE_COUNT}
      `;

      return rows
        .map((row) => ({
          id: row.id,
          format: row.format,
          isPremium: row.isPremium,
          // Cover slide only (first non-showcase thumbnail). The landing grid no
          // longer scrubs through all slides on hover — a single-slide tile
          // renders just the cover (isMultiSlide=false), so we ship one URL per
          // template instead of the whole deck. The dedicated /presentation-templates
          // page keeps the full scrub via getTemplatesPageList.
          slides: (row.thumbnails ?? [])
            .filter((url) => url && !url.includes("/showcase-"))
            .slice(0, 1),
        }))
        .filter((tpl) => tpl.slides.length > 0);
    } catch (err) {
      // DB hiccup → render no grid (the section just collapses).
      console.error("[landing/templates] query failed", err);
      return [];
    }
  },
  ["landing-templates"],
  // Long TTL (24h) so the landing stays on the warm cache path instead of paying
  // the cold remote-DB query (~2s). Freshness on admin curation is preserved by
  // revalidateTag("landing-templates") in revalidateTemplateSurfaces(); a deploy
  // re-warms it via the /ar health-check.
  { revalidate: 86400, tags: ["landing-templates"] },
);

// ─── Welcome-email template strip ─────────────────────────────────────
//
// The 3 most-recent public curator templates, each as a single cover
// thumbnail, for the welcome email's "or start from a template" strip.
// Same curator-gating + deleted-source exclusion as the landing grid.

export type WelcomeTemplate = { id: string; cover: string };

export const getWelcomeTemplates = unstable_cache(
  async (): Promise<WelcomeTemplate[]> => {
    try {
      const rows = await prisma.$queryRaw<{ id: string; thumbnails: string[] }[]>`
        SELECT t.id, t."thumbnailUrls" AS thumbnails
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t."featuredOrder" IS NOT NULL
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        ORDER BY t."featuredOrder" ASC
        LIMIT 3
      `;
      return rows
        .map((r) => ({
          id: r.id,
          cover:
            (r.thumbnails ?? []).find(
              (u) => u && !u.includes("/showcase-"),
            ) ?? "",
        }))
        .filter((t) => t.cover);
    } catch (err) {
      console.error("[welcome/templates] query failed", err);
      return [];
    }
  },
  ["welcome-templates"],
  { revalidate: 300, tags: ["welcome-templates"] },
);

// ─── /templates marketing page ────────────────────────────────────────
//
// A fuller set of public curator templates for the dedicated /templates SEO
// page: featured first (admin order), then the rest of the curator's public
// templates by recency. Same curator-gating + deleted-source exclusion +
// showcase-slide stripping as the landing grid; just a higher cap.

const TEMPLATES_PAGE_COUNT = 24;

export const getTemplatesPageList = unstable_cache(
  async (): Promise<LandingTemplate[]> => {
    try {
      const rows = await prisma.$queryRaw<
        { id: string; format: string; isPremium: boolean; thumbnails: string[] }[]
      >`
        SELECT t.id,
               CASE WHEN (t.brand->>'format') = '9:16' THEN '9:16' ELSE '16:9' END AS format,
               t."isPremium" AS "isPremium",
               t."thumbnailUrls" AS thumbnails
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        -- Featured first (admin order), then the rest of the public set by recency.
        ORDER BY (t."featuredOrder" IS NULL) ASC, t."featuredOrder" ASC, t."publishedAt" DESC
        LIMIT ${TEMPLATES_PAGE_COUNT}
      `;
      return rows
        .map((row) => ({
          id: row.id,
          format: row.format,
          isPremium: row.isPremium,
          slides: (row.thumbnails ?? []).filter(
            (url) => url && !url.includes("/showcase-"),
          ),
        }))
        .filter((tpl) => tpl.slides.length > 0);
    } catch (err) {
      console.error("[templates-page] query failed", err);
      return [];
    }
  },
  ["templates-page-list"],
  { revalidate: 300, tags: ["landing-templates", "templates-page-list"] },
);
