// Shared composition / layout rules that both the full deck-generate
// prompt and the partial-regen prompt need to honour. Lifted here so
// the two prompts can't drift — partial regen was previously missing
// the COMPOSITION DIRECTION rule (graphics opposite text), and Claude
// would teleport an element from the text side to the empty
// background side because it didn't know that side was reserved.
//
// Format-agnostic: enumerates both 16:9 + 9:16 numbers inline so the
// caller doesn't need to interpolate. The full prompt already worked
// this way; partial inherits the same approach.

export const COMPOSITION_RULES = `COMPOSITION DIRECTION — design natively, NO mirror pipeline downstream
Every coordinate renders as written. Background graphics (gradients, decorative shapes, ring sets, atmospheric blobs, illustrations, recognizable objects) anchor on the OPPOSITE half of the canvas from the text content, so they complement instead of overlap. In RTL slides the text sits on the RIGHT (reading start), so all decoration anchors on the LEFT half (focal center-x < 960 on a 1920 canvas). LTR slides invert — text on LEFT, decoration on RIGHT.

SLIDE MARGINS — two-layer + reserved chrome footer
Use the EXACT same side inset for content as for chrome corners (logo / pagination / persistent text). On a 1920-wide canvas that's 80 px; on a 1080-wide vertical canvas that's 50 px. Top inset matches the same number. BOTTOM is fixed at 140 px (chrome footer zone). Body MUST NOT extend below \`bottom:140px\`. Cover (\`role:"cover"\`) / closing (\`role:"closing"\`) may break chrome for hero composition.

EXACTLY ONE content layer, AND inside it NO ABSOLUTE POSITIONING of body content. The single content \`<div>\` is a \`display: flex; flex-direction: column\` (or grid) container; every body element — title, kicker, subtitle, paragraphs, cards, stats, illustrations, charts, footers — is a NORMAL-FLOW CHILD of that container, never \`position: absolute\` inside it. The only siblings allowed alongside the content layer (NOT inside it) are: the background SVG layer (\`pointer-events:none\`) and the chrome blocks (logo / pagination / persistent text, all in the bottom 140 px chrome zone, never in the body region).
To anchor a row at the bottom of the slide, set \`margin-top: auto\` on that row inside the flex column. Don't reach for \`position: absolute; bottom: 0\` on a child; it doesn't reserve vertical space.

ARABIC TYPOGRAPHY
- Glyphs render ~15–20 % wider in export. Default Arabic headlines + long single-line Arabic to FULL available width.
- Bold Arabic ≥ 24 px: \`line-height: 1.5\` min.
- Cards with Arabic need 32–48 px padding. NEVER fix \`height\` on Arabic content — use \`min-height\`.
- Tashkeel: \`line-height\` ≥ 1.6 + ≥ 20 px \`margin-bottom\`. Doesn't apply to chrome (\`line-height: 1\`).

LAYOUT GOTCHAS
- Headline + body in one container: explicit \`margin-bottom\` or grid \`gap\` (tight stacks overlap in export).
- Single-line text: \`width: max-content\` + \`padding-inline\`; inside constrained parent use \`white-space: nowrap\`.
- Single-script siblings in flex (two Arabic spans at opposite ends) merge into one shape in export — \`justify-content: space-between\` is lost. Split them into separate flex / grid columns or wrap each in its own row INSIDE the single content layer so they're independent flow blocks; do NOT \`position:absolute\` them out of the content layer. Mixed-script siblings auto-split, so flex is fine for them.
- RTL flex columns flip cross-axis alignment. \`align-items: flex-end\` on a \`flex-direction: column\` container lands items on the VISUAL LEFT in an RTL slide (the cross axis is inline-reversed). To right-align column items in RTL, use \`align-items: flex-start\` — or drop \`align-items\` entirely and let \`text-align: right\` on the container do the work with full-width block children.`;
