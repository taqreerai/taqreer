// Size caps for the free-text fields that ride the deck.generate.requested
// Inngest event (hard event cap: 256KB serialized). Follow-up to PR #180
// (logo inline cap, Sentry 77f4c998): the logo was only the first unbounded
// field; content.text and textPerSlide could blow the same cap. Client-safe
// module (no deps) so the flow pages, the SourceMeta schema, and the API
// route all read the SAME numbers.
//
// Budget math (worst case, Arabic = 2 UTF-8 bytes/char):
//   content.text     40,000 chars = ~80KB
//   inline logo SVG              <= 100KB (MAX_INLINE_LOGO_SVG_BYTES)
//   brief structure + fonts + rules = ~20-30KB
//   total ~210KB: inside the 256KB event cap with margin. The route's
//   serialized-event backstop (MAX_EVENT_DATA_BYTES) is the catch-all for
//   every field this module doesn't name (mimic userContent from a PDF text
//   layer, datasheet userContext, enhance instructions, ...).

// User-typed deck content (create / social / mimic textareas). ~15-20 pages
// of prose: anything longer belongs in the file-upload path. Enforced as
// textarea maxLength client-side AND an explicit 400 in /api/projects
// (reject, don't silently truncate user-typed content).
export const MAX_CONTENT_TEXT_CHARS = 40_000;

// Per-slide verbatim text on the enhance flow (SourceMeta.textPerSlide).
// A real slide rarely exceeds 1-2K chars; 4K tolerates dense tables while
// keeping a 72-slide max-tier deck's total well under the event budget.
// lib/extract/text-pptx.ts clamps at extraction (machine text, so truncation
// with ellipsis is fine); the Zod schema re-applies it as the hard boundary
// so a direct /api/projects caller can't smuggle more.
export const MAX_SLIDE_TEXT_CHARS = 4_000;

// Backstop on the WHOLE serialized deck.generate.requested payload, checked
// in /api/projects before any rows are created. Inngest hard-fails at 256KB
// (262,144 bytes); 240K leaves room for the event envelope + the id/actor
// fields merged in at send time.
export const MAX_EVENT_DATA_BYTES = 240_000;
