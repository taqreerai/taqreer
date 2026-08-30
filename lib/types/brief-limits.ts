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
//   total ~210KB: inside the 256KB event cap with margin. Enhance
//   textPerSlide does NOT ride the wire event at all (stripSlideTextForWire
//   in lib/inngest-helpers.ts - it lives in Job.inputJson and deck-generate
//   re-hydrates it by jobId), so dense decks have no event ceiling. The
//   route's serialized-event backstop (MAX_EVENT_DATA_BYTES) is the
//   catch-all for every field this module doesn't name (mimic userContent
//   from a PDF text layer, datasheet userContext, enhance instructions, ...).

// User-typed deck content (create / social / mimic textareas). ~15-20 pages
// of prose: anything longer belongs in the file-upload path. Enforced as
// textarea maxLength client-side AND an explicit 400 in /api/projects
// (reject, don't silently truncate user-typed content).
export const MAX_CONTENT_TEXT_CHARS = 40_000;

// Per-slide verbatim text on the enhance flow (SourceMeta.textPerSlide).
// A real slide rarely exceeds 1-2K chars; 4K tolerates dense tables while
// bounding the per-slide prompt block and the Job.inputJson row (the array
// is wire-stripped from the event, see the module header).
// lib/extract/text-pptx.ts clamps at extraction (machine text, so truncation
// with ellipsis is fine); the Zod schema re-applies the same cap as a
// NORMALIZE boundary (transform-clamp, not reject) so an oversized entry from
// a legacy session or a direct /api/projects caller is trimmed instead of
// nulling the whole source and silently demoting enhance to scratch (CR #181).
export const MAX_SLIDE_TEXT_CHARS = 4_000;

// Free-text design instructions typed on the /enhance + /mimic flows
// (payload.enhance.instructions). Steering guidance, not deck content -
// a couple of sentences is the intended use; 2K tolerates a detailed
// brief while keeping the prompt block small. Enforced as textarea
// maxLength client-side AND clamped (not rejected) in /api/projects -
// machine-truncation is fine for guidance text, unlike content.text.
export const MAX_ENHANCE_INSTRUCTIONS_CHARS = 2_000;

// Truncate to `max` UTF-16 code units without leaving a lone high surrogate
// when the boundary splits a surrogate pair (an emoji at the cut point would
// otherwise serialize as U+FFFD garbage). Shared by every clamp site above so
// the caps and the cut behave identically (CR #181).
export function clampChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}

// Backstop on the WHOLE serialized deck.generate.requested payload, checked
// in /api/projects before any rows are created. Inngest hard-fails at 256KB
// (262,144 bytes); 240K leaves room for the event envelope + the id/actor
// fields merged in at send time.
export const MAX_EVENT_DATA_BYTES = 240_000;
