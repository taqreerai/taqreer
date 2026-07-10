# Frame architecture (2026-07-10) — system frame + flow well + freeze bake

The robust-generation architecture converged from the 2026-07-09/10 exploration
(flow experiment, system-frame spike, freeze flattener spike; harnesses in
scratchpad/frame-gen). Owner idea: "build a chrome on our side, fixed margin,
6 positions where chrome sticks, keep that place safe, a div Claude populates;
design with flex/grid so nothing overlaps, then snapshot positions and absolute
everything - that is the whole idea behind the flattener."

## The principle

Every drift class we shipped bandaids for traces to ONE root: Claude owning
geometry it cannot reliably compute (absolute px, scrim sides, RTL mirroring,
chrome placement). The frame architecture splits ownership:

- The SYSTEM owns everything that touches slide edges, carries text over
  photos, is identity, or is direction-dependent: margins, chrome, backgrounds,
  panels, scrims, brand mark, dir.
- CLAUDE owns composition inside a clipped content well, in FLOW ONLY
  (flex/grid) - so overlap/off-canvas is impossible by construction.
- A FREEZE BAKE converts the correct flow layout to absolute boxes ONCE,
  server-side, pixel-gated - the freeform editor consumes it unchanged.

## Anatomy of a generated slide

```
<section dir data-label data-role data-tq-frame [data-tq-frozen after bake]>
  <style>scoped Claude CSS + FRAME_SYSTEM_CSS + canvasFrameCss</style>
  L0 <div class="tq-bg" data-tq-lock>        ground (color/gradient) OR
       <img data-genimage data-genaspect>    full-bleed photo (tier 1)
       <div class="tq-scrim soft|strong">    baked VERTICAL scrim (system)
     [<div class="tq-panel ps|pe|bt|bb" data-tq-lock>  tier-2 photo panel]
  L1 <div class="tq-well" [style=shrunk-for-panel]>
       Claude's flow design; tier-3 in-well <img data-genimage> slots
  L2 <div class="tq-chrome" data-tq-lock>   EMPTY structure sentinel
       (owner direction 2026-07-10, final: the system renders NOTHING the
       user didn't choose - pagination/persistent hand off to Claude via the
       flow variables; the identity-chrome slots were removed the same day
       they shipped. The empty div stays as the slide's LAST layer so the
       bake's structure check catches markup-eating corruption. Old stored
       decks keep their rendered slots - their CSS is baked into their html.)
</section>
```

Geometry (16:9): margin 96, well 1728x888; split panel 768 wide (well 992);
band 378 tall (well 542); panel gap 64. Well size table is stated in the
prompt per bg kind.

## Generation contract (prompt)

- Claude declares per section: data-bg (color|image|split-start|split-end|
  band-top|band-bottom), data-bg-css, data-bg-prompt, data-bg-scrim; cover
  adds data-deck-title (project name only - nothing renders from it).
  Exactly ONE <div class="well"> per section (modifier classes allowed).
- Well is FLOW ONLY: flex/grid/gap/padding/flex:1/auto margins; NEVER
  absolute/left/top/transforms/negative margins. Px sizes fine.
- Direction NATIVE to the deck language (owner contract 2026-07-10: no
  authored-LTR mirror - bg photos do not flip, and mirroring breaks
  composition against them). System sets dir; RTL decks are designed RTL.
  Drift is CAUGHT (census: text-align:left, physical anchors, horizontal
  gradients, abs-in-well), never guess-rewritten.
- Images ONLY via declared slots (bg/panel prompts + tier-3 data-genimage);
  hotlinking banned (flagcdn flags exempt). Spike compliance: 0 external
  images, 0 dir attrs, 0 abs-in-well across every run.
- Text over photos ONLY via tier-1/tier-2 with the system scrim.

## Freeze bake (the only flattener) + THE VISION LOOP (2026-07-10 rework)

lib/deck/freeze-script.ts + inngest deck-freeze-bake. The bake is now the
product's fidelity core - a 4-step loop, terminates in ONE run (no afterfix
event chain):

1. load-manifest: pending = frame slides with NO bake marker (data-tq-frozen
   / data-tq-audited are both terminal; event flag `force:true` re-opens
   audited slides - the ops rescue hatch).
2. observe-and-revise: ONE clean render → per pending slide: AUDIT (overflow,
   anchor, underfill advisory, STRUCTURE = system layers missing from the
   parsed DOM, i.e. a malformed model attribute swallowed the well/chrome
   boundary) + a downscaled screenshot (<=1152px JPEG, ~1k tokens). Browser
   closes, then ONE vision call: Claude reviews the RENDERED slides (its own
   eyes) + well code + measured findings, re-emits corrections via
   data-revises. Anti-churn rules + an "OK" fast path. Failure of any kind
   degrades to plain freezing - the bake never depends on the model call.
3. freeze-and-write: render the corrected deck once → regression guard
   (re-audit revised slides; measurably worse than the original = revert) →
   freeze-in-place + self-verify + pixel gate → ONE dual-store write with the
   bake-vs-edit guard (slide whose stored html changed since step 1 is
   skipped - never clobber a user edit). Every pending slide leaves FINAL:
   frozen html or flow html stamped data-tq-audited.
4. finalize: thumbnails re-dispatch when revisions landed (only if this
   version is the promoted one) + `deck.baked` broadcast (pointer-only;
   clients fat-sync and the DRAFT CHIPS clear by derivation).

Freeze-in-place: keep the DOM tree as authored; pin each well element
(position:absolute + measured parent-relative left/top/width/height + right/
bottom:auto + grid-area:auto; text blocks atomic w/ height:auto; img/svg
leaves). right/bottom:auto neutralizes inert inset declarations that would
ACTIVATE on pinning; grid-area:auto restores the parent padding box as the
containing block (abspos grid children otherwise resolve insets against
their GRID AREA - first prod deck shifted every 12-col item by exactly its
column offset). NO hoisting, NO style re-serialization - classes, pseudo
elements, descendant selectors keep working untouched. Self-verifies
(re-measures after mutation) and PIXEL-GATES (renders flow vs frozen,
refuses above threshold; failed slides stay flow = degraded-editing path).
Spike numbers: worst slide 0.014% pixels vs old flattener's 0.57% mean;
serialize-reload roundtrip 0.000%.

DRAFT CHIPS (client): a frame slide with no bake marker is a DRAFT - chip
with spinner on nav tiles + hero, editor INERT for it (locked-slide
vocabulary). Derived purely from the markers (no tracked state), so load /
fat-sync / visibility-regain all converge; the deck.baked broadcast clears
them live. Vision shots can never contain the chips - they render the raw
deck document, the chips are app UI.

Vision-loop economics (measured 2026-07-10 local): clean 5-slide deck
asked=5 revised=0, 12.5k in / 165 out (~$0.07); 6-slide deck with 2 real
defects asked=6 revised=2, 30k in / 8.3k out (~$0.36); 1-slide subset bake
(regen aftermath) 8.6k in. System prompt = the generation prompt verbatim →
prompt cache shared across calls AND decks (cache_read observed cross-deck).

Runs in the clean export-grade render. ‼️ Headless font race: Chrome defers
remote font fetches until FIRST PAINT; fonts.ready resolves vacuously (0
faces; 45 faces 3s later; flow shots diffed 22% against themselves). Settle =
force a tiny paint, poll loaded-face count stable 3x150ms, fonts.ready, rAFs.

Dispatch mirrors the PR #126 race analysis: non-images decks bake right after
save; images decks bake AFTER the images reconcile commits (the bake's
read-modify-write on slideJson would otherwise race the reconcile's write -
lost update). Image fill never changes geometry (slots have explicit sizes),
so baking after reconcile only orders the WRITES, and reconcile's src
injection targets data-genid attrs the freeze preserves. A vision revision
of an image slide keeps srcs by prompt rule + the injectImgSrc backstop
(ready GeneratedImage rows re-injected by genid). deck-regenerate-partial
also dispatches the bake after its write (per-run dedup id - partial regen
mutates the SAME versionId in place), so regen slides get the same
vision-review + freeze as generated ones; the pending filter makes it a
subset bake automatically.

Bake writes BOTH stores (PresentationVersion.slideJson + the seeded
SlideVersion v1 rows) - the dual-store rule.

## Editor

- Frame decks NEVER flatten in the editor: section carries data-tq-frame from
  assembly; SlideEditor skips flatten-on-enter + onNormalize for it (frozen or
  awaiting bake). Kills the dirty-environment flatten class (white-band).
- data-tq-lock on tq-bg/tq-panel/tq-chrome → existing lock semantics (position
  immovable, restyle allowed).
- Frozen wells are nested-absolute; selection/text/StylePill/undo/delete work
  as-is (leaves/resolveHit are DOM-based). Layers/restack across the well tree:
  verify LayersPanel on nested boxes (follow-up).
- Legacy decks (pre-frame): open unflattened in the existing degraded-but-
  lossless path. Pre-launch rule: disposable, no remediation.

## GenChat (backend-transparency feed) + the studio rail tabs

- ONE continuous feed per version across generation, freeze bake, and partial
  regen, stored in `slideJson.genChat` (GENCHAT_MAX 60, FIFO). Writers:
  deck-generate (streaming-state blob), deck-freeze-bake + deck-regenerate-
  partial via the shared `appendGenChat` (lib/deck/genchat-store.ts:
  parameterized jsonb_set on ONLY the genChat key + fire-and-forget
  `deck.genchat` broadcast, thumbs stripped on the wire). Regen appends
  per-slide "regen" start milestones, the post-hoc thinking summary, and
  "slide" done milestones; its save-new-version carries the accumulated feed
  into the rebuilt manifest (it used to silently wipe it).
- Revision milestones are TEXT ONLY (owner 2026-07-10: no before/after
  thumb pairs - data-URI images bloat the stored manifest). The review-ask
  entry keeps its sent-screenshot thumbs.
- Studio: the feed is the Chat TAB of the left rail (SegmentedToggle, same
  UI as the right rail's slides/comments; icon auto_awesome). The ACTIVE tab
  follows API activity - generating || bakePending || applying flips to
  Chat, the activity ending flips back to Layers; only the EDGES auto-switch
  so a manual flip mid-run sticks (adjust-during-render, not a mount
  effect). Live path = deck.genchat broadcasts; fallbacks = the generation
  poll, the apply-poller, and the bakePending poller (all length-monotonic).

## Partial regen x frame (2026-07-10 fixes, both caught live)

- The regen model copies root attributes off its references - a regen'd
  slide arriving pre-stamped data-tq-frozen/audited is FALSE-frozen (the
  bake sees nothing pending: no vision review, geometry never pinned).
  deck-regenerate-partial strips the bake markers; the bake re-earns them.
- The regen model rebuilds its <style> from scratch and drops the .tq-well
  geometry rule - the well collapses to an unstyled 0px static div and the
  Layers walk (sub-1px skip) lists the slide EMPTY. The regen path now
  re-injects frameSystemCss as the section's first style block (generation
  parity: frame css first, model rules keep cascade priority).

## Rollout

Phase 1+2 DONE (2026-07-10, all FLAGGED via brief.frameGen / FRAME_GEN_ALL=1,
commits d7b92a2..4aeb45e): create 16:9 + 3:4 social (portrait geometry via
frameGeometry, social prompt kind) + enhance/mimic/datasheet (their addenda
compose on the frame base). Also landed: thinking-mode self-corrections
(data-revises swap-in-place), render audit + one-round self-fix, chrome from
the flow variables with FREE positions (owner direction: pagination +
persistent text hand off to Claude with no position words; the system renders
identity chrome only - brand mark, kicker, running title - geometry armored,
slot classes as silent style hooks).
Phase 3 (cutover + deletion ledger, PENDING OWNER CALL): flip the flag
default on, deploy, then remove SlideEditor flatten-on-enter +
flattenSkipReason + onNormalize adoption + parity net + onFlattenResult
observatory wiring; delete lib/editor/flatten.ts (~976 lines); RTL rewriter
family in sanitize goes inert for frame decks (kept only for legacy); the
canvas-frame-armor stays (cheap, still correct). Open polish: wide frozen
text boxes (flex-stretch width) shrink-wrap; enhance/mimic live e2es with
real uploads; layers-panel restack semantics on nested wells.

## Costs / risks (honest)

- Freeze bake adds one puppeteer render per deck (like a thumbnail run).
- In-well overlap is impossible in FLOW, but underfill/overflow content still
  possible → prompt fit-coaching + (follow-up) render audit that reports
  clipped/overflowing wells back for one self-fix pass.
- Panel/band sizes are fixed steps (40%/35%) - a deliberate constraint; more
  steps can be added as declared options without freeform risk.
- The old flattener remains in the editor code path for legacy decks until
  Phase 3; new decks never touch it.
