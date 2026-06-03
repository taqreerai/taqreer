# Plan — "Design Direction" engine (inter-deck diversity + reference mimicry)

Status: PLAN / awaiting buy-in. Not yet implemented. Sourced from a live
design-Claude consultation (2026-06-02) + the prompt-rule cleanup already
landed in `deck-generate.ts`.

## The core idea

Every deck commits to ONE **DESIGN DIRECTION** up front, and the model derives
a self-consistent visual system from it (frame + 4–6 archetypes + motif kit)
before writing any slide. The DIRECTION comes from one of two sources:

- **Default path (no reference):** chosen by **content-gated weighted roll**
  (below) → the **diversity** engine, but always content-appropriate.
- **Mimic path (reference uploaded):** the reference IS the direction (already
  shipped as the strengthened `VISUAL_DIRECTION_DIRECTIVE`).

Three distinct jobs, usually conflated:
- **Choosing the direction = diversity + appropriateness.** A blind random roll
  can fight the content (religion deck + brutalist = tone-deaf). A pure
  content-guess converges on the safe centroid (every religion deck identical).
  The fix: **the model EXCLUDES, the host ROLLS.**
- **Commit-up-front = quality/coherence** (intra-deck consistency).
- **Legibility + RTL floor = the only global constant** (min type size,
  contrast, no overflow, RTL/BiDi correctness). Everything not from the
  direction or the brand is a *floor, not a style.*

## Host-side artifact (hardcoded constants)

### DESIGN_SYSTEMS[] — 12, all Arabic/RTL-viable
`name — [composition] · [type treatment] · [signature device]`
(flush-left in Latin = flush-right in RTL; numerals stay Latin throughout)

1. `swiss_grid` — strict multi-column grid, flush-right, high alignment · IBM Plex Sans Arabic · hairline baseline grid + tiny corner index labels
2. `brutalist_struct` — visible structural cells, thick dividers, raw · Cairo/Tajawal black · 2–3px black rules boxing every region
3. `mega_numeral` — anchored by one giant figure per slide · ultra-bold display + small sans body · oversized Latin numerals (01–99) bleeding off-edge
4. `editorial_naskh` — wide single-measure, magazine calm · Arabic Naskh display (Amiri / Markazi Text) · drop-initial + hairline rules between blocks
5. `soft_cards` — modular rounded blocks on tinted ground · rounded geometric sans (Tajawal) · filled rounded cards + soft shadow, one accent-filled
6. `poster_frame` — full keyline border per slide, centered lockups · bold display + tracked sans labels · outer rectangle frame + center-stacked title
7. `kufi_modular` — square/diamond modular tiling, architectural · Kufi display (Reem Kufi / Kufam) · monochrome geometric tiles, angular counters
8. `asym_diagonal` — off-axis, gridless, dynamic negative space · bold sans, mixed sizes · single tilted accent bar / diagonal divider
9. `duotone_bleed` — edge-to-edge image/colour fields, no margins · bold display over fields · brand-duotone full-bleed + small corner caption
10. `data_grid` — dense ruled tables/dashboard (the "terminal" replacement) · clean sans + tabular Latin figures · gridlines, stat cells, tick/unit labels
11. `contrast_display` — vast negative space, one focal lockup · extreme weight pairing (Changa black ↔ light) · single oversized word/phrase centered
12. `calligraphic_accent` — expressive headers, restrained body · Ruqaa/display headline (Aref Ruqaa / Lalezar) + modern sans body · one calligraphic headline as the hero

> RTL note: each system's "type treatment" drives WEIGHT / SCALE / CASE
> (Latin-only) / sans-vs-display feel — NOT the font family. Font families stay
> the BRAND's (Cairo default). The named fonts above are descriptors of the
> treatment, not overrides of the brand-font pipeline.

### DENSITY
```
airy:   { pad:[120,100], maxBlocks:3, gap:48 }
medium: { pad:[90,66],   maxBlocks:5, gap:24 }
dense:  { pad:[64,48],   maxBlocks:8, gap:16 }
```

### HEADING
`oversized_display` · `compact_bold` · `editorial_serif` · `calligraphic`
(caps/tracking applies ONLY to Latin sub-labels — Arabic has no case)

### SCALE_RATIO
`[1.200, 1.333, 1.500, 1.618]`

### Compatibility pins (so the roll never self-contradicts)
- `editorial_naskh` → force `editorial_serif`; `calligraphic_accent` → force `calligraphic`
- `data_grid` rejects `airy`; `contrast_display` rejects `dense`

## Choosing the direction — content GATES, host ROLLS

The model is **reliable at exclusion, unreliable at selection**. So:

- **Content → a WEIGHTED eligibility vector over the 12** (not a single pick).
  Inappropriate systems get `0.0`; every genuinely-fitting system keeps real
  weight (including unexpected-but-respectful ones); do NOT flatten toward the
  one safest option.
- The model reads **six signals** (priority order): **register/formality**
  (highest — religious/legal/govt/academic rule out raw/playful), **heritage/era**
  (religion/history/classical → naskh/ruqaa/kufi, away from "tech-now" — the
  religion case is about *rooted*, not just *serious*), **emotional temperature**
  (reverent→airy/high-negative-space; urgent→dense/high-contrast), **audience**,
  **subject concreteness** (data/idea/image → archetype mix), **cultural
  specificity** (Islamic geometry can promote `kufi_modular` to first choice).
  Register + heritage SUBTRACT systems (appropriateness gate); the rest TUNE
  parameters.
- **Two diversity axes** so appropriateness never kills variety:
  1. **system** (content-gated, weighted roll)
  2. **parameters** (density · scale · heading · motif · archetype-mix) — rolled
     INDEPENDENTLY. When content legitimately narrows to ONE system (funeral
     liturgy, constitution), the parameter roll carries the diversity (two naskh
     decks: one airy/golden/centered/hairline, the other medium/4th/flush-right/
     drop-initial).
- **Weighted, not binary** — "fitting but unexpected" = low-but-nonzero weight;
  that's where the freshest decks come from.

## Flow (two phases — appropriateness must gate BEFORE the roll)

**Phase A — in-prompt cheap pre-pass (model emits JSON, host consumes):**
> "Read the content and assess six signals: register/formality, heritage/era,
> emotional temperature, audience, subject concreteness, cultural specificity.
> Score each of the 12 named design systems 0.0–1.0 for appropriateness to this
> content's meaning and tone. Set a system to 0.0 if it would undermine or
> disrespect the subject (e.g. raw/brutalist or tech-modern for sacred, solemn,
> or heritage content). Do NOT pick a winner; do NOT flatten toward the single
> safest option — leave every genuinely fitting system real weight, including
> unexpected-but-respectful ones. Output only the weight vector + a one-line
> rationale per nonzero entry."

**Host-side (deterministic — owns entropy + cross-run memory):**
- normalize weights, apply compat pins, **zero recently-used systems** (dedupe
  across the user's last N decks — the memory the stateless model can't have)
- roll the system from the weighted distribution
- independently roll density / scale_ratio / heading / motif / archetype-mix-bias
- inject the locked block:
```
DESIGN DIRECTION (locked for this deck):
  system: "<rolled>"  density: "<airy|medium|dense>"
  heading: "<...>"     scale_ratio: <...>
```
- **Collapse guardrail:** if weights leave a single nonzero system, WIDEN the
  parameter roll (don't also pin density/ratio to defaults) — parameters are the
  only diversity left, so spend them.

**Phase B — in-prompt main generation call:**
> "Commit fully to the locked DESIGN DIRECTION above — it was chosen to fit this
> content's tone; honor it literally, do not soften toward a neutral look. Build
> a complete system: fixed frame, 4–6 reused archetypes, 1–3 motifs. Let the
> subject steer the archetype MIX + emphasis, but never override the locked
> system, density, ratio, or type direction. Colour and type FAMILIES come only
> from the brand inputs; everything spatial comes from the DIRECTION. Accent is a
> FILL on blocks/badges, never relocated to body text."

Why split: appropriateness must gate before the roll, so it can't live in the
generation call (too late — the look is already forming). The model only ever
does what it's good at: **scoring appropriateness (exclusion)** + **executing a
fully-specified system (craft)**. It never picks a style blind.

## Wiring into Taqreer (proposed)
- **`lib/design/direction.ts`** (new) — constants + compat pins + parameter rolls
  + `rollDirection({weights, recent})`.
- **Phase A pre-pass** — a cheap call (Sonnet-fast) or an Inngest prep step that
  returns the weight vector; persist {weights, rolledSystem} for dedupe/logging.
- **Dedupe** — query the user's last N decks' `system`; zero them in the roll.
- **`deck-generate.ts`** — inject the locked block + Phase-B clause (default
  path). Reference attached → reference supplies the DIRECTION (mimic path built).
- **Legibility + RTL floor** — the one constant in SYSTEM_PROMPT (min type size,
  contrast, no overflow, **RTL/BiDi correctness** — the existing LANGUAGE &
  DIRECTION block, untouched).
- **Reuse** — existing opt-in `DESIGN_STYLE_DIRECTIVES` (7): a user pick overrides
  the roll; else the content-gated roll runs.

## RTL / BiDi safety
- Direction-handling (the `LANGUAGE & DIRECTION` prompt block + 3 OOXML layers +
  Latin-numeral rule + dom-to-pptx patches) is a SEPARATE layer from layout-style
  and is **untouched**. The DIRECTION decides look, not text direction.
- Care points (not conflicts): (1) systems drive type *treatment*, never the
  font family — brand fonts stay; (2) the expressive Arabic treatments
  (`calligraphic` / `editorial_naskh` / `kufi`) lean harder on shaping +
  letter-spacing-strip + export post-processor — test before trusting.

## Open decisions for the user
1. Phase-A model: Sonnet-fast extra call vs heuristic (latency/cost of +1 small call).
2. Dedupe horizon N.
3. Where to persist {weights, rolledSystem} (new column vs existing JSON blob).
4. Phasing: quick mimic-directive win now → engine as its own phase.

## The quick win (separate, smaller)
Replace the current `VISUAL_DIRECTION_DIRECTIVE` with design-Claude's
archetype-based forcing wording (frame + 4–6 archetypes + motifs + "accent =
fill, not ink" + "match density, don't reduce it") + the legibility/RTL floor.
Sharpens the *mimic* path now, no engine needed.

## Prompt line-level fixes (validated w/ design-Claude, NOT yet landed)

These are the "stop forcing sameness" edits found by auditing the live prompt.
All keep RTL/export safety intact.

1. **Opening persona line (global — SYSTEM_PROMPT + SYSTEM_PROMPT_IMAGES share it).**
   Current: "...Every slide is a unique canvas — never reuse a layout in a row.
   Designer, not templater." — the anti-repetition bias from LINE ONE, silently
   overriding the layout-menu fixes. Replace with the "ONE coherent visual system
   + reusable archetypes + disciplined reuse is the craft; bespoke = a fresh
   system for THIS content, never stock template / AI slop" version. Keeps the
   elite/anti-slop identity; flips discipline from novelty→coherent reuse.

2. **SLIDE MARGINS / chrome rule (COMPOSITION_RULES) — DROP the forced frame entirely.**
   VERIFIED 2026-06-02 (repo-wide grep): the 140px bottom chrome band, the fixed
   80/50 insets, and the `data-anchor` attribute are **consumed by NOTHING** in
   the export/render path. `dom-to-pptx` converts whatever positions exist;
   `bidi-postprocess` is margin-agnostic (grows text shapes opposite the anchor,
   preserving Claude's own margins). So the band/insets were **pure prompt
   scaffolding, never an export requirement** (an earlier assumption that turned
   out wrong). claude.ai placed chrome perfectly unprompted — the model owns this.
   - **Replace** the fixed-frame rule with a light hygiene note: "Place logo /
     pagination / footer yourself — consistent position across all slides, clear
     of the headline (opposite its alignment edge: RTL → top-left), not
     overlapping body. Body margins follow the reference, else the rolled density
     (airy ~120 / medium ~90 / dense ~64)." No fixed band, no shared inset number.
   - Genuinely load-bearing for export (KEEP): BiDi/RTL text direction, the
     `bidi-postprocess` shape handling, font embedding, scrim direction.

3. **Reference-overrides-images precedence (gated on a reference being attached).**
   When a layout reference is present, the reference governs density + image ratio;
   this OVERRIDES the image-led directive. If the ref uses only small accent images:
   no large image panels, no [image|text] splits, no 1-image-per-2-3-slides quota —
   replace that quota with the reference's card/stat density; whitespace must not
   exceed the reference's. Cleanest: gate host-side — ref attached → image-mode =
   "accent-only"; never ship both framings in one prompt.

4. **Logo / chrome opposite the headline (global chrome rule).**
   Logo must never share a corner/vertical edge with the headline. RTL (right-
   aligned headline) → logo TOP-LEFT; LTR → top-right; centered → top-left or
   bottom-center. ≥1 line-height clear band between chrome row and first headline
   line. Best bound deterministically host-side: logoCorner = isRTL ? "top-left"
   : "top-right".

Status: all four validated; landing is a prompt + small-code batch (chrome
constants shared with exporter, host-side image-mode gate + logoCorner binding).

## Follow-up phases (queued)

- **Bucket-2 server enforcement** — add Arabic/tashkeel line-height clamp +
  fixed-height→min-height conversion + min card-padding into `bidi-postprocess`
  (it already walks every strong-RTL text body). Then delete the ARABIC
  TYPOGRAPHY lines from the prompt. Until built, those lines stay in the lean
  prompt as a tiny note.
- **Rasterize-decoration fallback (export)** — when an element uses CSS
  `dom-to-pptx` can't convert (conic-gradient, backdrop-filter, mix-blend-mode,
  filter:blur/drop-shadow), isolate-render JUST that element to PNG via the
  existing Chromium and swap an `<img>` so it embeds as a picture. HARD GUARD:
  skip any element containing text (never bake text — kills selectability +
  Arabic shaping). Ships → deletes most of Bucket 3's "don't use" list. NOT a
  blocker for the lean prompt (the trimmed don't-list is ~6 words).
