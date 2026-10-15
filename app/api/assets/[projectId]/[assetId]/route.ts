// GET /api/assets/[projectId]/[assetId]
//
// Serves a carried-over source asset (Enhance phase 1, lib/storage/source-assets.ts).
// Slide HTML uses this URL as the <img src>; the bytes live in the PRIVATE
// `source-assets` bucket. Access is exactly the deck's: anyone who may VIEW the
// project (owner, accepted share, the public link, admin) gets a redirect to a
// short-lived signed URL; everyone else gets the same 404 as a missing deck
// (existence-hiding, see resolveProjectAccess).
//
// Redirect, not a byte proxy: the browser then fetches straight from storage, so
// a 40-image deck does not stream through the app server. The redirect itself is
// cacheable privately for less than the signed URL's lifetime.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { resolveProjectAccess } from "@/lib/api/project-access";
import {
  SOURCE_ASSET_URL_TTL_S,
  isValidSourceAssetRef,
  signSourceAsset,
} from "@/lib/storage/source-assets";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
  // A deck view loads every asset at once; generous, but bounded.
  const limited = rateLimited(`asset:${clientIp(request)}`, 600, 5 * 60_000);
  if (limited) return limited;

  const { projectId, assetId } = await params;
  if (!isValidSourceAssetRef(projectId, assetId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) {
    // Never reveal whether the deck or the asset exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const signed = await signSourceAsset(projectId, assetId);
  if (!signed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(signed, {
    status: 302,
    headers: {
      // Private: the redirect target is per-viewer-authorised. Shorter than the
      // signed URL's lifetime so a cached redirect never points at an expired URL.
      "Cache-Control": `private, max-age=${Math.floor(SOURCE_ASSET_URL_TTL_S / 2)}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}
