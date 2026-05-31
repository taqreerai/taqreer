import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { convertFontTargets, type FontTarget } from "@/lib/export/embed-fonts";

// Server-side font CONVERSION for the PPTX export. The client sends only:
//   - `fonts`: JSON array `[{name, url}, ...]` of Google Fonts CSS endpoints
// The server fetches each CSS, extracts woff2/TTF URLs for weights 400 + 700,
// decompresses to TTF via wawoff2, re-encodes to EOT via fonteditor-core, and
// returns the EOT bytes base64-encoded as `{ fonts: [{name, files:[{weight,
// eotBase64}]}] }`. The CLIENT splices them into the pptx zip locally
// (embed-fonts-client.ts) — so the deck never crosses the network.
//
// This replaced an earlier design that uploaded the whole .pptx here to
// splice server-side; an images-mode deck (raster PNGs) exceeds Next's 10 MB
// body cap locally and Vercel's ~4.5 MB cap in prod, so the route 400'd and
// the deck shipped with NO embedded fonts. Sending only the font URLs keeps
// the request tiny regardless of how many images the deck has.
//
// The conversion (wawoff2 WASM, fonteditor-core) is Node-only, hence the
// route. Best-effort: on any failure we return an empty set and the client
// ships the deck un-embedded (PPT falls back to system fonts — a working
// export beats a broken one).

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FONTS = 4;

function parseTargets(raw: unknown): FontTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: FontTarget[] = [];
  const seen = new Set<string>();
  for (const entry of raw as Array<{ name?: unknown; url?: unknown }>) {
    if (typeof entry?.name !== "string" || typeof entry?.url !== "string") {
      continue;
    }
    if (seen.has(entry.name)) continue;
    // Only honour Google Fonts CSS endpoints — the URL parser is tuned for
    // the Google `css2` response shape, and pinning the host keeps us from
    // being used as an open fetch proxy.
    try {
      const u = new URL(entry.url);
      if (u.protocol !== "https:") continue;
      if (u.hostname !== "fonts.googleapis.com") continue;
    } catch {
      continue;
    }
    seen.add(entry.name);
    out.push({ name: entry.name, url: entry.url });
    if (out.length >= MAX_FONTS) break;
  }
  return out;
}

export async function POST(request: Request) {
  // Auth gate — prevents anonymous callers from using us as a Google-Fonts
  // proxy. Same surface as our other export routes.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targets = parseTargets((body as { fonts?: unknown } | null)?.fonts);
  if (targets.length === 0) {
    return NextResponse.json(
      { fonts: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const fonts = await convertFontTargets(targets);
    return NextResponse.json(
      { fonts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[embed-fonts] conversion error", err);
    // Best-effort: empty set → client ships un-embedded (still a valid deck).
    return NextResponse.json(
      { fonts: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
