// GET /api/stock-images
//
// Public, unauthenticated JSON feed backing the /free-stock-images
// gallery's search + orientation filter + numbered pagination. Same
// loader the server page seeds its first page from, so the two never
// diverge.
//
// Query params (all optional):
//   q     free-text search over the image prompt
//   ratio "landscape" | "portrait"  (anything else = all)
//   page  0-indexed page (loader clamps to [0, pageCount-1])
//   limit page size (loader clamps to [1, 60])
//   seed  shuffle seed — the page mints one per visit and the client echoes
//         it back on every call, so the order stays stable across pages
//         within a visit while differing between visits
//
// Public + edge-cacheable: the response is the same for every visitor given
// the same query AND seed, so a shared CDN cache is still correct (the seed
// just partitions the keyspace per visit).

import { NextResponse } from "next/server";
import {
  getStockImagesPage,
  STOCK_IMAGES_PAGE_SIZE,
  type StockImageRatio,
} from "@/lib/stock-images/query";

// Prisma (pg adapter) needs the Node runtime.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const ratioRaw = searchParams.get("ratio");
  const ratio: StockImageRatio | null =
    ratioRaw === "landscape" || ratioRaw === "portrait" ? ratioRaw : null;
  const pageRaw = Number(searchParams.get("page"));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0;
  const limitRaw = Number(searchParams.get("limit"));
  const pageSize =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? limitRaw
      : STOCK_IMAGES_PAGE_SIZE;
  const seed = searchParams.get("seed");

  const result = await getStockImagesPage({ q, ratio, page, pageSize, seed });

  return NextResponse.json(result, {
    headers: {
      // Public gallery data — cache at the edge briefly and serve stale
      // while revalidating so the feed stays fast without going long-stale.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
