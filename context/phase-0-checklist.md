# Phase 0 — Feasibility Checklist & Pivot Success Definition

Companion to `plan-editor.md`. This is the **go/no-go gate** for the DOM-native
in-canvas editor. Run it against a **real deck** in `/lab/editor` before any work
lands in `/project`.

The whole pivot rests on one bet: **a slide's live DOM can be edited and
serialized back to `slide.html` without drift, and still export faithfully.**
Everything else is UI. So Phase 0 exists to break that bet on purpose. If it
survives Part A and clears the gate in Part B, build with confidence.

How to use: run each test on the nastiest real slides you have (RTL + nested
flex/grid + inline SVG + generated images — ideally a BIM Capital deck), check the
box only when the **pass condition** is met. Every test names its fallback if it
fails — none are project-killers.

-----

## STATUS UPDATE — post iframe-clone rebuild (2026-06-05)

The prototype was rebuilt mid-Phase-0 into a **faithful claude.ai/design clone**
(see `plan-editor.md §0.5`). Architecture now: slide rendered in a **same-origin
`srcdoc` iframe** (CSS isolation + export parity + a security boundary), **content
scaled inside** the iframe via `#tqe-stage` (a `transform` on the iframe *element*
clips its paint in Chromium — known bug, fixed), **on-load tagging** (`data-tq-id`
every element, `data-tq-cc` visual leaves), **in-iframe hover + selection overlays**
(inflated 2px, no glyph overlap), and **hardened text edit** (plain-text paste, `<br>`
not `<div>`, no stacked-listener dup, headings always re-editable).

**De-risk status:** the scary unknowns are all proven.
- **A1 round-trip** ✅ · **A3 RTL/BiDi** ✅ · **A4** ✅ (implied by byte-identical A1 on the SVG slide).
- **A2 contentEditable** ✅ automated + paste **mechanism hardened** (force plain-text
  → Word/Docs paste can't inject markup by construction; the div-injection and
  one-paste-duplicates bugs are fixed). Manual paste spot-check still worth doing.
- **A6 selection** — **MODEL CHANGED (user direction 2026-06-05):** only **visually-
  rendered leaves** (text runs, images, graphics) are selectable AND listed; **all
  wrapper/layout divs are neither** (click container/bg → deselect). The Layers panel
  is a **flat list of leaves**, no groups/tree/toggle. One shared rule (`isTextLeaf`)
  drives selection + Layers so they can't disagree. → The old "select a container /
  reach the unreachable / semantic tree" criteria below are **superseded / dropped on
  purpose**; group-select returns later as **multi-select** (shift-click + marquee),
  and group-MOVE waits on the positioning-model decision.

**Remaining before the gate:** **A5** (inline-style panel — a known build, not an
unknown), **A7 export parity** (the LAST real unknown), **A8** undo.

**Decided (2026-06-05):** absolute-vs-flow positioning — **general drag/resize/rotate
is DROPPED.** A lab spike showed per-element freeze re-packs flex/grid siblings (~502px),
and the only stable model (freeze the WHOLE slide to absolute on first manipulation;
measured ≤2px shift, 0px disturbance) makes the whole slide rigid the moment you touch
anything — not worth it for text/boxes. General elements are STYLED (I2 pill), not moved.
**Images keep move/resize/swap** as a scoped later feature. Doesn't affect A5 / export /
persistence (all model-agnostic). See plan-editor.md §0.5 I-series for the decision.

**Recommendation:** Phase-0 de-risk is essentially done. **A7 (export parity) is the
one unknown left, and it's best validated in `/project` where export is already
wired** — so it becomes integration task #1 rather than new lab plumbing. A5 +
persistence are "real build" and belong in `/project`, not the throwaway lab.

-----

## Part A — The round-trip test suite

### A1. Serialization idempotency *(the foundation)* — ✅ GREEN (2026-06-05, deck cmq00mase, 11/11 slides)

- [x] **Null edit is a no-op.** Load a real slide → serialize (`outerHTML` →
  `sanitizeSlideHtml`) → re-render → it is **pixel-identical** to the original.
  **RESULT: byte-identical** (sanitized 10343b → readback 10343b; "browser-normalized 1st pass: no").
- [x] **Double-serialize is stable.** Serialize once, re-render, serialize again →
  byte-diff. **RESULT: identical — fixpoint after the first pass, all 11 slides.**
- [x] **10× cycle (pure round-trip), no semantic change.** **RESULT: 0/10 drift on
  every slide.** *Note:* this is 10× pure serialize↔re-render; the
  10×-WITH-contentEditable-edits variant is part of A2 (next).

### A2. contentEditable hygiene — ✅ automated subset GREEN (11/11)

*Live: no injected junk (div/br/font/styled-span/nbsp), edit→serialize diff
**1% / 148b localized**, 10× EDIT cycle **0 junk / +0b** (no accumulation). The
serialize-through-`sanitizeSlideHtml` step neutralizes the junk. **PASTE tests
(Word / Google Docs / another tab) are NOT automated — still MANUAL, pending.***

- [ ] **No injected wrappers.** Edit a heading, blur, serialize → no stray
  `<div>`/`<br>`/`<font>`/empty `<span style>`; node structure matches intent.
- [ ] **Plain-text paste stays plain.** *Pass:* no inherited font/color/size leaks.
- [ ] **Rich paste is neutralized.** Paste from Word, Google Docs, and another
  browser tab → sanitizer strips foreign markup/styles, keeps the text + intended
  structure.
- [ ] **Delete-all doesn't corrupt.** Select-all + delete inside a node → it stays
  valid, editable, re-selectable (no collapse to broken markup).
- [ ] **Line breaks are consistent.** Multi-line edit serializes `br` vs `p`
  consistently with how the source authored them.
- [ ] **Edit→serialize diff is LOCALIZED** *(the review's "noisy diffs" risk).* A
  one-word text edit produces a minimal diff vs the prior serialized HTML — NOT a
  whole-slide reserialization with attribute-reorder / quoting / entity / whitespace
  churn. *Why it matters:* noisy diffs poison version history AND make any later AI
  regen of the slide parse junk. *If fail:* run one deterministic
  attr-order/quoting normalization as save-step 1.
- [ ] **10× EDIT cycle is idempotent** *(the real gate — A1.3 with edits in the loop).*
  edit→serialize→re-render ten times with trivial reversible edits, diff each pass.
  *Pass:* no creeping wrapper / attr / whitespace accumulation. (Pure round-trip
  already passed byte-perfect in A1; this is the contentEditable-in-the-loop version.)
  *Fallback for this whole section:* if contentEditable can't be tamed, scope a
  real text model (Lexical/ProseMirror) to **text nodes only**, keep the DOM for
  layout. More work, proven path. Decide here, not in Phase 2.

### A3. RTL / BiDi integrity *(non-negotiable)* — ✅ GREEN (2026-06-05, 11/11)

*Live result: edited Arabic+Latin+"2026" through real contentEditable → `dir`
preserved, bidi run order intact, NO injected bidi controls, Latin numerals kept.
Key reason: we serialize THROUGH `sanitizeSlideHtml`, which strips contentEditable junk.*

- [ ] **Arabic edit preserves direction.** Edit RTL text → `dir`, alignment, order
  intact; no injected `dir="ltr"` or `text-align:start` regression (cf.
  `LANG_DIRECTION`).
- [ ] **Mixed runs survive.** Edit a string like Arabic + Latin + digits (e.g. a
  company name + year) → bidi run order unchanged after round-trip.
- [ ] **Latin numerals stay Latin.** House rule holds — no auto-conversion to
  Arabic-Indic on edit.
- [ ] **No injected bidi controls.** Browser didn't sneak in bidi-control
  marks/spans on edit. *If fail:* normalize them out in the sanitizer explicitly.

### A4. Scoped `<style>` + structural survival

- [ ] **Scoped `<style>` round-trips verbatim.** The in-`<section>` style block is
  unchanged — no CSSOM reformat, no rule reorder, scope prefix from `scopeDeckCss`
  intact. *(Edit inline styles, never the stylesheet text, in Phase 0.)*
- [ ] **Inline `<svg>` intact.** Paths, `viewBox`, `<defs>`, gradients, nested
  `<style>` all survive.
- [ ] **`data-*` preserved.** `data-genid` / `data-genimage` survive — the image
  pipeline (`scanGenImages`/`injectImgSrc`) depends on them.

### A5. Inline-style editing correctness

- [ ] **Edits land in computed style.** Every Layout control's write shows up in
  `getComputedStyle` (so preview + dom-to-pptx + Puppeteer all honor it).
- [ ] **Override beats the class.** Inline write wins specificity over the scoped
  class as expected.
- [ ] **Unit conversions correct.** `lineHeight` px→unitless, `opacity` 0–100→0–1,
  border `dash` array→CSS keyword — verified by reading back computed style.
- [ ] **No redundant accumulation.** Editing the same prop repeatedly leaves one
  clean inline value, not a pile.
- [ ] **Many-edit bloat stays bounded** *(the review's inline-vs-class tension).* After
  editing several DIFFERENT props on one element, its inline `style` is one tidy
  declaration, not a sprawling override pile. *(Editor consolidates writes on save;
  class-editing / "apply to all of type" is a deliberate LATER phase — that's where
  the CSSOM-serialization risk is quarantined.)*

### A6. Selection model on real nested slides — ✅ GREEN (model since changed)

> **⚠️ The criteria in this section describe the PRE-2026-06-05 selection model and
> are kept for history.** Current model = the **A6 STATUS UPDATE** at the top of this
> file: SELECTION is a flat list of **visual leaves** (text / img / svg only;
> containers are NOT selectable — click a container → deselect). The
> escalate-to-container, "reach the unreachable", and semantic-tree-AS-SELECTION
> items below are superseded. The pruned semantic tree itself is *not* dropped — it
> returns as the productized **Layers panel** (a navigation aid in the Layout tab,
> NOT a selection mechanism); see `plan-editor.md` §5.4.

*(Historical) Live: leaf-click selects the leaf, Esc/↑/alt-click escalate (stop at `<section>`),
breadcrumb is truthful (`div ‹ section.tq-canvas`), and the **semantic Layers tree**
shows ~7 readable entries on the cover (svg = ONE "Graphic" entry, text leaves
labeled) — exactly the pruned grouping, not a node dump.*

- [ ] **Leaf-click selects the leaf** in a 3–4-level nested flex/grid card, not the
  container.
- [ ] **Escalation works.** `Esc`/`↑`/alt-click walks up, stops at `<section>`.
- [ ] **Breadcrumb is truthful** (real ancestor chain, click-to-select each crumb).
- [ ] **Reach the unreachable.** Can you select an occluded element AND a
  parent-only container — via breadcrumb + select-parent + the **Layers tree**?
  (Layers is now IN the plan, folded into the Layout tab — reversed 2026-06-05.)
- [ ] **Layers tree is a readable SEMANTIC tree, not the raw DOM** *(your grouping
  call).* ~6–15 entries per slide: top level = `<section>`'s composition blocks;
  wrapper `<div>`s flattened; each `<svg>` is ONE "Graphic" entry (never its paths);
  inline spans fold into their text block. *Pass:* every element reachable via the
  tree, and it reads like the slide's structure, not a node dump. *(Presentation-only
  — grouping NEVER wraps the DOM, so the round-trip stays clean.)*

### A7. Export parity *(the core promise)*

- [ ] **Text/style edits export faithfully.** Edit text, color, size, line-height,
  spacing → export PPTX **and** PDF **and** PNG → all match preview.
- [ ] **Transforms: export-safe-ONLY (hard rule, not an open question).** Rotate/scale
  an element → does it survive PPTX, or silently drop? **Pass = it survives, OR the
  editor does not expose it.** Never ship a control that makes preview ≠ export.
- [ ] **AVOID-list enforced.** Editor cannot introduce
  conic-gradient/backdrop-filter/blur/mix-blend (dom-to-pptx drops them).
- [ ] **Frame containment.** Edits can't push content outside the fixed slide frame
  in a way that breaks export.

### A8. Undo/redo *(prototype-grade is fine)*

- [ ] **Snapshot stack restores HTML** correctly across multi-step edits.
- [ ] Known acceptable limitation: caret/selection position may reset on undo —
  note it, defer the fix to the versioning phase.

-----

## Part B — The GO / NO-GO gate

Proceed to Phase 3+ **only if all are true.** Anything red is fixable, but fix it
*in the prototype.*

- [ ] **GO:** Round-trip is idempotent on every slide archetype you ship
  (RTL, flex, grid, inline SVG, generated image).
- [ ] **GO:** contentEditable + sanitizer yields clean, intended HTML across all
  paste sources tested.
- [ ] **GO:** RTL/BiDi never regresses, in any test.
- [ ] **GO:** Every supported edit lands in computed style and survives PPTX/PDF/PNG
  export (with transforms either surviving or deliberately restricted).
- [ ] **GO:** Selection reaches every element a user realistically needs — or you've
  decided to add a Layers list and scoped that work.
- [ ] **GO (feel):** tabs / bottom command bar / breadcrumb / right-click / **Layers
  tree** feel right in real hands-on editing, not just in theory — *and* the
  free-drag (absolute) vs nudge-only (flow) split is understandable, not confusing
  (it's inherent to DOM-native; set the expectation, don't hide it).

**NO-GO triggers** (stop and rethink the mechanism, not the product):

- Round-trip drifts and can't be made deterministic → adopt a scoped text model.
- contentEditable corrupts RTL no matter what → text model, or restrict inline
  text edit to a panel field first.
- Edits don't reliably reach computed style → the inline-write strategy is wrong.

-----

## Part C — Ideal outcome of the pivot *(what "done" looks like)*

The product end-state, beyond Phase 0:

- [ ] **The scalpel exists.** A user fixes any *minor* drift — text, color, size,
  line-height, spacing, nudge, recolor — in **seconds, with zero AI calls**, and
  the fix exports pixel-faithfully to PPTX/PDF/PNG/HTML.
- [ ] **Manual edit is a first-class version.** Serialize → save as a new
  `SlideVersion`, so undo/history/realtime/lock/roles all treat it exactly like a
  regen.
- [ ] **Two modes, clean separation.** Edit mode = manual tools only; AI mode =
  slide regen, region-comment regen, element-scoped "change this with AI", image
  regen. Each clearly the right tool for its job.
- [ ] **No regressions.** Existing flows — full/partial regen, image warm/fill,
  comments, share, export, presence — behave identically to before.
- [ ] **An EDITED slide still AI-regens cleanly** *(the review's "Claude parses a slide
  full of overrides" risk).* After manual edits, a slide/partial regen of that slide
  produces clean HTML — the inline overrides don't confuse the model or corrupt the
  output. (Downstream of Phase 5 wiring, but the consolidate-on-save rule in A5 is
  what keeps it tractable.)
- [ ] **Architecturally clean.** HTML stays the single source of truth (no parallel
  model to keep in sync); RTL-first; dark-locked; `--tq-*` tokens only; Latin
  numerals; realtime in-place (no `router.refresh`).
- [ ] **The drift problem is genuinely closed.** Minor drifts now resolve via the
  editor instead of an Opus regen — cheaper, faster, deterministic — which was the
  whole point of killing the see-and-fix loop.

### Stretch / later (explicitly out of Phase 0)

- [ ] "Apply to all of type" = edit the shared scoped class (reintroduces CSSOM
  serialization risk — design it deliberately, not by accident).
- [ ] Deterministic auto-fit overflow pass as an assist alongside the editor.
- [ ] Light mode via the header switcher.

-----

## The four flags, mapped to their fix *(all tractable)*

| Flag | Fix | Where it's gated |
|------|-----|------------------|
| Round-trip / contentEditable fragility | Idempotency tests now; scoped text model as fallback | A1–A3, Part B |
| Inline-style accumulation vs class editing | Inline-only in Phase 0; class editing as a *deliberate* later phase | A5, Part C stretch |
| Dropped Layers tree | Let A6 decide empirically; fold a compact list into Layout tab if needed | A6 |
| Export parity for transforms | Restrict the editor to export-safe transforms | A7 |
