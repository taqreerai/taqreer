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
import { embedAlias, weightedTypeface } from "./embed-fonts-client";
import { isCffFont, convertOtfToTtf } from "./otf-to-ttf";
import { renameSfnt } from "./sfnt-rename";

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

// Fetch a font binary and return its raw sfnt bytes (woff2 → TTF/OTF via the
// wawoff2 Brotli decompress; TTF/OTF pass through). No EOT, no CFF conversion —
// callers decide what to do next (Google path EOT-wraps; the uploaded path
// renames per weight first). Returns null on any failure (best-effort).
async function fetchRawFontBytes(
  src: FontSource,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(src.url, {
      signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rawBytes = new Uint8Array(await res.arrayBuffer());
    if (src.format !== "woff2") return rawBytes;
    const wawoff2 = await import("wawoff2");
    const decompress = wawoff2.decompress ?? wawoff2.default?.decompress;
    if (typeof decompress !== "function") return null;
    const ttf = await decompress(rawBytes);
    return ttf instanceof Uint8Array ? ttf : new Uint8Array(ttf);
  } catch (err) {
    console.warn(`[embed-fonts] font fetch failed for ${src.url}:`, err);
    return null;
  }
}

// Wrap glyf/CFF TTF bytes as EOT, the format PowerPoint reads from `.fntdata`.
//
// We call `ttf2eot` directly rather than `Font.create().write({type})`: the
// high-level API models only the 10 "core" tables and DROPS layout tables
// (GSUB/GPOS/GDEF/…) on re-serialise, killing Arabic shaping. ttf2eot writes
// the original buffer verbatim at the tail, so every table survives.
async function ttfBytesToEot(
  ttfBytes: Uint8Array,
): Promise<Uint8Array | null> {
  try {
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
    console.warn("[embed-fonts] ttf2eot failed:", err);
    return null;
  }
}

// Google-path: fetch → (convert CFF→glyf if needed) → EOT. With `renameTo`,
// the internal names become that typeface first (the alias that keeps an
// installed font of the same name from shadowing the embed - sfnt-rename.ts).
async function fetchFontAsEot(
  src: FontSource,
  renameTo?: string,
): Promise<Uint8Array | null> {
  let ttfBytes = await fetchRawFontBytes(src);
  if (!ttfBytes) return null;
  if (isCffFont(ttfBytes)) {
    const converted = await convertOtfToTtf(ttfBytes);
    if (converted) ttfBytes = converted;
  }
  if (renameTo) ttfBytes = renameSfnt(ttfBytes, renameTo) ?? ttfBytes;
  return ttfBytesToEot(ttfBytes);
}

// ─── Build the per-font EOT set ─────────────────────────────────────

async function fetchFontFiles(cssUrl: string, alias?: string): Promise<FontFile[]> {
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
      const eot = await fetchFontAsEot(src, alias && weightedTypeface(alias, weight));
      return eot ? { weight, fontBytes: eot } : null;
    }),
  );
  return results.filter((r): r is FontFile => r !== null);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// Map an uploaded font file's extension to the converter format. Returns null
// for unsupported types (.woff — old WOFF1 compression we don't decode), which
// the caller treats as a miss (best-effort: that family ships un-embedded).
function formatFromUrl(url: string): FontSourceFormat | null {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".woff2")) return "woff2";
  if (path.endsWith(".otf")) return "opentype";
  if (path.endsWith(".ttf")) return "truetype";
  return null;
}

// Every standard CSS weight — the named-typeface set PowerPoint resolves runs
// against ("Family", "Family SemiBold", "Family Bold", …). dom-to-pptx names
// each run by its weight, and Claude varies weights across the deck, so EVERY
// standard weight must map to an embedded entry or the run falls back to a
// system font (it shows the family name in PPT but renders a substitute).
const ALL_STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

// Pick the uploaded weight closest to `target` (ties → the heavier one, which
// reads as more deliberate for mid-range asks like 600). `available` is the
// non-empty set of weights the user actually uploaded.
function nearestWeight(target: number, available: number[]): number {
  return available.reduce((best, w) =>
    Math.abs(w - target) < Math.abs(best - target) ||
    (Math.abs(w - target) === Math.abs(best - target) && w > best)
      ? w
      : best,
  );
}

// Build the EOT set for an uploaded family. For EACH standard weight we take
// the nearest uploaded face and produce a glyf TTF whose INTERNAL name table =
// `weightedTypeface(familyName, weight)` (e.g. "DIN NEXT™ ARABIC SemiBold") —
// the EXACT name the run carries. This is what makes PowerPoint bind the embed:
// it matches the run's typeface to the font's internal name, NOT the OOXML
// `typeface=` attribute, so a commercial face named per-weight ("…BOLD",
// subfamily Regular) would otherwise never bind. fontforge does the CFF→glyf
// conversion + the rename in one pass (Arabic GSUB/GPOS preserved). Each named
// weight is a distinct file (distinct name → distinct bytes), so the client
// splice no longer dedups them — that's intended; every weight typeface needs
// its own correctly-named payload.
async function fetchUploadedFontFiles(
  faces: { weight: number; src: string }[],
  familyName: string,
): Promise<FontFile[]> {
  // Fetch + decompress the raw source bytes once per uploaded weight.
  const rawByWeight = new Map<number, Uint8Array>();
  await Promise.all(
    faces.map(async ({ weight, src }) => {
      if (rawByWeight.has(weight)) return;
      const format = formatFromUrl(src);
      if (!format) return;
      const raw = await fetchRawFontBytes({ url: src, format });
      if (raw) rawByWeight.set(weight, raw);
    }),
  );
  const uploaded = [...rawByWeight.keys()];
  if (uploaded.length === 0) return [];

  const results = await Promise.all(
    ALL_STANDARD_WEIGHTS.map(async (weight) => {
      const raw = rawByWeight.get(nearestWeight(weight, uploaded));
      if (!raw) return null;
      // Convert (CFF→glyf if needed) AND rename the internal name to the run's
      // typeface so PowerPoint resolves it. fontforge handles .ttf input too.
      const ttf = await convertOtfToTtf(raw, weightedTypeface(familyName, weight));
      if (!ttf) return null;
      const eot = await ttfBytesToEot(ttf);
      return eot ? { weight, fontBytes: eot } : null;
    }),
  );
  return results.filter((r): r is FontFile => r !== null);
}

/**
 * Convert each font target's Google Fonts CSS into base64 EOT weight files.
 * The result is small (~0.5 MB of font bytes) and JSON-serialisable, so the
 * client can fetch it without ever uploading the deck. Fonts that fully fail
 * convert to `{ name, files: [] }` (the client skips those).
 *
 * `alias`: Google families embed under embedAlias(name) so a same-named
 * installed font can't shadow them; the client renames the runs to match.
 * Off for the Google Slides upload, which ignores embedded fonts and resolves
 * the real family name against Google Fonts. Uploaded brand fonts keep their
 * own names (the owner's installed copy is the same font).
 */
export async function convertFontTargets(
  targets: FontTarget[],
  opts?: { alias?: boolean },
): Promise<ConvertedFont[]> {
  return Promise.all(
    targets.map(async (t) => {
      const alias = opts?.alias && !("faces" in t) ? embedAlias(t.name) : undefined;
      const files =
        "faces" in t
          ? await fetchUploadedFontFiles(t.faces, t.name)
          : await fetchFontFiles(t.url, alias);
      return {
        name: t.name,
        ...(alias && files.length > 0 ? { alias } : {}),
        files: files.map((f) => ({
          weight: f.weight,
          eotBase64: bytesToBase64(f.fontBytes),
        })),
      };
    }),
  );
}
