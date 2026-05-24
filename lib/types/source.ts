// Source metadata for the upload-driven flows (Phase 17 — Enhance,
// Mimic, Data). Carried as the `source` field on the brief that the
// /api/projects POST handler hands to the deck.generate.requested
// Inngest event; deck-generate.ts reads it to branch the system
// prompt + multipart Claude message shape.
//
// The Create flow (Flow 1) doesn't set this field at all — its
// absence means `kind: "scratch"` (the existing default prompt path).
// Each upload-driven flow writes its own `kind` variant.
//
// ─── Why URLs, not base64 ─────────────────────────────────────────
// Slide PNGs at 1920×1080 are ~400-800 KB each. A 12-slide deck
// base64-encoded is ~10 MB, which is at or above browser
// sessionStorage quota on most browsers (5-10 MB total). The
// extraction route uploads slide PNGs to a TEMP Supabase bucket
// (`extract-temp/{jobId}/slide-{N}.png`) instead, and this metadata
// blob only carries the URLs. deck-generate.ts fetches the bytes
// server-side when building the Claude message, then a post-
// generation cleanup deletes the temp directory. Extracted embedded
// assets (team photos, separators) are different — they're persisted
// to `project-assets/{projectId}/` for the project's lifetime, since
// the generated HTML references them by URL.

import { z } from "zod";

// ─── ExtractedAsset ──────────────────────────────────────────────
// An embedded image pulled from the source file (PPTX `ppt/media/*`
// or a PDF page's image stream) and persisted to Supabase under
// `project-assets/{projectId}/{assetId}.{ext}`. Claude correlates
// these to where they appeared in the rasterized slide PNGs
// visually — no semantic hint string is attached, the `originalSlide`
// index is purely a debug aid / for downstream UI that might want
// to show "this was on slide 3."
export const ExtractedAssetSchema = z.object({
  url: z.string().url(),
  // 1-based slide index. May be -1 for assets we couldn't
  // attribute to a specific slide (rare — PPTX slide layouts can
  // reference shared images that appear on every slide).
  originalSlide: z.number().int(),
});
export type ExtractedAsset = z.infer<typeof ExtractedAssetSchema>;

// ─── ExtractedSlideImage ─────────────────────────────────────────
// One rasterized slide. URL points at the temp bucket; the page-
// index is 1-based to match the user-facing numbering everywhere
// else in the product.
export const ExtractedSlideImageSchema = z.object({
  url: z.string().url(),
  index: z.number().int().min(1),
});
export type ExtractedSlideImage = z.infer<typeof ExtractedSlideImageSchema>;

// ─── SourceMeta — the discriminated union ────────────────────────
// Three upload-driven kinds + scratch (implicit, the default when
// the field is absent). The deck-generate branch on `kind` is what
// makes Phase 17 work without forking the entire pipeline per flow.

export const SourceScratchSchema = z.object({
  kind: z.literal("scratch"),
});

export const SourceEnhanceSchema = z.object({
  kind: z.literal("enhance"),
  slideImageUrls: z.array(ExtractedSlideImageSchema),
  extractedAssets: z.array(ExtractedAssetSchema),
  // Typeface family names (e.g. "Cairo", "IBM Plex Sans Arabic")
  // pulled from the PPTX theme XML or PDF font dictionary. Claude
  // uses them as the brand font baseline; if a name resolves to a
  // known Google Font, deck-generate also emits the right `<link>`.
  fonts: z.array(z.string()),
});

export const SourceMimicSchema = z.object({
  kind: z.literal("mimic"),
  // Content source — the "ugly" file the user wants to repurpose.
  uglySlideImageUrls: z.array(ExtractedSlideImageSchema),
  // Embedded images extracted from the UGLY file. The "good" design
  // file's assets aren't ours — Claude looks at the good file's
  // rasterized slides for design language only.
  extractedAssets: z.array(ExtractedAssetSchema),
  fonts: z.array(z.string()),
  // Design reference — the "good" file Claude mimics visually.
  designReferenceImageUrls: z.array(ExtractedSlideImageSchema),
});

export const SourceDataSchema = z.object({
  kind: z.literal("data"),
  // Anthropic Files API file_id. The uploaded XLSX bytes never
  // touch our storage — they go directly to Anthropic. We delete
  // the file via Anthropic's API after deck-generate completes.
  dataFileId: z.string().min(1),
  userContext: z.string().optional(),
});

export const SourceMetaSchema = z.discriminatedUnion("kind", [
  SourceScratchSchema,
  SourceEnhanceSchema,
  SourceMimicSchema,
  SourceDataSchema,
]);
export type SourceMeta = z.infer<typeof SourceMetaSchema>;
export type SourceKind = SourceMeta["kind"];

// Narrowed helpers — useful where downstream code knows the kind
// (e.g. the Enhance flow only ever produces an "enhance" source).
export type EnhanceSource = z.infer<typeof SourceEnhanceSchema>;
export type MimicSource = z.infer<typeof SourceMimicSchema>;
export type DataSource = z.infer<typeof SourceDataSchema>;

// ─── sessionStorage key + helpers ────────────────────────────────
// Mirrors the lib/create/seed-from-template.ts pattern: the upload
// flow's extraction route writes this key after a successful
// extraction; /create/summary reads it on submit and attaches the
// payload to POST /api/projects; clears it after a successful
// POST (same lifecycle as templateSeed).

export const SOURCE_SESSION_KEY = "taqreer:create:source";

/**
 * Read the source marker from sessionStorage. Returns null if the
 * key is absent, the blob is corrupt, OR fails schema validation
 * (the latter being a deploy-mismatch safety net — if a future
 * SourceMeta variant lands and an older client reads it back, we
 * fall through to the scratch path rather than crashing).
 *
 * Safe to call during SSR — returns null when window is undefined.
 */
export function readSource(): SourceMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SOURCE_SESSION_KEY);
    if (!raw) return null;
    const parsed = SourceMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Write the source marker. Throws synchronously if the blob doesn't
 * match the schema (caller bug — should never happen if callers
 * use the typed `SourceMeta` variants). The schema parse is the
 * single source of truth for what's serializable.
 */
export function writeSource(source: SourceMeta): void {
  if (typeof window === "undefined") return;
  // Validate at the write site so a callsite that constructs the
  // object by hand (vs from a typed return) can't sneak a malformed
  // payload into storage that readSource would later reject.
  const parsed = SourceMetaSchema.parse(source);
  window.sessionStorage.setItem(
    SOURCE_SESSION_KEY,
    JSON.stringify(parsed),
  );
  // Dispatch the same event the templateSeed helpers fire, so any
  // create-flow listener can react without re-importing this module.
  window.dispatchEvent(new CustomEvent("taqreer:create:state-changed"));
}

/**
 * Clear the source marker. Called by /create/summary after a
 * successful POST /api/projects so the next /create visit starts
 * from a clean scratch state. Not called on cancel — the user
 * might navigate away and come back, and we'd rather preserve
 * their extracted brief than force them to re-upload.
 */
export function clearSource(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SOURCE_SESSION_KEY);
  } catch {
    /* best-effort — storage quota / disabled storage */
  }
}
