// GET /api/status — normalized upstream model-provider health for the
// dashboard status chip + pre-generate banner + in-deck slow caption.
// Returns { level, indicator, description }. Public (no secrets — it's
// just provider status). Cached 60s.

import { NextResponse } from "next/server";
import { getAnthropicStatus } from "@/lib/status/anthropic-status";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
  const status = await getAnthropicStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
