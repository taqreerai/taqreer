import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  embedFontsInPptx,
  type FontTarget,
  type EmbedFontStats,
} from "@/lib/export/embed-fonts";

// Server-side font embedding for the PPTX export. The client sends:
//   - `pptx`: the raw .pptx Blob from dom-to-pptx
//   - `fonts`: JSON array `[{name, url}, ...]` of Google Fonts CSS endpoints
// The server fetches each CSS, extracts woff2 URLs for weights 400 + 700,
// decompresses to TTF via wawoff2, re-encodes to EOT via fonteditor-core,
// and splices them into /ppt/fonts/ + presentation.xml + relationships +
// [Content_Types].xml. Returns the modified blob.
//
// The whole pipeline lives server-side because wawoff2's WASM bridge has a
// Node-only `fs`/`path` dep that Turbopack cannot bundle for the browser.
// Best-effort: when individual fonts fail (CSS unreachable, decompression
// error, weight missing), the server returns the still-modified blob with
// whatever DID embed. The full failure path returns the original blob
// unchanged so the export still works (PPT falls back to system-font
// resolution — the very bug this route exists to mitigate, but a working
// export beats a broken one).

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PPTX_BYTES = 100 * 1024 * 1024;
const MAX_FONTS = 4;

function parseTargets(raw: string | null): FontTarget[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ name?: unknown; url?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    const out: FontTarget[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry?.name !== "string" || typeof entry?.url !== "string") {
        continue;
      }
      if (seen.has(entry.name)) continue;
      // Only honour Google Fonts CSS endpoints — wawoff2 can decompress
      // any woff2 in principle, but the URL extraction parser is tuned
      // for the Google `css2` response shape. Other providers would need
      // their own URL parsers; rejecting up-front keeps the failure
      // mode honest rather than silently returning unembedded blob.
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
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  // Auth gate — same surface as our other export routes. Prevents
  // anonymous callers from using us as an open Google-Fonts → PPTX
  // proxy. We don't currently log who exported what; that lives in
  // the existing usage events on the project.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const pptxField = form.get("pptx");
  if (!(pptxField instanceof Blob)) {
    return NextResponse.json({ error: "pptx blob is required" }, { status: 400 });
  }
  if (pptxField.size === 0 || pptxField.size > MAX_PPTX_BYTES) {
    return NextResponse.json(
      { error: `pptx size out of range (${pptxField.size} bytes)` },
      { status: 413 },
    );
  }
  const targets = parseTargets(
    typeof form.get("fonts") === "string" ? (form.get("fonts") as string) : null,
  );

  const stats: EmbedFontStats = { attempted: 0, embedded: 0, failed: 0 };
  let outBlob: Blob = pptxField;
  try {
    const JSZipImport = await import("jszip");
    const JSZip =
      (JSZipImport as { default?: unknown }).default ?? JSZipImport;
    outBlob = await embedFontsInPptx(pptxField, targets, JSZip, stats);
  } catch (err) {
    console.error("[embed-fonts] route error", err);
    // Return the original blob so the export still succeeds. The client
    // logs the stats header (set below) so we have a paper trail when
    // the embed silently failed.
  }

  const buf = await outBlob.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Cache-Control": "no-store",
      "x-embed-stats": `attempted=${stats.attempted} embedded=${stats.embedded} failed=${stats.failed}`,
    },
  });
}
