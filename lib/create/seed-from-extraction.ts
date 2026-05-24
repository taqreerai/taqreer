// Seed the upload-driven create flows (Enhance / Mimic / Data) from
// a successful server-side extraction.
//
// Pattern mirrors lib/create/seed-from-template.ts: hydrate the same
// sessionStorage keys the normal /create flow already reads, plus a
// new `taqreer:create:source` marker (writeSource from lib/types/
// source.ts) that the parallel upload-flow pages key off of for
// the "you came from an uploaded file" experience.
//
// ─── Why generic across the three upload flows ────────────────────
// Enhance / Mimic / Data all share the same downstream: /create/
// summary POST → /api/projects → deck.generate.requested. They
// differ only in:
//   • which SourceMeta variant they write
//   • whether brand fields are pre-filled (Enhance + Mimic do, Data
//     doesn't — Data is XLSX, brand picked by user from scratch)
// A single helper with discriminated input keeps the call sites at
// the flow's UI shallow + lets the seed logic stay co-located.

import { writeSource, type SourceMeta } from "@/lib/types/source";

// Storage keys — same names lib/create/seed-from-template.ts uses.
// Inlined (not imported) to avoid a circular dep through the
// template seed module's BrandSnapshot import graph.
const CREATE_BRAND_KEY = "taqreer:create:brand";
const CREATE_OUTPUT_KEY = "taqreer:create:output";

// ─── Public types ─────────────────────────────────────────────────

/**
 * Shared brand-prefill payload for the two visual flows. Data flow
 * skips this entirely (no source visuals to derive a palette from).
 */
export type ExtractedBrand = {
  /** Hex strings from Tier 1 theme XML or Tier 2 histogram. */
  colors: string[];
  /**
   * Typeface family names from the source. May resolve to a known
   * Google Font on the brand page; if not, user sees them in the
   * font picker as "external" candidates.
   */
  fonts: string[];
  /**
   * Detected slide format. PDF rasterizer doesn't infer this (PDFs
   * are arbitrary dimensions), so callers compute it from the FIRST
   * slide's aspect ratio: width >= height → "16:9", else "9:16".
   */
  format: "16:9" | "9:16";
};

export type SeedExtractionInput =
  | { source: SourceMeta & { kind: "enhance" }; brand: ExtractedBrand }
  | { source: SourceMeta & { kind: "mimic" }; brand: ExtractedBrand }
  | { source: SourceMeta & { kind: "data" } };

// ─── Public API ────────────────────────────────────────────────────

/**
 * Write the source marker + (for visual flows) pre-fill the brand/
 * output sessionStorage keys so the user lands on the brand page
 * with their extracted palette and font candidates already filled
 * in. They can edit, but they don't have to start from zero.
 *
 * SSR-safe (no-op when window undefined). Throws synchronously if
 * the SourceMeta blob fails schema validation — that's a caller bug,
 * the schema is the single source of truth for what's serializable.
 */
export function seedFromExtraction(input: SeedExtractionInput): void {
  if (typeof window === "undefined") return;

  // Step 1: SourceMeta marker. writeSource() does the schema parse
  // + fires the state-changed event the create-flow stepper listens
  // for.
  writeSource(input.source);

  // Step 2: brand + output pre-fill. Data flow has no visuals to
  // derive from, so this step is skipped for kind="data". We
  // narrow on `input` itself rather than `input.source.kind`
  // because TS can't infer the union projection across the
  // discriminator on a nested field.
  if (input.source.kind === "data") return;
  if (!("brand" in input)) return; // unreachable after the kind check; satisfies narrow

  const { brand } = input;

  // ─── taqreer:create:brand ────────────────────────────────────────
  // Shape mirrors what /create/brand handleNext writes — colors,
  // paletteMode "manual" (we filled them, but the user picks the
  // final set), fonts.heading + fonts.body. Logo intentionally left
  // null: extraction can't reliably pull a usable logo from PPTX
  // (vector logos live in slide master XML in a form we can't
  // surface without rendering, raster logos are mixed in with all
  // other embedded images). User uploads SVG logo themselves on
  // the brand page — same as the create-from-scratch flow.
  const headingFont = brand.fonts[0] ?? null;
  const bodyFont = brand.fonts[1] ?? brand.fonts[0] ?? null;

  sessionStorage.setItem(
    CREATE_BRAND_KEY,
    JSON.stringify({
      colors: brand.colors,
      paletteMode: "manual",
      paletteScreenshotUrl: null,
      fonts: {
        heading: headingFont
          ? {
              name: headingFont,
              url: null,
              storageUrl: null,
              family: headingFont,
            }
          : null,
        body: bodyFont
          ? {
              name: bodyFont,
              url: null,
              storageUrl: null,
              family: bodyFont,
            }
          : null,
      },
      logo: null,
    }),
  );

  // ─── taqreer:create:output ───────────────────────────────────────
  // Read-modify-write the same way seed-from-template does — don't
  // wipe slide count / persistent overlay / other fields a user may
  // have set in an earlier session. The fields we drive here are
  // slideSize (from detected format) and language (default Arabic
  // matching the product's primary locale; user changes via the
  // language pills if needed).
  let existingOutput: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(CREATE_OUTPUT_KEY);
    if (raw) existingOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupt blob — start fresh */
  }
  sessionStorage.setItem(
    CREATE_OUTPUT_KEY,
    JSON.stringify({
      ...existingOutput,
      slideSize: brand.format,
      // Don't overwrite an existing language pick — user may have
      // landed in this flow after exploring the create flow already.
      language: existingOutput.language ?? "ar",
    }),
  );

  // Custom event so any create-flow listener can react without
  // re-importing this module. Same event seed-from-template fires.
  window.dispatchEvent(new CustomEvent("taqreer:create:state-changed"));
}
