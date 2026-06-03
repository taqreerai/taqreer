# Plan — /create Style Engine (Part B)

> The core generation engine for the **/create** flow. Unlike /enhance and
> /mimic, /create has **no reference** to lean on — so a deck's entire visual
> identity must come from a chosen **DESIGN STYLE**. The old "mimic-in-create"
> (visual-direction reference upload) was removed first; this is what replaces it.
>
> Phasing (set 2026-06-03): **B.1 study → B.2 clean+BiDi-ready prompt → B.3 map
> the 8 styles onto the picker.** Do the phases in order — B.3's per-style
> directives only land cleanly on a prompt that B.2 has stripped of baked-in style.

Related docs: [research-design-styles.md](research-design-styles.md) (the B.1
deliverable) · [plan-design-direction.md](plan-design-direction.md) (the broader
weighted-roll/diversity engine, a later concern) · [prompt-v2-lean-draft.md](prompt-v2-lean-draft.md).

---

## B.1 — Design-styles study ✅ DONE (2026-06-03)

First-principles research on the universe of deck design styles, deliberately
unconstrained (no RTL/brand-token/existing-catalog assumptions — those are B.3).

- **Deliverable:** `context/research-design-styles.md` (committed `5e37465`).
- **Key outcomes:**
  - A style = a locked tuple over **6 orthogonal knobs**: composition system ·
    type treatment · color application (fill vs ink) · density · signature
    device · imagery treatment. Two styles look *completely* different only when
    they differ on **≥3 knobs, incl. composition + signature device**.
  - **Recommend 8 styles** (Hick's Law / Miller 7±2 / Iyengar jam study):
    Swiss/Grid · Editorial · Bold/Display · Minimal/Keynote · Corporate/Data ·
    Brutalist · Duotone/Full-bleed · Playful/Dopamine.
  - Each style has a ready-to-use **style-forcing directive** + an **images-mode
    mood directive**; plus the anti-convergence ("don't regress to the safe AI
    look") technique: fixed frame + 4-6 reusable archetypes + 1-3 motifs,
    "accent = FILL not ink", "match the density, don't reduce it."

---

## B.2 — Clean, BiDi/Arabic-ready prompt (NEXT)

**Goal:** make the base generation prompt a neutral, RTL-correct *substrate* so a
per-style directive (B.3) is the ONLY thing dictating visual style. Today the base
prompt still carries baked-in style ("LOCK ONE design system", disciplined-reuse
framing, density/composition leanings) that would fight a chosen style.

1. **Strip style-enforcing language.** Audit `inngest/functions/deck-generate.ts`
   (`SYSTEM_PROMPT`, `DESIGNER_IDENTITY`) + `inngest/prompts/composition-rules.ts`
   (`COMPOSITION_RULES`) + the existing `DESIGN_STYLE_DIRECTIVES`. Remove or
   neutralize anything that pre-commits a look (one-system lock, archetype-reuse
   bias, default density/composition, "elite editorial" leanings) so style comes
   from the injected directive, not the substrate. Keep only: output schema,
   brand-token sourcing, legibility floor, and the BiDi/RTL block.
2. **Confirm BiDi / Arabic readiness (do NOT touch — verify intact).** The
   `LANGUAGE & DIRECTION` block, Latin-numerals-only rule, the 3 OOXML layers
   (`bodyPr rtlCol` + `pPr rtl/algn` + `rPr lang=ar-SA`), and `lib/export/sanitize.ts`'s
   RTL rewriters are load-bearing and stay. The style layer decides *look*, never
   text direction. (See [project_bidi_fix], [feedback_latin_numerals_only].)
3. **Soft test — BiDi-heavy content.** Generate with content that is heavy in
   **mixed Arabic / English** (inline Latin runs, numbers, English terms inside
   Arabic sentences, an English-dominant deck too). Verify: correct RTL on the
   root, inline-Latin spans order correctly, Latin numerals, no clipping, no
   layout flips — and that with no style chosen the output is *neutral* (no
   leftover enforced look). No regressions vs current decks.

> ⚠️ Lock awareness: this is a **prompt-pipeline** change. Per the enhance/create
> prompt locks, changes need measured evidence + user buy-in — so B.2 is
> propose-then-test, not free edits. BiDi/RTL is the product's differentiator and
> its historical pain point; treat the RTL blocks as untouchable.

---

## B.3 — Map the 8 styles onto the picker

1. **Adapt the catalog to Taqreer constraints.** Make each of the 8 RTL/Arabic-
   viable and brand-token-driven: a style controls composition · type *treatment*
   (weight/scale/case-of-Latin/alignment) · color application · density ·
   signature device · imagery mood — **never** the font family (stays the brand's)
   or text direction (always correct RTL). Encode each as a knob-tuple + a
   style-forcing directive injected into the now-clean B.2 prompt.
2. **Build the picker (UI-only first).** Reuse the canonical glass modal
   (`SaveAsTemplateDialog` / `UseBrandKitDialog` recipe — `.glass-modal
   backdrop-blur-glass-boost` + `.modal-dim`, sibling portal); a visual
   side-by-side grid of the 8 (thumbnail + Arabic label + essence), ordered
   safe→expressive, optional "auto/surprise me". Trigger lives in the slot freed
   by the removed visual-direction panel (`/create` Export-Settings card).
3. **Wire-through (gated).** Selection → `rules.designStyle` → the matching
   directive in `deck-generate`. Existing `rules.designStyle` path already exists;
   keep it UI-only until B.2 lands + the directives are validated against real
   BiDi decks.

Later (out of B): the weighted content-gated roll / diversity engine and
content-domain bias (sports→Bold, etc.) per `plan-design-direction.md`.
