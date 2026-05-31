// Server-side half of the PPTX font embed: converts Google-Fonts woff2 into
// the EOT bytes PowerPoint reads from .fntdata entries. The ZIP SPLICE lives
// in embed-fonts-client.ts and runs in the browser — see that file's header
// for why the split exists (the old design uploaded the whole deck and
// 400'd on image-mode decks over the body limit).
//
// Why this matters: OOXML PPT only has two weight states per run (b="0" /
// b="1"). When PowerPoint edits a text box it re-walks the system font
// registry, and on most macOS / Windows installs "Cairo" lacks a complete
// 400+700 family — so PPT substitutes whichever Cairo variant is present
// (often the heaviest). Embedding the exact bytes bypasses system resolution.
//
// Flow (per font URL):
//   1. Fetch the Google Fonts CSS endpoint; parse out the woff2 (or TTF)
//      URL for EVERY weight the CSS serves (the deck URL requests the full
//      ladder; Google returns only the weights the family ships).
//   2. Fetch each, decompress woff2 → TTF with `wawoff2`, then convert
//      TTF → EOT with `fonteditor-core` (the format PPT reads natively).
//   3. Return the EOT bytes base64-encoded; the client splices them in.
//
// Best-effort: any single font failure (CSS unreachable, weight missing,
// decompression error) is swallowed; that variant is simply omitted.
//
// Server-only: `wawoff2`'s WASM bridge pulls Node's `fs`/`path`, which
// Turbopack can't satisfy in the browser bundle; running server-side also
// avoids client CORS gymnastics for the Google Fonts CSS endpoint.

import type { FontTarget, ConvertedFont } from "./embed-fonts-client";

// Re-export the shared transport types so the API route + callers have one
// import site.
export type { FontTarget, EmbedFontStats } from "./embed-fonts-client";

// One converted weight: the numeric CSS font-weight + the EOT bytes. The
// weight is carried as a number all the way to the client, which maps it to a
// named typeface ("Cairo SemiBold") via `weightedTypeface`.
type FontFile = { weight: number; fontBytes: Uint8Array };

// ─── Step 1: Parse Google Fonts CSS for woff2 URLs per weight ────────

type FontSourceFormat = "woff2" | "truetype" | "opentype";
type FontSource = { url: string; format: FontSourceFormat };

type WeightedSource = { weight: number; src: FontSource };

export function extractFontSourcesByWeight(css: string): WeightedSource[] {
  const out: WeightedSource[] = [];
  const seen = new Set<number>();
  const blocks = css.split("@font-face");
  for (const block of blocks.slice(1)) {
    // Read the ACTUAL weight off each @font-face — no hardcoded 400/700, so
    // every weight the deck requested (SemiBold, Black, …) is embedded. A
    // variable-range request emits `font-weight: 200 900`; we only support
    // explicit static weights (the prompt requests them), so a single number.
    const weightMatch = /font-weight:\s*(\d+)\s*;/.exec(block);
    if (!weightMatch) continue;
    const weight = Number(weightMatch[1]);
    if (!Number.isFinite(weight) || weight <= 0 || seen.has(weight)) continue;
    // Google Fonts serves woff2 to modern UAs, truetype to older ones
    // (curl, Node fetch). The route runs server-side, so accept both and
    // skip the wawoff2 decompress when we already have raw TTF.
    const urlMatch =
      /src:\s*[^;]*?url\(\s*([^)]+?)\s*\)\s*format\(['"](woff2|truetype|opentype)['"]\)/.exec(
        block,
      );
    if (urlMatch) {
      seen.add(weight);
      out.push({
        weight,
        src: {
          url: urlMatch[1].replace(/['"]/g, ""),
          format: urlMatch[2] as FontSourceFormat,
        },
      });
    }
  }
  return out;
}

// ─── Step 2: Fetch the font binary, return EOT bytes ready for .fntdata ──

// Cap each Google Fonts network hop. This module is best-effort (any failure
// falls through to the unembedded blob), so a stalled upstream must not hang
// the whole export — a timeout aborts the fetch and is treated as a miss.
const FONT_FETCH_TIMEOUT_MS = 10_000;

async function fetchFontAsEot(src: FontSource): Promise<Uint8Array | null> {
  try {
    const res = await fetch(src.url, {
      signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rawBytes = new Uint8Array(await res.arrayBuffer());

    // woff2 needs a Brotli decompress before TTF; TTF/OTF skip that hop.
    let ttfBytes: Uint8Array<ArrayBufferLike> = rawBytes;
    if (src.format === "woff2") {
      const wawoff2 = await import("wawoff2");
      const decompress = wawoff2.decompress ?? wawoff2.default?.decompress;
      if (typeof decompress !== "function") return null;
      const ttf = await decompress(rawBytes);
      ttfBytes = ttf instanceof Uint8Array ? ttf : new Uint8Array(ttf);
    }

    // Convert TTF → EOT. PowerPoint expects EOT inside .fntdata; raw TTF
    // lands in the zip but PPT silently won't recognise it as embedded.
    //
    // We call `ttf2eot` directly rather than `Font.create().write({type})`:
    // the high-level API models only the 10 "core" tables and DROPS layout
    // tables (GSUB/GPOS/GDEF/…) on re-serialise, killing Arabic shaping.
    // ttf2eot writes the original TTF buffer verbatim at the tail, so every
    // table survives.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonteditor: any = await import("fonteditor-core");
    const ttf2eot = fonteditor.ttf2eot ?? fonteditor.default?.ttf2eot;
    if (typeof ttf2eot !== "function") return null;
    const eotOut = ttf2eot(
      ttfBytes.buffer.slice(
        ttfBytes.byteOffset,
        ttfBytes.byteOffset + ttfBytes.byteLength,
      ),
    );
    if (eotOut instanceof ArrayBuffer) return new Uint8Array(eotOut);
    if (eotOut instanceof Uint8Array) return eotOut;
    if (eotOut?.buffer instanceof ArrayBuffer) {
      return new Uint8Array(
        eotOut.buffer.slice(
          eotOut.byteOffset,
          eotOut.byteOffset + eotOut.byteLength,
        ),
      );
    }
    return null;
  } catch (err) {
    console.warn(`[embed-fonts] font fetch/convert failed for ${src.url}:`, err);
    return null;
  }
}

// ─── Build the per-font EOT set ─────────────────────────────────────

async function fetchFontFiles(cssUrl: string): Promise<FontFile[]> {
  let css: string;
  try {
    const res = await fetch(cssUrl, {
      signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    css = await res.text();
  } catch {
    return [];
  }
  const sources = extractFontSourcesByWeight(css);
  // Run every weight in parallel — independent fetches.
  const results = await Promise.all(
    sources.map(async ({ weight, src }) => {
      const eot = await fetchFontAsEot(src);
      return eot ? { weight, fontBytes: eot } : null;
    }),
  );
  return results.filter((r): r is FontFile => r !== null);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Convert each font target's Google Fonts CSS into base64 EOT weight files.
 * The result is small (~0.5 MB of font bytes) and JSON-serialisable, so the
 * client can fetch it without ever uploading the deck. Fonts that fully fail
 * convert to `{ name, files: [] }` (the client skips those).
 */
export async function convertFontTargets(
  targets: FontTarget[],
): Promise<ConvertedFont[]> {
  return Promise.all(
    targets.map(async (t) => {
      const files = await fetchFontFiles(t.url);
      return {
        name: t.name,
        files: files.map((f) => ({
          weight: f.weight,
          eotBase64: bytesToBase64(f.fontBytes),
        })),
      };
    }),
  );
}
