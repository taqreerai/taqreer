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
import { purgeCloudflarePaths } from "@/lib/cloudflare/purge";

// Marker that separates the Supabase host from the object path in a public URL.
const STORAGE_PUBLIC_MARKER = "/storage/v1/object/public/";

// Rewrite a Supabase public-storage cover URL to a same-origin `/tpl/` path so
// it loads from OUR Cloudflare edge instead of cross-origin Supabase storage
// (which costs a separate DNS+TLS, a per-request cookie, ~200-450 ms of storage
// wait, and only a 1 h cache). The `/tpl` route (app/tpl/[...path]/route.ts)
// proxies the object, drops the cookie, and sets a 1-year immutable cache so CF
// edge-caches each cover. Empty / non-storage inputs pass through unchanged.
// WEB ONLY — the welcome-EMAIL strip keeps absolute URLs (emails can't resolve
// a relative /tpl path).
export function edgeCoverUrl(url: string): string {
  if (!url) return url;
  const i = url.indexOf(STORAGE_PUBLIC_MARKER);
  return i === -1 ? url : "/tpl/" + url.slice(i + STORAGE_PUBLIC_MARKER.length);
}

// The curator account whose ADMIN-FEATURED templates (featuredOrder set) feed
// every public template surface. Exported for the admin curation console.
export const MARQUEE_OWNER_EMAIL = "dev@taqreer.ai";

// Public template surfaces that are Cloudflare edge-cached and render the
// admin-featured set. Purged from the CDN after every curation write so the
// change actually reaches visitors (both locales).
const CDN_TEMPLATE_PATHS = [
  "/ar",
  "/en",
  "/ar/presentation-templates",
  "/en/presentation-templates",
];

// Bust every cached public template surface after an admin curation write
// (feature / unfeature / reorder / premium / slug + SEO copy edits) so the
// landing marquee + grid + welcome-email strip + per-template detail pages
// reflect the change.
//
// `extraPaths`: same-origin paths to purge IN ADDITION to the current public
// slugs - the slug query below only sees the row's NEW state, so a rename,
// slug removal, unpublish, or delete must pass the PREVIOUS slug's URLs or
// the old edge object keeps serving until s-maxage.
export async function revalidateTemplateSurfaces(
  extraPaths: string[] = [],
): Promise<void> {
  // IMMEDIATE expiry via { expire: 0 }, deliberately NOT the "max"
  // stale-while-revalidate profile. We purge the Cloudflare edge cache right
  // after this and CF refetches from origin immediately; if origin served
  // SWR-stale HTML, CF would re-cache that stale copy for the full s-maxage
  // (~24h). (updateTag is immediate too but throws outside a Server Action;
  // the bare 1-arg revalidateTag is a type error + deprecated in 16.x.)
  revalidateTag("auth-marquee-columns", { expire: 0 });
  revalidateTag("landing-templates", { expire: 0 });
  revalidateTag("welcome-templates", { expire: 0 });
  revalidateTag("template-detail", { expire: 0 });

  // Purge the per-template detail pages too. Slugs are read fresh (not via the
  // cache we just revalidated) and fail-soft: a DB hiccup degrades to purging
  // only the fixed surfaces. The sitemap carries the detail URLs, so it gets
  // purged alongside. purgeCloudflarePaths batches past the CF 30-file cap.
  let detailPaths: string[] = [];
  try {
    const rows = await prisma.template.findMany({
      where: { isPublic: true, slug: { not: null } },
      select: { slug: true },
    });
    detailPaths = rows.flatMap((r) => [
      `/ar/presentation-templates/${r.slug}`,
      `/en/presentation-templates/${r.slug}`,
    ]);
  } catch (err) {
    console.error("[templates] slug purge-list query failed", err);
  }

  // Next's revalidation only busts the SERVER cache; the Cloudflare edge keeps
  // serving its copy until s-maxage. Propagate the purge to the CDN (the
  // pattern the Next docs recommend for CDN-fronted static / ISR pages).
  await purgeCloudflarePaths([
    ...CDN_TEMPLATE_PATHS,
    "/sitemap.xml",
    ...detailPaths,
    ...extraPaths,
  ]);
}

// The two edge-cached URLs of one template's detail page - the `extraPaths`
// shape for purging a slug that is being renamed/removed/unpublished.
export function templateDetailPaths(slug: string): string[] {
  return [
    `/ar/presentation-templates/${slug}`,
    `/en/presentation-templates/${slug}`,
  ];
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
// Shared fetcher for both marquee caches below (auth 60s / landing 24h).
const fetchMarqueeColumns = async (): Promise<MarqueeColumns> => {
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
};

export const getMarqueeColumns = unstable_cache(
  fetchMarqueeColumns,
  ["auth-marquee-columns"],
  { revalidate: 60, tags: ["auth-marquee-columns"] },
);

// Landing-hero variant: SAME data + SAME bust tag, but a 24-hour TTL.
// The landing is force-static with 24h loaders throughout; Next 16
// lowers the enclosing document's revalidation to the SHORTEST
// unstable_cache interval it renders with, so reusing the 60s auth
// cache would drag the whole landing route down to 60s regeneration
// (CR PR #193). Curation writes still bust this instantly via the
// shared "auth-marquee-columns" tag in revalidateTemplateSurfaces.
export const getLandingMarqueeColumns = unstable_cache(
  fetchMarqueeColumns,
  ["landing-marquee-columns"],
  { revalidate: 86400, tags: ["auth-marquee-columns"] },
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
  // SEO detail-page fields (admin-assigned; null until curated). Present on
  // the /presentation-templates hub list so tiles can deep-link; the landing
  // grid loader omits them (lightbox-only surface).
  slug?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
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
          // All non-showcase slides (edge-proxied via /tpl) so the landing
          // tiles scrub through the whole deck on hover, like the dashboard
          // tiles. Covers stay edge-cached; the extra slide URLs load lazily
          // on hover (loading="lazy").
          slides: (row.thumbnails ?? [])
            .filter((url) => url && !url.includes("/showcase-"))
            .map(edgeCoverUrl),
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

// ─── Landing cover rows ───────────────────────────────────────────────
//
// The two template-cover rows under the hero (they replaced the trusted-by
// logos, owner 2026-10-30): Arabic covers in the first row, every other
// language in the second. Every admin-featured 16:9 template, in featured
// order, so featuring a template in the admin grows its row (curation busts
// the "landing-templates" tag + purges the CDN).

export type LandingCover = {
  id: string;
  cover: string;
  slug: string | null;
  nameAr: string | null;
  nameEn: string | null;
};

export const getLandingCoverRows = unstable_cache(
  async (): Promise<{ arabic: LandingCover[]; other: LandingCover[] }> => {
    try {
      const rows = await prisma.$queryRaw<(LandingCover & { language: string })[]>`
        SELECT t.id,
               t."thumbnailUrls"[1] AS cover,
               t.slug,
               t."nameAr" AS "nameAr",
               t."nameEn" AS "nameEn",
               t.language
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t."featuredOrder" IS NOT NULL
          AND COALESCE(t.brand->>'format', '16:9') <> '9:16'
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        ORDER BY t."featuredOrder" ASC
      `;
      const row = (arabic: boolean): LandingCover[] =>
        rows
          .filter((r) => r.cover && !r.cover.includes("/showcase-"))
          .filter((r) => (r.language === "ar") === arabic)
          .map((r) => ({
            id: r.id,
            cover: edgeCoverUrl(r.cover),
            slug: r.slug,
            nameAr: r.nameAr,
            nameEn: r.nameEn,
          }));
      return { arabic: row(true), other: row(false) };
    } catch (err) {
      // DB hiccup → no rows (the section collapses).
      console.error("[landing/cover-rows] query failed", err);
      return { arabic: [], other: [] };
    }
  },
  ["landing-cover-rows"],
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
        {
          id: string;
          format: string;
          isPremium: boolean;
          thumbnails: string[];
          slug: string | null;
          nameAr: string | null;
          nameEn: string | null;
        }[]
      >`
        SELECT t.id,
               CASE WHEN (t.brand->>'format') = '9:16' THEN '9:16' ELSE '16:9' END AS format,
               t."isPremium" AS "isPremium",
               t."thumbnailUrls" AS thumbnails,
               t.slug AS slug,
               t."nameAr" AS "nameAr",
               t."nameEn" AS "nameEn"
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
          slug: row.slug,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          slides: (row.thumbnails ?? [])
            .filter((url) => url && !url.includes("/showcase-"))
            .map(edgeCoverUrl),
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

// ─── /presentation-templates/[slug] detail pages ──────────────────────
//
// SEO detail page data: a single public curator template addressed by its
// admin-assigned slug. Same curator-gating + deleted-source exclusion +
// showcase-slide stripping as the hub list. Cached under "template-detail"
// (busted by revalidateTemplateSurfaces on every curation write).

export type TemplateDetail = {
  id: string;
  slug: string;
  format: string;
  isPremium: boolean;
  language: string;
  slideCount: number;
  nameAr: string | null;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  // Per-slide WebP URLs (cover first), showcase slides stripped, edge-proxied.
  slides: string[];
  updatedAt: Date;
};

export const getPublicTemplateBySlug = unstable_cache(
  async (slug: string): Promise<TemplateDetail | null> => {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string;
          slug: string;
          format: string;
          isPremium: boolean;
          language: string;
          slideCount: number;
          nameAr: string | null;
          nameEn: string | null;
          descriptionAr: string | null;
          descriptionEn: string | null;
          thumbnails: string[];
          updatedAt: Date;
        }[]
      >`
        SELECT t.id,
               t.slug AS slug,
               CASE WHEN (t.brand->>'format') = '9:16' THEN '9:16' ELSE '16:9' END AS format,
               t."isPremium" AS "isPremium",
               t.language AS language,
               t."slideCount" AS "slideCount",
               t."nameAr" AS "nameAr",
               t."nameEn" AS "nameEn",
               t."descriptionAr" AS "descriptionAr",
               t."descriptionEn" AS "descriptionEn",
               t."thumbnailUrls" AS thumbnails,
               t."updatedAt" AS "updatedAt"
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t.slug = ${slug}
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const slides = (row.thumbnails ?? [])
        .filter((url) => url && !url.includes("/showcase-"))
        .map(edgeCoverUrl);
      if (slides.length === 0) return null;
      return {
        id: row.id,
        slug: row.slug,
        format: row.format,
        isPremium: row.isPremium,
        language: row.language,
        slideCount: row.slideCount,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        descriptionAr: row.descriptionAr,
        descriptionEn: row.descriptionEn,
        slides,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      // DB hiccup → treat as not-found (the page 404s rather than 500s).
      console.error("[template-detail] query failed", err);
      return null;
    }
  },
  ["template-detail"],
  { revalidate: 300, tags: ["template-detail"] },
);

// Locales a template has real (non-fallback) SEO copy for. Drives which locale
// URLs we advertise to Google (sitemap entries, hreflang alternates, canonical):
// a locale with no name renders the other language's copy via the detail page's
// cross-language fallback, and advertising THAT as a translation makes Google
// see the ar/en pair as duplicates and skip crawling. With no copy at all, the
// template's content language is the only honest URL.
export function templateLocales(tpl: {
  nameAr: string | null;
  nameEn: string | null;
  language: string;
}): ("ar" | "en")[] {
  const locales: ("ar" | "en")[] = [];
  if (tpl.nameAr) locales.push("ar");
  if (tpl.nameEn) locales.push("en");
  if (locales.length === 0) locales.push(tpl.language === "en" ? "en" : "ar");
  return locales;
}

// Public slugs + updatedAt for the sitemap and generateStaticParams, plus the
// per-locale names + content language the sitemap needs to gate which locale
// URLs it emits (templateLocales above). Fail-soft to [] so a DB hiccup
// degrades the sitemap to static routes instead of 500ing.
export const getPublicTemplateSlugs = unstable_cache(
  async (): Promise<
    {
      slug: string;
      updatedAt: Date;
      language: string;
      nameAr: string | null;
      nameEn: string | null;
    }[]
  > => {
    try {
      const rows = await prisma.$queryRaw<
        {
          slug: string;
          updatedAt: Date;
          language: string;
          nameAr: string | null;
          nameEn: string | null;
        }[]
      >`
        SELECT t.slug AS slug, t."updatedAt" AS "updatedAt",
               t.language AS language, t."nameAr" AS "nameAr", t."nameEn" AS "nameEn"
        FROM "Template" t
        INNER JOIN "User" u ON t."ownerId" = u.id
        LEFT JOIN "Project" p ON p.id = t."sourceProjectId"
        WHERE u.email = ${MARQUEE_OWNER_EMAIL}
          AND t."isPublic" = true
          AND t.slug IS NOT NULL
          AND t."thumbnailUrls" IS NOT NULL
          AND array_length(t."thumbnailUrls", 1) > 0
          AND (t."sourceProjectId" IS NULL OR p.id IS NOT NULL)
        ORDER BY (t."featuredOrder" IS NULL) ASC, t."featuredOrder" ASC, t."publishedAt" DESC
      `;
      return rows;
    } catch (err) {
      console.error("[template-detail] slug list query failed", err);
      return [];
    }
  },
  ["template-detail-slugs"],
  { revalidate: 300, tags: ["template-detail"] },
);
