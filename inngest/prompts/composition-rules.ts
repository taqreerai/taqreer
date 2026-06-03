// Shared composition rules honoured by BOTH the full deck-generate prompt and
// the partial-regen prompt. Kept LEAN (2026-06-02 prompt rework): the old
// SLIDE MARGINS / chrome-band / two-layer rules were verified server-handled
// or forced-style (see context/plan-design-direction.md) and stay cut.
//
// What remains is (1) the Arabic typography floor that isn't enforced
// server-side yet, and (2) the two RTL flex gotchas — RESTORED 2026-06-03 at
// user request: lib/export/sanitize.ts's RTL rewriters
// (`rewriteRtlFlexEndToFlexStart`, `rewriteRtlRowFlexOrder`) were built as
// DEFENSIVE backstops to these exact prompt rules and are deliberately
// conservative (they skip ambiguous cases — see the comments there), so the
// prompt must still state them or the conservative cases slip through.
//
// TODO (Bucket-2): move the line-height / min-height clamps into
// lib/export/bidi-postprocess.ts.

export const COMPOSITION_RULES = `Arabic typography: \`line-height\` ≥ 1.5 on bold headlines (≥ 1.6 where tashkeel appears); use \`min-height\` (never a fixed \`height\`) on Arabic text boxes so glyphs never clip.

RTL layout gotchas:
- RTL flex columns flip the cross axis: \`align-items: flex-end\` on a \`flex-direction: column\` container lands items on the VISUAL LEFT in an RTL slide (the cross axis is inline-reversed). To right-align column items in RTL use \`align-items: flex-start\` — or drop \`align-items\` and let \`text-align: right\` with full-width block children do the work.
- Single-script siblings in one flex row (e.g. two Arabic spans at opposite ends) merge into a single shape on export — \`justify-content: space-between\` is lost. Split them into separate flex / grid columns (or wrap each in its own row) so they stay independent flow blocks. Mixed-script siblings auto-split, so flex is fine for them.`;
