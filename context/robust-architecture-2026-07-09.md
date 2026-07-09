# Robust deck architecture: research + direction (2026-07-09)

Trigger: the RTL "scrim" fix targeted one pattern ("scrim") and the next deck used
an "overlay" and broke again. Decision: stop the per-drift rewriter tax; rebuild on
a robust foundation. Researched Gamma + competitors AND inspected Claude Design
(claude.ai/design) hands-on.

## The one root cause of every drift
Claude authors ABSOLUTE GEOMETRY (left/top, gradients, scrims, physical left/right).
Correctness then depends on the model getting pixel math right, so every failure
(text over image, wrong RTL side, wrong scrim side, overflow) must be caught after
the fact by a targeted rewriter. Infinite supply of patterns => unbounded patch tax.
Every robust tool refuses to let the model own geometry.

## What Claude Design (Anthropic's own) actually does — inspected live
Pipeline: clarifying questions (palette / type / IMAGERY approach) -> COPY A STARTER
template (x2) -> design -> "Checking the design for issues" (post-gen self-review).
Output = one `.dc.html` file. Architecture observed in the DOM:
- FLOW / FLEX Tailwind layout (`h-dvh flex flex-col`, `flex-1 min-h-0`), NOT absolute.
  Flow auto-distributes => no overlap / off-canvas by construction.
- COMPONENTS via `x-import`: `Component image-slot`, `Component deck-stage`. Slides
  are composed from reusable typed primitives.
- IMAGES = SLOTS the user fills (dashed "Drop dining-room / ambiance photo" box in a
  flow column). No gen-image, no absolute overlay, no scrim-direction bug.
- EDIT in place on the FLOW model: "click any element to edit; repeated elements
  edited together" (component instances); Simple / Pro / Code tabs. NO flatten to
  absolute.
- Image+text slide = flow split (text column | image-slot column). Clean, no drift.

## What the research found (Gamma, Beautiful.ai, Tome, Canva, Pitch, PPT Designer)
Three robust patterns, all move the AI UP a level (content + intent + layout CHOICE;
a deterministic engine owns geometry):
- A. Layout-library fill (Canva/Pitch/PPT Designer): AI fills human templates. Max
  robustness, LOW bespoke ceiling. Kills our differentiator.
- B. Constraint / smart-layout (Beautiful.ai): a rules/Cassowary-style solver owns
  placement; NO free drag; content reflows. High robustness, rigid, expensive engine.
- C. Block/card model + smart layouts (GAMMA, Tome): AI emits outline + typed blocks
  + per-card layout; fluid renderer owns geometry; cards grow in height (web reflow),
  edit = change the typed model, theme swap never breaks. Medium-HIGH bespoke ceiling.
  Report recommends C adapted so Claude stays the designer.
RTL in all of them: logical CSS (`*-inline-*`, `text-align:start`) + one `dir` flag;
flex row auto-mirrors. Our per-case RTL rewriters exist ONLY because Claude hand-writes
physical geometry.

## Taqreer's self-inflicted wounds (ranked)
1. The FLATTENER converts flow -> absolute for the editor. Claude Design proves you can
   edit FLOW directly. The flatten (and its whole bug family + the snapshot work) is
   unnecessary if the editor manipulates flow.
2. Images use ABSOLUTE overlays + gen-images that drift. Should be flow SLOTS.
3. Per-case RTL rewriter family. Should be logical CSS + dir flag.
4. Freeform absolute geometry. Should be flow + a small primitive/component library.

Correction to my own earlier push today: I prototyped an ABSOLUTE-block contract.
Claude Design uses FLOW, which is strictly more robust (auto-distributes). We only went
absolute because the editor/flatten demanded it. Ditch the flatten => flow all the way.

## Direction (converged from hands-on + research)
Move Claude from "write the pixels" to "compose a structured, FLOW slide from typed
primitives," and make ONE flow layout engine the single geometry authority for BOTH
generation and editing:
1. A small library of FLOW layout primitives + components (hero-with-scrim, split
   40/60, stat grid, full-bleed-image-with-guaranteed-text-frame, timeline, quote),
   built once in LOGICAL CSS only. This is the bespoke vocabulary; variety = many
   expressive primitives x theming x Claude's art direction (how Gamma feels bespoke
   yet never breaks).
2. Images = flow slots (aspect-ratio boxes), user-fill or gen-fill, never absolute.
3. RTL = logical CSS + dir flag => DELETE the rewriter family; the class disappears.
4. Overflow = auto-fit type scale + "too much content" signal, not absolute text.
5. Editor manipulates the SAME flow model (ditch the flatten) => an edit can't break
   what generation guaranteed.
6. Keep a bounded freeform escape hatch: decorative BACKGROUND layers behind a
   guaranteed content frame (non-load-bearing, can't overlap text).
7. Adopt the two cheap wins Claude Design uses regardless of the big rebuild:
   clarifying-questions brief step, and a post-generation self-review/lint pass.

Sources: sacra.com Gamma card primitive; help.gamma.app cards/blocks; beautiful.ai
smart-slides; Cassowary; Canva Magic Design; Pitch Agent; MS Designer; RTL logical-CSS
guides. Full agent report in session history.
