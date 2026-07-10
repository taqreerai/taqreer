import { z } from "zod";

// HTML-first deck schema (v2 — the dom-to-pptx pivot).
//
// Claude emits a JSON manifest where each slide is a string of HTML/CSS.
// The browser does layout; `dom-to-pptx` measures the rendered DOM; our
// `bidi-postprocess` fixes the OOXML BiDi metadata. No coordinate math,
// no bbox arithmetic, no per-element discriminated union — Claude is a
// designer, not a layout engine.
//
// CRITICAL: keep this schema permissive. The whole point of the pivot is
// to stop fighting Claude with rigid Zod retries that burn 10 minutes
// generating a single deck. Validate the SHAPE, not the content.

// 3- or 6-digit hex only — alpha hex (#RGBA / #RRGGBBAA) is rejected.
// The export pipeline (PptxGenJS / OOXML) treats colors as opaque RGB and
// silently drops the alpha channel, so accepting alpha hex creates a
// preview ↔ export mismatch (translucent in the browser, solid in the
// .pptx). For translucent fills, slide HTML uses rgba()/opacity which
// the renderer and post-processor both handle explicitly.
const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const Direction = z.enum(["rtl", "ltr"]);

// Allowlist of webfont hosts the renderer + html-document export will
// actually inject as <link rel="stylesheet">. Any other host is rejected
// at validation time so the manifest can't claim a font URL the runtime
// will silently ignore (which would silently downgrade to system fonts
// in both preview and PPT). Also consumed by lib/export/sanitize.ts to
// scrub stray <link> tags whose href isn't on this list. Add new
// providers here AND in the prompt when we extend support.
export const ALLOWED_FONT_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

const FontDefinition = z.object({
  name: z.string().min(1),
  // System fonts (Arial, Cairo if pre-installed) don't need a webfont URL.
  // The renderer + dom-to-pptx fall back to the system font when absent.
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const u = new URL(url);
          // Require HTTPS — `http://fonts.googleapis.com/...` would
          // pass the host check but every modern browser blocks the
          // mixed-content request on a secure page, silently falling
          // back to system fonts.
          if (u.protocol !== "https:") return false;
          return ALLOWED_FONT_HOSTS.has(u.hostname);
        } catch {
          return false;
        }
      },
      {
        message: `font URL must be HTTPS and host must be one of: ${Array.from(ALLOWED_FONT_HOSTS).join(", ")}`,
      }
    )
    .optional(),
  // Uploaded brand font WEIGHT FACES: one signed URL per weight file
  // (TTF/OTF/WOFF) in the private brand-assets bucket. A user who uploads
  // Light/Regular/Bold of one family gets three faces (300/400/700) here.
  // Distinct from `url` (a Google CSS *stylesheet* link) — the renderer
  // turns EACH face into a `@font-face { font-weight: W; src: url(...) }`
  // and the export embeds each file at its real weight, so PowerPoint
  // renders every weighted run from the matching uploaded file (no
  // synthetic bolding). Claude NEVER emits this; it's injected server-side
  // in deck-generate AFTER the manifest is built (so no host allowlist
  // here — we sign it ourselves). Optional + HTTPS only.
  fontFaces: z
    .array(
      z.object({
        weight: z.number().int().min(1).max(1000),
        src: z
          .string()
          .url()
          .refine((u) => u.startsWith("https://"), {
            message: "fontFace src must be HTTPS",
          }),
      }),
    )
    .optional(),
});

const ThemeObject = z.object({
  // Brand accent palette (3–8 hex). Exposed as CSS vars
  // --brand-1, --brand-2, … --brand-N by the renderer. Minimum 3 because
  // the renderer wires `--primary` / `--accent` / `--secondary` to
  // `palette[0..2]` for the slide templates; a 2-color palette would
  // leave `var(--accent)` undefined and slides referencing it would
  // render with the browser's fallback (transparent / inherit).
  palette: z.array(HexColor).min(3).max(8),
  // SINGLE brand font (2026-06-04 collapse). The brand UI has emitted one
  // family — Google OR an uploaded set — since 2026-06-02; the schema, the
  // CSS vars, and the prompt now match. Exposed as --font by
  // `themeToCssVars` (which also keeps --font-heading/--font-body as aliases
  // so slide HTML authored before this collapse still resolves its font).
  font: FontDefinition,
  // Background + text colors for the chrome. Claude picks these.
  background: HexColor,
  text: HexColor,
});

// Legacy persisted data — PresentationVersion.slideJson, BrandKit rows, and
// Template showcase brand written before the 2026-06-04 collapse — carry the
// old two-slot `{ fontHeading, fontBody }` shape. Map `fontHeading` → `font`
// on parse so those rows + old decks still load (fontBody is dropped — in
// practice it was always the same family). New manifests carry `font`
// directly. No DB migration needed: `theme` is a JSON column, normalized here
// at the single read boundary every consumer goes through.
export const ThemeSchema = z.preprocess((val) => {
  if (
    val &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    !("font" in val) &&
    "fontHeading" in val
  ) {
    const v = val as Record<string, unknown>;
    return { ...v, font: v.fontHeading };
  }
  return val;
}, ThemeObject);

// The pipeline-controlled slide-role vocabulary. Single source of truth —
// consumed by the schema enum below, deck-generate's data-role coercion, and
// scaffold.ts's role-to-class mirroring, so the three can't drift apart.
export const SLIDE_ROLE_VALUES = [
  "cover",
  "section",
  "content",
  "stats",
  "quote",
  "image",
  "closing",
] as const;

export const SlideSchema = z.object({
  slideId: z.string().min(1),
  role: z.enum(SLIDE_ROLE_VALUES).optional(),
  // Body HTML — no <!DOCTYPE>, <html>, <head>, <body> wrapper. The
  // renderer wraps each slide in a 1920×1080 container with the theme
  // CSS vars and the document direction set on the root.
  // <style>, <svg>, <link>, <img> tags are allowed; <script>, event
  // handlers, javascript: URIs are stripped by DOMPurify in the renderer.
  //
  // PERMISSIVE BY DESIGN. The schema validates SHAPE (presence + length),
  // not the markup vocabulary. This is a deliberate trade we made on the
  // 2026-05-13 HTML pivot — the previous element-JSON schema (per-element
  // discriminated unions × deep nesting × many enums) hit Anthropic's
  // "compiled grammar too large" limit AND burned 10 min/deck in
  // self-healing retries when Claude drifted from the vocabulary. The
  // browser is now the layout engine; HTML/CSS is enforced at THREE
  // layers downstream of validation:
  //   - DOMPurify in `lib/export/sanitize.ts` strips dangerous markup
  //   - The renderer's own bounding box enforces 1920×1080
  //   - dom-to-pptx + bidi-postprocess.ts handle export quirks
  // See `context/context.md` §07 for the full reasoning. If you find
  // yourself wanting to tighten this with a per-element schema, re-read
  // §18 first.
  html: z.string().min(1),
});

// Slide aspect ratio. 16:9 is the legacy default (landscape PPT, what we
// shipped at). 9:16 is the vertical / mobile-first alternative the user
// can pick on /create/brand. 3:4 is the social-media carousel post size,
// offered ONLY on /create and export-locked to PDF/PNG. Authored at:
//   16:9 → 1920×1080 px in the browser → 10″ × 5.625″ in PPT (16:9 wide)
//   9:16 → 1080×1920 px in the browser → 5.625″ × 10″ in PPT (vertical)
//   3:4  → 1080×1440 px in the browser → no PPT (PDF/PNG only)
// dom-to-pptx accepts custom layout via { width, height } in inches.
export const SLIDE_FORMATS = ["16:9", "9:16", "3:4"] as const;
export type SlideFormat = (typeof SLIDE_FORMATS)[number];

// Canonical pixel dimensions Claude authors against for each format.
// Same constants exported for the renderer, lightbox, and export
// pipeline so there's one source of truth.
export const SLIDE_DIMENSIONS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
} as const;

// Prompt directive injected wherever a 3:4 deck's canvas is described
// (initial generation + partial regen) so Claude designs social post
// cards, not projected presentation slides. Wording is FINAL per the
// product owner, keep both prompt sites on this exact string.
export const CAROUSEL_DIRECTIVE =
  "This deck is a social media carousel (1080×1440 post), generous margins, punchy hook on slide 1, swipe-friendly continuity (e.g. consistent chrome, sequence cues) across slides.";

export function dimensionsForFormat(format: SlideFormat | undefined) {
  return SLIDE_DIMENSIONS[format ?? "16:9"];
}

// One GenChat entry - the backend-transparency feed shown in the layers rail
// during generation + bake. Three shapes:
//   role "user"     - what we asked the model (the brief digest / review ask),
//                     raw text in `text`.
//   role "thinking" - the model's LIVE summarized reasoning (the API's
//                     thinking display:"summarized" stream); ONE entry per
//                     call, updated in place as deltas arrive.
//   role "assistant" - the model's REPLY text worth showing verbatim (the
//                     review's per-slide verdict lines: "SLIDE 3: REVISING -
//                     numerals anchored left").
//   role "event"    - a localizable milestone: the CLIENT renders `kind`
//                     (+ optional slide number `n`) through the dictionary,
//                     so the feed reads right in both languages.
export const GenChatEntrySchema = z.object({
  role: z.enum(["user", "thinking", "assistant", "event"]),
  // Bounded hard: thinking summaries + briefs are truncated by the writers,
  // but the schema is the backstop against a runaway blob.
  text: z.string().max(2000).optional(),
  kind: z
    .enum([
      "slide", // slide n closed during the stream
      "revise", // the model swapped slide n in place (data-revises)
      "review", // the bake's review ASK (role user, carries the sent thumbs)
      "reviseSlide", // the review pass revised slide n (text only)
      "reviewDone", // vision pass returned: n = number of slides revised
      "finalizing", // freeze + write phase started (labels the quiet stretch)
      "baked", // freeze bake finished - the deck is final
      "regen", // partial regen of slide n started (the redesign call is running)
    ])
    .optional(),
  n: z.number().optional(),
  // TINY data-URI thumbnails of the exact screenshots sent to the review
  // call (owner spec 2026-07-10: "see the images sent"). ~5-8KB each,
  // bounded hard so the feed can never bloat the manifest.
  thumbs: z.array(z.string().max(40000)).max(12).optional(),
  at: z.number(), // epoch ms, for ordering + relative timestamps
});
export type GenChatEntry = z.infer<typeof GenChatEntrySchema>;
// Writers keep the feed bounded to this many entries (drop oldest).
export const GENCHAT_MAX = 60;

export const SlideManifestSchema = z.object({
  version: z.literal("2.0"),
  presentationId: z.string().min(1),
  // 3–8 word presentation title — becomes dashboard title + export
  // filename. Generic "عرض تقديمي" is rejected by the prompt rather
  // than the schema; the schema just guards length.
  title: z.string().trim().min(1).max(160),
  language: z.enum(["ar", "en"]),
  direction: Direction,
  // Slide aspect ratio chosen by the user on /create/brand. Optional
  // for backwards-compat with manifests written before this field
  // existed — consumers fall back to "16:9" via `dimensionsForFormat`.
  format: z.enum(SLIDE_FORMATS).optional(),
  theme: ThemeSchema,
  slides: z.array(SlideSchema).min(1),
  // Streaming progress, written during generation and removed once final.
  // Optional so the schema validates both transient and final states.
  //
  // `genStartedAt` is an ISO timestamp captured ONCE on the first write
  // tick of the Inngest job. Persisting it server-side (instead of just
  // setting it on DeckView mount) means the elapsed-time + stuck-detection
  // clock survives a tab reload mid-generation. Without this, refreshing
  // a long-running deck resets the local timer to 0 and we'd never
  // surface the STUCK banner. ISO string rather than number so the JSON
  // blob round-trips cleanly through Prisma's Json column.
  progress: z
    .object({
      stage: z.string(),
      currentSlide: z.number(),
      estimatedTotal: z.number(),
      // Validate the timestamp is parseable — a stray non-date string
      // here would silently break elapsed-time arithmetic in the
      // stuck-detection branch (Date.parse returns NaN; everything
      // derived from it becomes NaN). `.refine` instead of
      // `.datetime()` so we accept both `Date.now().toISOString()`
      // shape and any other ISO-ish format `Date.parse` understands.
      genStartedAt: z
        .string()
        .trim()
        .min(1)
        .refine((s) => !Number.isNaN(Date.parse(s)), {
          message: "genStartedAt must be a parseable ISO timestamp",
        })
        .optional(),
    })
    .optional(),
  // GENCHAT (2026-07-10): the backend-transparency feed the studio shows in
  // the layers rail while the deck generates + bakes - what we asked the
  // model, its live summarized thinking, and milestone events. Written by
  // deck-generate (streaming state) and APPENDED by deck-freeze-bake (this
  // field on the final manifest), bounded to the last GENCHAT_MAX entries.
  // Optional: pre-feature manifests never carry it; exports ignore it.
  genChat: z.array(GenChatEntrySchema).max(60).optional(),
});

export type SlideManifest = z.infer<typeof SlideManifestSchema>;
export type SlideType = z.infer<typeof SlideSchema>;
export type ThemeType = z.infer<typeof ThemeSchema>;
