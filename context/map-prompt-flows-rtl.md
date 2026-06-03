# Map — Prompt across the 4 flows · Styles/Verbatim · RTL: prompt vs server

> Groundwork for **Part B.2** (clean, BiDi-ready prompt). Three questions:
> (1) how the prompt is triggered per flow + which flows get STYLES vs VERBATIM;
> (2) what the server already fixes for RTL/export; (3) which RTL prompt rules are
> REDUNDANT (server-handled → safe to cut) vs LOAD-BEARING (prompt-only → cutting
> them regresses BiDi, which is what happened after the lean).
> Goal: **move fixes server-side, not prompt**, until PPTX export is right ~90%.
> Sourced from a 3-agent read of `deck-generate.ts`, `composition-rules.ts`,
> `sanitize.ts`/`sanitize-server.ts`, `bidi-postprocess.ts`, `html-export.ts`,
> `scrim.ts`, `gradient-text.ts`, `patches/dom-to-pptx+1.1.8.patch`. Key claims
> spot-verified.

---

## 1. The 4 flows — trigger → prompt variant → content mode

All four POST to `/api/projects` → Inngest `deck.generate` → `deck-generate.ts`,
which branches on `source.kind` (Zod union in `lib/types/source.ts`). Variant
selection is one ternary (`deck-generate.ts:1789-1794`):
`mimic → SYSTEM_PROMPT_MIMIC` · `scratch+imagesMode → SYSTEM_PROMPT_IMAGES` ·
`everything else (scratch/enhance/data) → SYSTEM_PROMPT`. `isImagesMode` is
**scratch-only** (excludes enhance/mimic/data).

| Flow | `source.kind` | Prompt variant | Content blocks | Content mode | Directive gist |
|------|---------------|----------------|----------------|--------------|----------------|
| **CREATE / scratch** | none, or `scratch{anthropicFileId}` | `SYSTEM_PROMPT` (or `_IMAGES`) | none (text) / 1 doc (file) | **GENERATIVE** — "edit aggressively, do NOT redesign verbatim"; text path's fidelity guard was REMOVED | "Design a fresh deck… pick what matters" |
| **ENHANCE** | `enhance{fonts,textPerSlide,sourcePath,sourceMime}` | `SYSTEM_PROMPT` | per-slide PNG + "exact text (verbatim, authoritative)" | **VERBATIM (text) + 1:1 redesign** | "EXACTLY N slides, same order, never invent/drop; re-execute typography" |
| **MIMIC** (`/mimic` + `/use-template`) | `mimic{ugly/userContent,designAnthropicFileId}` | **`SYSTEM_PROMPT_MIMIC`** (stripped) | 2 docs: content + design ref | **VERBATIM (content) + COPY (visual)** | "same visual direction as the reference… never invent/drop" |
| **DATASHEET** | `data{markdown,…}` | `SYSTEM_PROMPT` | none (markdown inlined) | **GENERATIVE (from data)**, strict NUMERIC fidelity | "turn the dataset into an insight deck… every number traces to a cell" |

---

## 2. Verdict — which flows get STYLES, which get VERBATIM

**The clean split: flows that CREATE need a style; flows that COPY/PRESERVE get
their look from the source.**

| Flow | Verbatim content? | Should expose the STYLE PICKER? | Why |
|------|-------------------|--------------------------------|-----|
| **CREATE** | No (generative) | **YES — primary** | No reference; the style IS the visual identity. This is the style engine's home (B.3). |
| **DATASHEET** | No (generative from data) | **Optional / constrained** | Generative, so a style fits — but data decks gravitate to data-grid/corporate; expose a *subset* (or auto-pick) rather than all 8. Decide in B.3. |
| **ENHANCE** | **Yes** (per-slide exact text) | **NO** | Look is dictated by the source slide being redesigned 1:1; a style pick would fight "preserve the visual identity." |
| **MIMIC** | **Yes** (content) | **NO** | Look comes from the uploaded/template **reference**; the reference *is* the style. |

So: **STYLES → create (+ maybe a datasheet subset). VERBATIM enforcement →
enhance + mimic.** Create + datasheet are non-verbatim (create fully free;
datasheet free prose + numeric fidelity).

---

## 3. What the SERVER already fixes (the "don't prompt it" list)

Condensed catalog (full detail in the source files). Each neutralizes a specific
HTML/CSS pattern at export so the prompt doesn't have to.

**`patches/dom-to-pptx+1.1.8.patch`** — direction-aware `text-align` default
(`start`/unset → right in RTL) for tables + text (1.1/1.2); `taqreer_hasUniformScript`
splits **mixed-script** flex/grid rows into per-child shapes (1.5); `isSafeInline`
keeps bordered/rounded pills+badges as their own shape incl. per-corner radius read
(1.6); gradient direction/angle fixes (1.7/1.8); CSS padding → PptxGenJS `margin`
with the `[t,r,b,l]→[l,r,b,t]` order swap (1.13); weight-as-named-typeface + never-bold
(1.3); margin-top→breakLine (1.11); element-opacity→picture transparency (1.10).

**`lib/export/sanitize.ts` (+ `sanitize-server.ts` twin)** — RTL rewriters, gated on
root `dir="rtl"`: `rewriteRtlFlexEndToFlexStart` (column `align-items:flex-end`→`flex-start`),
`rewriteRtlRowFlexOrder` (row `justify-content:flex-end`→start; absolute 2-child split→`row-reverse`),
`rewriteRtlMarginAutoEnd` (`margin-right:auto`→left), `rewriteRtlImagePanelSide`
(image/text split→`row-reverse`), `rewriteImageScrim`→scrim.ts, `rewriteChromeOnTop`
(z-index+DOM-order — **browser-only, NOT in the server twin**).

**`lib/export/bidi-postprocess.ts`** — PASS 1 `bodyPr rtlCol="1"`; PASS 2 per-paragraph
`pPr rtl/algn` + LTR-in-RTL override + **run-merge** (fixes `"12%"→"%12"`) + **lang→ar-SA**
retag; PASS 3 Arabic glyph-drift shape widening (14% slack, dir-aware, container-clamped,
cap ~76% width); PASS 3.5 pill-row overlap; PASS 4 gradient-text sentinel swap.

**`lib/export/html-export.ts`** — `stripArabicLetterSpacing`, `insertScriptTransitionSpaces`
(Arabic↔Latin/digit), `splitMixedScriptFlexChildren`, `inlineSvgImages` (+recolor+sanitize),
`stripInlineBackgrounds`, font embedding, resource-load waits. **`scrim.ts`** re-orients
scrim dark-side to the text side + caps opacity. **`gradient-text.ts`** sentinel pipeline.

---

## 4. ⭐ Cross-reference — prompt RTL rules: REFLECTED vs LOAD-BEARING

The core table. "Reflected" = server already enforces it → **safe to cut from the
prompt**. "Load-bearing" = prompt-only → **cutting it regresses BiDi** (the lean's
mistake). "Migrate" = should be moved server-side so we *can* cut it.

| Prompt rule (file:line) | Governs | Server handler? | Verdict |
|--------------------------|---------|-----------------|---------|
| `dir="rtl"/"ltr"` on slide ROOT — `dg:106` | base direction | none (drives the browser render dom-to-pptx measures) | **LOAD-BEARING — keep** |
| Don't set `dir` on a child Latin block — `dg:107` | avoid wrong-side Latin | none (server won't undo a child `dir`) | **LOAD-BEARING — keep** |
| `dir="ltr"` on digit chrome blocks — `dg:109` | pagination/date order | partial: PASS 2 LTR-override (export only) | **Mostly load-bearing — keep** (browser/preview needs it) |
| Inline `<span dir="ltr">` for mixed/neutral runs — `dg:108` | neutral ordering `@./digits` | export: run-merge + lang-retag fix `%`/`.`; browser: not | **Partial — keep** (belt-and-suspenders; export mostly covers) |
| **Latin numerals only (0-9), never ٠-٩** — `dg:110` | digit script | **none** (no server conversion) | **LOAD-BEARING — keep (or migrate: trivial server transliterate)** |
| **Arabic `line-height ≥1.5/1.6` + `min-height` not `height`** — `cr:17` | clipping / tashkeel | **none** (Bucket-2 TODO, unbuilt — verified) | **LOAD-BEARING — keep; PRIME MIGRATION TARGET** |
| **Single-script flex siblings merge → split them yourself** — `cr:21` | `justify-content` lost | patch splits only **mixed-script or explicit-dir**; two Arabic spans **merge** | **LOAD-BEARING — keep** |
| Column `align-items:flex-end`→`flex-start` in RTL — `cr:20` | cross-axis flip | `rewriteRtlFlexEndToFlexStart` (intent-guarded) | **Reflected — but guard depends on prompt signals; keep as hint** |
| **AVOID list** (conic/blend/backdrop/blur/shadow/text-stroke/rgba/anim) — `dg:161` | non-rendering CSS | none (dom-to-pptx just fails to convert) | **LOAD-BEARING — keep; migrate via rasterize-decoration fallback (Bucket-3)** |
| `letter-spacing` on Arabic stripped — `dg:111` | shaping | `stripArabicLetterSpacing` | **Reflected — informational; safe to cut** |
| Scrim — "add one, the system orients it" — `dg:174` | scrim side/opacity | `applyScrimFixes`/`rewriteImageScrim` | **Reflected — prompt correctly defers; keep the 1-liner** |
| RTL row-flex order (NOT in prompt) | first-child side | `rewriteRtlRowFlexOrder` | **Fully server-handled — correctly absent** ✓ |
| Script-transition spaces (NOT in prompt) | `1إنشاء`/`70%faster` | `insertScriptTransitionSpaces` | **Fully server-handled — correctly absent** ✓ |
| `margin-top:auto` bottom-anchor (NOT in prompt) | bottom row | none specific | minor gap, low priority |

---

## 5. Why BiDi regressed after the lean — and the fix order

The lean cut COMPOSITION_RULES down to the Arabic-typography line + 2 flex gotchas
(restored 2026-06-03). The regressions come from **load-bearing rules that have NO
server backstop yet**, plus heuristic guards that depend on the prompt:

- **Arabic `line-height`/`min-height` (`cr:17`)** — prompt-only; if trimmed/ignored,
  glyphs clip and tashkeel collides. **Server enforcement is unbuilt** (Bucket-2).
- **Single-script flex siblings (`cr:21`)** — the patch doesn't auto-split same-script
  rows, so dropping this prompt rule loses `justify-content` layouts on export.
- **AVOID list (`dg:161`)** — no converter; cutting it (or using **mimic**, which
  omits AVOID — verified) lets non-rendering CSS through → blank/garbled shapes.
- **`dir` on root + Latin-numerals (`dg:106/110`)** — zero server backstop.

**Recommended order toward the 90%-PPTX goal (server-first):**
1. **Build Bucket-2 server enforcement** in `bidi-postprocess.ts` (it already walks
   every strong-RTL text body): clamp Arabic `line-height` ≥1.5/1.6, convert fixed
   `height`→`min-height` on Arabic boxes, enforce a min card-padding. → then DELETE
   `cr:17` from the prompt.
2. **Latin-numeral transliteration** server-side (trivial: map ٠-٩→0-9 in strong-RTL
   text during post-process) → then soften `dg:110`.
3. **Auto-split same-script flex siblings** (extend `taqreer_hasUniformScript` /
   `splitMixedScriptFlexChildren` to split 2+ same-script children at opposite ends of
   a flex row with `justify-content`) → then drop `cr:21`.
4. **Rasterize-decoration fallback (Bucket-3)** for the AVOID-list CSS (isolate-render
   the element to PNG; HARD-skip any element with text) → then trim the AVOID list.
5. Until 1–4 land, **keep all load-bearing rules in the prompt** — including putting
   the **AVOID list back into `SYSTEM_PROMPT_MIMIC`** (current gap/risk).

Each step is "build server fix → verify on a BiDi-heavy deck → then cut the prompt
line." That's the long testing loop.

---

## 6. Risks / gaps to watch during testing

- **`SYSTEM_PROMPT_MIMIC` omits the AVOID list** (verified) → mimic decks can emit
  conic-gradient/blur/blend that silently fails on export. Add AVOID back (or migrate).
- **`rewriteChromeOnTop` is browser-only** (not in `sanitize-server.ts`) → thumbnail/
  Puppeteer path can paint chrome under a full-bleed image. Parity fix candidate.
- **3 duplicated "strong-RTL" regexes** (`patch:90`, `bidi-postprocess:29`,
  `html-export:21`) must stay in sync — drift = silent BiDi misclassification.
- **PASS 3 intent-guards** (flex/margin rewriters) fire only when Claude emits the
  expected `text-align:left`/padding signals — so those prompt hints are load-bearing
  for the guards even though the rewriter "handles" the common case.
- **Create text-path fidelity guard removed** + **mimic stripped prompt** are both
  in-code `TEMPORARY TEST (2026-06-03)` — revisit before locking B.2.

---

## Test plan hook (B.2 step 3)

Soft-test with BiDi-heavy mixed Arabic/English content (inline Latin runs, neutrals
`@ . / %`, version numbers, an English-dominant deck too) across **create + mimic**
(the two riskiest: create = new substrate, mimic = stripped prompt). Export to PPTX
and check: root `dir`, neutral ordering (`%12` bug), Latin numerals, no glyph clip,
no flex flips, chrome-on-top, scrim side, AVOID-CSS not leaking. Log each failure
against the table above → decide "server fix" vs "keep prompt line."
