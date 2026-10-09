import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { convertFontTargets, type FontTarget } from "@/lib/export/embed-fonts";

// Server-side font CONVERSION for the PPTX export. The client sends only:
//   - `fonts`: JSON array of either Google CSS endpoints `{name, url}` OR
//     uploaded brand fonts `{name, faces:[{weight, src}]}` (one signed
//     single-file URL per uploaded weight).
// For a Google URL the server fetches the css2 response, extracts the
// woff2/TTF URL for every weight it serves, and converts each. For an
// uploaded family it fetches each weight file and registers all 9 standard
// weight typefaces against the nearest uploaded face. Both are decompressed
// (woff2 → TTF via wawoff2) and
// re-encoded to EOT via fonteditor-core, returned base64 as
// `{ fonts: [{name, files:[{weight, eotBase64}]}] }`. The CLIENT splices them
// into the pptx zip locally (embed-fonts-client.ts) — deck never crosses the
// network. Each target host is pinned (fonts.googleapis.com / Supabase
// storage) so the route can't be used as an open fetch proxy.
//
// This replaced an earlier design that uploaded the whole .pptx here to
// splice server-side; an images-mode deck (raster PNGs) exceeds Next's 10 MB
// body cap locally and Vercel's ~4.5 MB cap in prod, so the route 400'd and
// the deck shipped with NO embedded fonts. Sending only the font URLs keeps
// the request tiny regardless of how many images the deck has.
//
// `alias: true` embeds Google families under a private name (embedAlias) so a
// same-named font installed on the viewer's machine can't shadow the embed.
//
// The conversion (wawoff2 WASM, fonteditor-core) is Node-only, hence the
// route. Best-effort: on any failure we return an empty set and the client
// ships the deck un-embedded (PPT falls back to system fonts — a working
// export beats a broken one).

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FONTS = 4;

// Supabase Storage host (e.g. `<ref>.supabase.co`) — the only non-Google host
// we'll fetch from. Pinning it keeps this route from being an open fetch proxy
// while still allowing signed URLs for the user's OWN uploaded brand fonts
// (deck-generate signs those; the bucket is private + ownership-validated).
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
})();

// Cap weight faces per uploaded family — the 9 standard CSS weights.
const MAX_FACES_PER_FAMILY = 9;

// Host-pin a single signed font-file URL to Supabase storage. Returns the URL
// when valid, else null — keeps this route from being an open fetch proxy
// while still allowing the user's OWN uploaded brand fonts.
function validSupabaseFontUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !SUPABASE_HOST) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (u.hostname !== SUPABASE_HOST) return null;
  } catch {
    return null;
  }
  return raw;
}

function parseTargets(raw: unknown): FontTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: FontTarget[] = [];
  // Dedupe by the resource URL we fetch (Google css2 URL OR signed font-file
  // URL), not by family name: heading + body can share a name yet point at
  // different resources; keying on `name` would silently drop the second.
  const seen = new Set<string>();
  for (const entry of raw as Array<{
    name?: unknown;
    url?: unknown;
    faces?: unknown;
  }>) {
    if (typeof entry?.name !== "string") continue;

    // Uploaded brand font: one signed Supabase-storage URL per weight face.
    // Validate + host-pin EVERY face; drop the family if none survive.
    if (Array.isArray(entry.faces)) {
      const faces: { weight: number; src: string }[] = [];
      for (const face of entry.faces as Array<{
        weight?: unknown;
        src?: unknown;
      }>) {
        const src = validSupabaseFontUrl(face?.src);
        if (!src || seen.has(src)) continue;
        const weight = Math.round(Number(face?.weight));
        if (!Number.isFinite(weight) || weight < 1 || weight > 1000) continue;
        seen.add(src);
        faces.push({ weight, src });
        if (faces.length >= MAX_FACES_PER_FAMILY) break;
      }
      if (faces.length === 0) continue;
      out.push({ name: entry.name, faces });
      if (out.length >= MAX_FONTS) break;
      continue;
    }

    // Google Fonts CSS endpoint — the URL parser is tuned for the css2
    // response shape, and pinning the host keeps us from being an open proxy.
    if (typeof entry.url !== "string") continue;
    if (seen.has(entry.url)) continue;
    try {
      const u = new URL(entry.url);
      if (u.protocol !== "https:") continue;
      if (u.hostname !== "fonts.googleapis.com") continue;
    } catch {
      continue;
    }
    seen.add(entry.url);
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
    const fonts = await convertFontTargets(targets, {
      alias: (body as { alias?: unknown }).alias === true,
    });
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
