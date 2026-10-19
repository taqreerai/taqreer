// POST /api/style-suggestions
//
// The /create Design step's "Suggested for your content" tiles (2026-10-19):
// up to 3 deck style labels that fit the content the user gave on step 1, best
// first (lib/create/auto-style.ts, one short Haiku call). Guests reach the
// Design step before signing in, so the route is open, rate limited per user
// (signed in) or per IP (guest). The reply is only ever labels from the fixed
// style list; the content is never stored.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { suggestStyles } from "@/lib/create/auto-style";

export const runtime = "nodejs";

const MAX_CHARS = 1200;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const limited = user
    ? rateLimited(`style-suggest:u:${user.id}`, 30, 10 * 60_000)
    : rateLimited(`style-suggest:ip:${clientIp(request)}`, 10, 10 * 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    text?: unknown;
    imagesMode?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";
  const text = typeof body?.text === "string" ? body.text.slice(0, MAX_CHARS) : "";
  if (!`${title}${text}`.trim()) {
    return NextResponse.json({ styles: [] });
  }

  const styles = await suggestStyles({
    title,
    text,
    imagesMode: body?.imagesMode === true,
    count: 3,
    timeoutMs: 6000,
  });
  return NextResponse.json({ styles });
}
