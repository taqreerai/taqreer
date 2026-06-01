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
import { MAX_MARKDOWN_CHARS } from "@/lib/extract/datasheet";

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
  // Optional Anthropic Files API id when /create's content card has
  // a user-uploaded source file (PDF/PPTX/DOCX) instead of typed
  // text. The extraction pipeline (/api/extract → polling) is the
  // same one /enhance + /mimic use; the only difference is that the
  // scratch branch in deck-generate.ts treats the document as "raw
  // material to interpret into a new deck" rather than "redesign
  // verbatim" or "mimic visually". Absent for pure-text submits +
  // for legacy briefs that predate this field.
  anthropicFileId: z.string().min(1).optional(),
});

export const SourceEnhanceSchema = z.object({
  kind: z.literal("enhance"),
  // Legacy (document-block path): Anthropic Files API file_id for the
  // source PDF. OPTIONAL now — the enhance overhaul (Phase 18) feeds
  // Claude per-slide PNGs rendered at GENERATION time instead of a PDF
  // document block, so this is no longer produced. Kept optional for
  // backward-compat with in-flight sessions.
  anthropicFileId: z.string().min(1).optional(),
  // Typeface family names from the source's theme XML (PPTX only;
  // empty for PDF). Classified into system-vs-custom in
  // deck-generate's enhance directive — system fonts pass through
  // as font-family stacks verbatim, custom fonts get resolved to
  // their closest Google Font match.
  // Defaults to `[]` so a pre-overhaul enhance payload (which predates font
  // extraction) still parses instead of being rejected outright.
  fonts: z.array(z.string()).default([]),
  // VERBATIM text per slide, in presentation order (index i ↔ rendered
  // page i+1). Extracted from the PPTX XML (exact, no OCR) by
  // lib/extract/text-pptx.ts. Empty array for PDF uploads until the
  // PDF text-layer path lands. Handed to Claude per slide so it
  // reproduces content word-for-word while redesigning the visual.
  // Defaults to `[]` (back-compat — deck-generate already treats this as
  // possibly-empty and falls back to image-only enhance).
  textPerSlide: z.array(z.string()).default([]),
  // Supabase staging location of the ORIGINAL upload (object key in the
  // source-files bucket) + its MIME. deck-generate re-fetches it at
  // generation time to rasterize the per-slide PNGs (transient — the
  // images are flushed after the run; nothing persists between runs).
  // OPTIONAL for back-compat: pre-overhaul payloads lack these; the
  // generation step throws a clear "missing sourcePath/sourceMime" error
  // rather than the schema silently rejecting the whole stored source.
  sourcePath: z.string().min(1).optional(),
  sourceMime: z.string().min(1).optional(),
});

// Mimic content can come from EITHER an uploaded file ("ugly" file
// path — same shape as enhance) OR free-text the user types into the
// content card on /mimic. The two are mutually-exclusive in practice
// but we accept both fields as optional + enforce "at least one" via
// a Zod refinement, so the deck-generate branch can branch on which
// field is populated and the wire shape can evolve later (e.g. if we
// ever let the user provide a content brief alongside an uploaded
// file as supplementary notes) without a schema break.
//
// The design reference file is always required — without it there's
// nothing to mimic, and the flow becomes a glorified /create.
export const SourceMimicSchema = z
  .object({
    kind: z.literal("mimic"),
    // Content source — the "ugly" file the user wants to repurpose.
    // Optional now: if absent, `userContent` must be set instead.
    uglyAnthropicFileId: z.string().min(1).optional(),
    // Content as plain text — typed into the content card on /mimic.
    // Schema-level trim check: a string of pure whitespace ("   "
    // or "\n\n\n") would pass `min(1)` but is semantically empty.
    // The refine below also gates this so a blank textarea can't
    // satisfy the "at least one content source" requirement.
    userContent: z
      .string()
      .min(1)
      .refine((v) => v.trim().length > 0, {
        message: "userContent must contain non-whitespace text.",
      })
      .optional(),
    fonts: z.array(z.string()),
    // Design reference — the "good" file Claude mimics visually.
    designAnthropicFileId: z.string().min(1),
  })
  .refine(
    (v) =>
      Boolean(v.uglyAnthropicFileId) ||
      (typeof v.userContent === "string" && v.userContent.trim().length > 0),
    {
      message:
        "Mimic source requires either a content file (uglyAnthropicFileId) or typed content (userContent).",
      path: ["userContent"],
    },
  );

// ─── Datasheet (Flow 5 — /datasheet) ─────────────────────────────
// Spreadsheet uploads (xlsx/xls/csv) are parsed server-side to a
// Markdown table instead of going to Anthropic Files API as a PDF
// render. Reason: Claude needs the actual numbers + column headers
// to draw accurate charts; a PDF render of a spreadsheet loses
// table fidelity (page breaks slice wide sheets, formatting noise
// dilutes the signal). Markdown tables are token-efficient and
// Claude reads them natively.
//
// `markdown` is the parsed-and-truncated payload from
// `lib/extract/datasheet.ts`. For oversized sheets the parser
// already trims rows + prepends a column-stats summary so the
// payload stays inside Claude's context window — this field is
// trusted to be "send-ready" at write time.
//
// `userContext` is the optional "ركّز على..." textarea from the
// /datasheet content card. Lets the user steer Claude toward a
// specific angle without forcing them to.
export const SourceDataSchema = z.object({
  kind: z.literal("data"),
  // The parser caps markdown output at `MAX_MARKDOWN_CHARS` (~200k)
  // when truncation kicks in. Reapply the cap here as a hard schema
  // boundary — without this, a direct `/api/projects` caller (anyone
  // hitting the route without first going through the parser) could
  // smuggle an arbitrarily large payload that blows the Claude
  // prompt size + the Inngest event-payload limit. The cap is
  // imported from the parser module so the two stay locked together.
  // CR #5 (PR #39).
  markdown: z.string().min(1).max(MAX_MARKDOWN_CHARS),
  sheetCount: z.number().int().min(1),
  totalRows: z.number().int().min(0),
  truncated: z.boolean(),
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
