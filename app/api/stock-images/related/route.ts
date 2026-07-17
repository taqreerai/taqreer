// GET /api/stock-images/related?id=<generatedImageId>
//
// Public feed for the /free-stock-images lightbox's "more from this set"
// suggestions: the images from the SAME deck (saved version) as `id`. Returns
// the whole group including `id` so the modal can navigate within it.
//
// Same public, edge-cacheable contract as the list route; still no titles/PII
// (only prompt + url + aspect, grouped by the deck's saved version).

import { NextResponse } from "next/server";
import { getRelatedStockImages } from "@/lib/stock-images/query";

// Prisma (pg adapter) needs the Node runtime.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ images: [] }, { status: 400 });
  }

  const images = await getRelatedStockImages(id);

  return NextResponse.json(
    { images },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
