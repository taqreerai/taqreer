// Data loader for the public /free-stock-images library (SEO spoke).
//
// Surfaces the AI-generated images that decks reserve-and-fill (the
// GeneratedImage rows, context/images.md) as a public, Unsplash-style
// gallery. Unlike the per-user /library, this is scoped to NO owner:
// every deck's SAVED-version images are fair game.
//
// Scope = each project's SAVED version only (JOIN Presentation ON
// savedVersionId = presentationVersionId). This mirrors the per-user
// /library scope (app/[lang]/(app)/library/page.tsx) and drops
// superseded / regenerated near-duplicate image sets. It also excludes
// deleted projects for free (their Presentation row is gone).
//
// PRIVACY: the deck TITLE is deliberately NOT selected. The public
// caption / alt text is the image PROMPT (a textless, Claude-authored
// image description), which never exposes a deck's private title and is
// richer alt text for Google Images.
//
// ORDER: randomized + deck-diverse, not chronological. A ROW_NUMBER over
// each deck (PARTITION BY presentationVersionId) numbers a deck's images
// 0..k; ordering by that rank FIRST, then a stable per-deck hash, lays
// the gallery out in "bands" where each band holds at most one image per
// deck, in a shuffled-but-stable deck order. So a page drawn from within
// a band shows all-distinct decks (no same-deck clustering), the order
// looks random, and it stays STABLE across requests so numbered
// pagination is consistent. (A page that straddles a band boundary can,
// rarely, repeat a prolific deck; early pages — where browsing happens —
// are fully diverse whenever the deck count exceeds the page size.)

import { prisma } from "@/lib/prisma";

export type StockImageRatio = "landscape" | "portrait";

// Wire shape for one public stock image.
export type StockImage = {
  id: string;
  // Permanent public Supabase storage URL. Grid renders a resized
  // thumbnail off this; download proxies the original.
  url: string;
  // Claude-authored, textless image prompt — the public alt / title /
  // caption (NOT the deck title).
  prompt: string;
  // "landscape" | "portrait" | "square" — drives the tile aspect + the
  // orientation filter.
  aspect: string;
};

export type StockImagesPage = {
  images: StockImage[];
  total: number;
  pageCount: number;
  page: number; // clamped 0-indexed page actually returned
};

// Default + hard cap on page size. Kept at/under the typical deck count so
// the deck-diversity guarantee holds on the pages users actually browse.
export const STOCK_IMAGES_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 60;

// Salt for the stable per-deck shuffle. Bump to reshuffle the whole
// gallery (e.g. if the current order ever feels stale).
const SHUFFLE_SALT = "stock-shuffle-v1";

// Escape LIKE metacharacters so a search for "50%" or "a_b" matches the
// literal text, not the ILIKE wildcards (Postgres LIKE defaults to a
// backslash escape). Parameterized either way — no injection risk.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type Row = { id: string; url: string; prompt: string; aspect: string };

/**
 * One page of public stock images, randomized + deck-diverse.
 *
 * @param opts.q        free-text search over the image prompt (ILIKE)
 * @param opts.ratio    orientation filter ("landscape" | "portrait"); null/absent = all
 * @param opts.page     0-indexed page (clamped to [0, pageCount-1])
 * @param opts.pageSize page size (clamped to [1, 60], default 12)
 *
 * Fail-soft: a DB hiccup degrades to an empty page rather than throwing,
 * so the public route never 500s.
 */
export async function getStockImagesPage(opts: {
  q?: string | null;
  ratio?: StockImageRatio | null;
  page?: number;
  pageSize?: number;
}): Promise<StockImagesPage> {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(opts.pageSize || STOCK_IMAGES_PAGE_SIZE)),
  );
  const reqPage = Math.max(0, Math.floor(opts.page || 0));
  const ratio =
    opts.ratio === "landscape" || opts.ratio === "portrait" ? opts.ratio : null;
  const qTrimmed = (opts.q ?? "").trim();
  const q = qTrimmed.length > 0 ? qTrimmed.slice(0, 100) : null;
  const like = q ? `%${escapeLike(q)}%` : null;

  try {
    // Total (for pageCount) under the same filters. Separate count query
    // because the paged SELECT windows + offsets the set.
    const countRows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM "GeneratedImage" gi
      JOIN "Presentation" pr
        ON pr."savedVersionId" = gi."presentationVersionId"
      WHERE gi.status = 'ready'
        AND gi."storageUrl" IS NOT NULL
        AND (${ratio}::text IS NULL OR gi.aspect = ${ratio})
        AND (${like}::text IS NULL OR gi.prompt ILIKE ${like})
    `;
    const total = countRows[0]?.n ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(reqPage, pageCount - 1);
    const offset = page * pageSize;

    // Band-interleave: rank each deck's images (random within-deck via
    // md5(id)), then order by that rank, then a stable per-deck hash. See
    // the file header for why this yields a randomized, deck-diverse,
    // pagination-stable order.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, url, prompt, aspect
      FROM (
        SELECT gi.id,
               gi."storageUrl" AS url,
               gi.prompt,
               gi.aspect,
               ROW_NUMBER() OVER (
                 PARTITION BY gi."presentationVersionId"
                 ORDER BY md5(gi.id)
               ) AS rn,
               md5(gi."presentationVersionId" || ${SHUFFLE_SALT}) AS deck_order
        FROM "GeneratedImage" gi
        JOIN "Presentation" pr
          ON pr."savedVersionId" = gi."presentationVersionId"
        WHERE gi.status = 'ready'
          AND gi."storageUrl" IS NOT NULL
          AND (${ratio}::text IS NULL OR gi.aspect = ${ratio})
          AND (${like}::text IS NULL OR gi.prompt ILIKE ${like})
      ) ranked
      ORDER BY rn ASC, deck_order ASC, id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return { images: rows, total, pageCount, page };
  } catch (err) {
    console.error("[stock-images] query failed", err);
    return { images: [], total: 0, pageCount: 1, page: 0 };
  }
}
