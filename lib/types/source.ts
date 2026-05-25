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
// ─── Phase 17.B asset-extraction removal (2026-05-25) ─────────────
// We used to pull embedded images out of the PPTX zip (logos,
// photos, separators) and upload them to a `project-assets/{jobId}/`
// Supabase bucket, then hand Claude a URL list to reference via
// `<img src>`. Removed entirely on user feedback: the extracted
// raster/SVG assets clashed visually with Claude's own clean
// inline-SVG output (Lucide stroke icons, brand-token fills) and
// made the redesigned deck look uneven. Claude already SEES every
// asset rendered as pixels via the PDF document block — he can
// re-create what matters and skip what doesn't. Brand identity now
// flows through palette + fonts + the PDF itself; logos are
// approximate (Claude redraws from the visual reference).

import { z } from "zod";

// ─── SourceMeta — the discriminated union ────────────────────────
// Three upload-driven kinds + scratch (implicit, the default when
// the field is absent). The deck-generate branch on `kind` is what
// makes Phase 17 work without forking the entire pipeline per flow.
//
// ─── Phase 17.B-7 architecture pivot ─────────────────────────────
// Visual context for Claude now flows via Anthropic Files API +
// `document` block — NOT via per-slide PNG uploads to our Supabase
// bucket. Each Enhance/Mimic source carries an `anthropicFileId`
// (the PDF uploaded to Anthropic) instead of a `slideImageUrls`
// array. Claude renders the PDF internally with its purpose-built
// vision pipeline — better fidelity, fewer moving parts on our
// side, no pdfjs/canvas/Turbopack-bundling battles.
//
// PPTX inputs convert to PDF via LibreOffice in extract-source
// before upload; PDF inputs pass through. Either way the downstream
// shape is the same.

export const SourceScratchSchema = z.object({
  kind: z.literal("scratch"),
});

export const SourceEnhanceSchema = z.object({
  kind: z.literal("enhance"),
  // Anthropic Files API file_id for the source PDF. Used as a
  // `document` block in the Claude message. PPTX inputs have
  // already been LibreOffice-converted to PDF before upload.
  anthropicFileId: z.string().min(1),
  // Typeface family names from the source's theme XML (PPTX only;
  // empty for PDF). Classified into system-vs-custom in
  // deck-generate's enhance directive — system fonts pass through
  // as font-family stacks verbatim, custom fonts get resolved to
  // their closest Google Font match.
  fonts: z.array(z.string()),
});

export const SourceMimicSchema = z.object({
  kind: z.literal("mimic"),
  // Content source — the "ugly" file the user wants to repurpose.
  uglyAnthropicFileId: z.string().min(1),
  fonts: z.array(z.string()),
  // Design reference — the "good" file Claude mimics visually.
  designAnthropicFileId: z.string().min(1),
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
