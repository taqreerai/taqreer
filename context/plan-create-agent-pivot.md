# Pivot Plan — /create as a deck agent (HTML design-system + `<section>` slides)

Status: PROPOSED (2026-06-04). Scope: **/create only** first. Awaiting go-ahead.
Supersedes: `plan-html-streaming.md` (this is its evolved, correct form) and the
structured-outputs experiment (to be reverted).

---

## 0. TL;DR

Stop emitting a JSON manifest of inline-styled slide blobs. Instead, do what
**claude.ai/design** does (reverse-engineered live, 2026-06-04):

1. **Plan** the deck in a scratchpad (titles + layout types + narrative check).
2. **Author ONE HTML document**: a `<head><style>` **design-system**
   (CSS variables + component classes) + a `<body>` of **`<section data-label>`
   slides** that use those classes — lean, semantic, *no inline-style
   repetition*.
3. (Later) **Validate & fix** each slide in our own Chromium (overflow/overlap),
   feeding flagged slides back to the model.

This is run as a small **agent loop** (plan → draft → validate-fix), driven
manually with the **Messages API** inside our Inngest function — **no Agent
SDK**.

**Consistency comes from MECHANISM, not prompt wording** (see §3.5): a
**provided + cached design-system scaffold** the model fills (not invents) + a
**validation-and-fix loop** + a **strict plan tool** — and the slide HTML is
**never** put inside a constrained field.

---

## 1. Why — the root cause this fixes

Every failure this week (`.map()`/concat corrupting JSON; constrained-decoding
stubbing `"x"` and quitting) traces to one thing: **we force the model to repeat
itself.** Our slide is a self-contained blob with inline styles copy-pasted onto
every element. Inside a JSON string that repetition becomes `"a"+"b"`/`.map()`;
under a grammar it becomes stub-and-bail.

claude.ai removes the repetition at the source: define `.toc-item{…}`,
`.uc{…}` **once** in a `<style>`, then every list/grid item is a terse
`<div class="uc">…</div>`. Nothing to repeat → the model writes everything out,
full, in its natural mode. The reference deck (`تقرير.html`) authored a 9-item
ToC, a 6-card grid, and a 5-step timeline **completely**, ~14 KB total for 11
rich slides — vs our ~66 KB of inline-style spaghetti that corrupted.

**The fix is architectural, not a prompt tweak: factor styling into a shared
stylesheet.**

---

## 2. Reference architecture (what claude.ai/design actually produced)

Three files from the live run (saved under `/Users/osama/Downloads/`):

- **`scratchpad.md`** — the plan: format (11 slides, 1920×1080, RTL, editorial/
  Swiss-grid), colors, font, the **11 titles each tagged with a layout type**
  (cover / ToC / definition / list / section-break / timeline / grid /
  statement), an explicit narrative coherence check, and a "System" section that
  enforces **layout variety** so slides don't all look alike.
- **`تقرير.html`** — ONE document:
  ```html
  <!DOCTYPE html><html lang="ar" dir="rtl"><head>
    <link href="…IBM+Plex+Sans+Arabic…" rel="stylesheet">
    <style>
      :root{ --type-title:72px; --purple:#6D28D9; --ink:#1A1426; … }   /* tokens */
      section{ … } .rh{ … } .toc-item{ … } .uc-body{ display:grid; … }  /* components */
    </style>
  </head><body>
    <deck-stage width="1920" height="1080">
      <section data-label="الغلاف"> … class-based markup … </section>
      <section data-label="جدول المحتوى"> … 9-item ToC, written out … </section>
      … 11 total …
    </deck-stage>
    <script src="deck-stage.js"></script>
  </body></html>
  ```
- **`deck-stage.js`** — a provided **web-component harness** (74.6 KB scaffold,
  not the deck): auto-scales a fixed design canvas with `transform:scale()`,
  keyboard/touch nav, thumbnail rail, **`@media print` → one section per PDF
  page**, speaker notes, and **`data-om-validate="no_overflowing_text,
  no_overlapping_text,slide_sized_text"`** (a layout validator). We already own
  equivalents (SlideRenderer + slide-nav + PDF/PNG export) — we adopt the
  *authoring pattern*, not necessarily their component.

Key authoring rule from `deck-stage.js`'s own docs (verbatim): *"a slide
rendered through … a loop over a JS array has to round-trip every tweak through
a chat message instead. Reach for script-generated slides only when the content
genuinely needs interactive behaviour."* → **Anthropic explicitly steers the
model to static HTML over code.**

---

## 3. New wire format (model output, /create)

The draft turn produces ONE HTML document. We do **not** ask for a JSON manifest.

```
<style>
  /* design system — tokens + component classes. May use our brand vars: */
  :root{ --type-title:72px; --gap:40px; /* model's own scale */ }
  section{ width:1080px; height:1920px; … }   /* sized root, see §6 */
  .rh{…} .toc-item{…} .uc-body{display:grid;grid-template-columns:repeat(3,1fr);…}
</style>
<section data-label="الغلاف" data-role="cover"> … </section>
<section data-label="جدول المحتوى" data-role="content"> … </section>
…
```

- **Brand/theme = server-injected CSS variables.** Palette → `--brand-1…N` via
  `themeToCssVars`/`SlideRenderer`; we fill them from the brief.
- **FONT MODEL UPDATED (2026-06-04) — no more heading/body split.** There is now
  ONE brand font: a single Google family, OR the user's set of uploaded fonts
  (multiple faces). Expose a single `--font` (plus the uploaded `@font-face`
  faces) and DROP `--font-heading`/`--font-body`. `ThemeSchema` (the
  `fontHeading`/`fontBody` slots), `themeToCssVars`, the scaffold's type styles,
  the brief→theme mapping, and the FONT SOURCING prompt rules all migrate to the
  single-font model. (Tracked as a migration item — see §11.)
- **The `<style>` design system is PROVIDED + CACHED, not invented per run**
  (see §3.5 — this is the consistency lever). We ship a fixed scaffold (tokens +
  component classes whose colours read `var(--brand-1)` etc.); the model authors
  only the `<section>` BODIES against it (+ at most small slide-specific tweaks).
  So we own the *design system + palette + fonts*; the model fills the *content*.
  No theme block needed in the output. (Google-font `<link>` server-injected.)
- **Slide identity**: `data-label` (Arabic name, for the nav/thumbnails) +
  optional `data-role` (cover|section|content|stats|quote|image|closing, for
  downstream logic). `slideId` derived = `slide-${i}` or a slug of the label.
- **Images deck**: `data-genimage`/`data-genid` boxes work unchanged — they're
  just `<img>`s inside a `<section>`. `scanGenImages` runs per section.
- **One `<style>` per document**, shared by all sections (the whole point).

### Per-slide bridge (keeps our pipeline)
For storage + our existing per-slide renderer/export, each parsed `<section>`
becomes a self-contained slide:
```
slide.html = `<style>${sharedStyle}</style>${section.outerHTML}`
```
i.e. **prepend the shared `<style>` to each section.** Then `SlideRenderer`,
`dom-to-pptx`, `scanGenImages`, slide-versioning all keep working with no
change. (~1–3 KB style duplicated per slide — fine.)

---

## 3.5 Consistency architecture — how we GUARANTEE design-system conformance

A prompt is guidance, not a guarantee (proven repeatedly this week). Consistency
comes from MECHANISM. Ranked (all GA except Skills); researched against the
Anthropic docs 2026-06-04:

1. **Provide + CACHE the design-system scaffold — the biggest lever.** Don't let
   the model invent the `<style>` each run (that's the variance). Ship a FIXED
   scaffold (our tokens + component classes — the `deck-stage` + "omelette"
   equivalent); the model authors only the `<section>` BODIES against it.
   - **Files API** — upload the scaffold once, reference by `file_id` (free, no
     re-upload). `docs/build-with-claude/files`.
   - **Prompt caching** — put the scaffold in the system prompt with
     `cache_control:{type:"ephemeral"}` (5-min TTL; ~10% input price on cache
     reads; 1-hour TTL at 2× available). Composes with streaming + extended
     thinking + tools. ⚠️ changing tool defs / thinking params / adding images
     invalidates the cache, so keep those stable.
   - **The B.3 STYLE SELECTOR maps onto this directly: each of the 8 styles =
     its own scaffold.** The style stops being a probabilistic prompt directive
     and becomes the cached design-system CSS for that style (every "Editorial"
     deck shares the Editorial scaffold) — so the style engine IS the
     consistency mechanism. v1 may ship ONE base scaffold + the style directive
     (faster, less consistent); the full version authors a scaffold per style.
     Brand tokens (`--brand-N`, `--font`) parameterize whichever scaffold loads.

2. **Validation-and-fix loop — the mechanical backstop.** Render each slide in
   OUR Chromium, measure overflow / overlap / min-font, send flagged slides back
   to fix (≤2 rounds). This is claude.ai's `data-om-validate`. Corrects drift to
   a fixed bar even when a draft varies. (Implemented in §4 Turn 3+.)

3. **Structured PLAN via a strict tool — METADATA ONLY.** A `submit_plan` tool
   (`strict:true`) for titles + per-slide layout enum + count. Short fields →
   constrained decoding is safe here and yields consistent structure + layout
   variety.

4. **Free-form streamed HTML for slide bodies — NEVER constrained.**

### ⚠️ Load-bearing rule (confirmed empirically AND in the docs)
Strict tools and `output_config.format` use the SAME constrained decoding. For a
LARGE free-text field, the grammar still lets the model **close the string
early** — exactly the `"x"` stub-and-quit we observed when we tried structured
outputs. Therefore: **NEVER put slide HTML inside a tool input or an
`output_config` schema.** Constrain only the small PLAN metadata; stream the
HTML free-form. (This is why the structured-outputs experiment is reverted.)

### Skills — DEFERRED
Anthropic Skills require the server-side `code_execution` container (a
BROWSERLESS Python sandbox) + 3 beta headers (`skills-2025-10-02`,
`code-execution-2025-08-25`, `files-api-2025-04-14`). Our scaffold is CSS + rules
with no code to execute, so a **cached scaffold delivers the same consistency
without the container.** Revisit Skills only if the design system grows huge or
needs cross-surface/org reuse.

---

## 3.6 Scaffold compatibility — FOUNDATION + SCOPED-EXTEND (2026-06-04, post-live-test)

**What the first live `/create` run taught us.** Phase 1 worked: the model
authored 11 clean `<section>`s against the cached scaffold — cover, ToC,
definitions, tinted/accent grounds — no JSON corruption, no stubbing. But slide 6
("how it works") showed a layout-POLISH defect. Claude wanted a VERTICAL
numbered-step list; the scaffold only ships a HORIZONTAL `.flow-steps`, so Claude
**repurposed it with inline overrides**
(`style="grid-auto-flow:row; border-top:1px…; padding:22px 0 0"`). The horizontal
component has no bottom padding by design (its dividers are vertical), so stacked
vertically each step's title landed flush on the next step's top border — measured
`titleToLinePx: 0`. Text touching the divider line.

**Root cause — the format FORCES it; it's not Claude misbehaving.** A fixed
scaffold cannot cover Claude's open-ended design space. Our prompt says "use the
scaffold classes; add a one-off INLINE style only when a layout needs one" — so
any layout we didn't anticipate becomes an **inline per-element override**, which
is (a) the exact inline-spaghetti pattern the pivot factored AWAY, and (b) carries
no holistic spacing → overlaps. We escaped inline repetition by providing a
stylesheet, then handed Claude inline overrides as the only escape hatch.

**The lesson from claude.ai/design (the reference we reverse-engineered).** There,
Claude authors the ENTIRE `<style>` itself — the design system and the slides come
from one hand, so its components and slides ALWAYS match; it never improvises
against someone else's fixed system. That is precisely why its decks don't have
this overlap class. Our deviation — pre-provide a fixed `<style>`, forbid Claude
from writing one — is what creates the mismatch.

**The architecture: FOUNDATION + SCOPED-EXTEND.** Make the scaffold a strong
foundation, not a hard ceiling.

1. **Foundation (cached scaffold, role unchanged).** The cached `<style>` ships
   the tokens + the common components + the brand lock (`var(--brand-N)` /
   `var(--font)`). Most slides use it as-is → consistency + brand discipline
   preserved.
2. **Scoped-extend (the escape hatch).** Let Claude ADD factored component
   classes in a `<style>` when the scaffold lacks a layout — defining spacing
   properly, ONCE — instead of inline overrides. A `<style>` of reusable classes
   is the OPPOSITE of the repeated-inline-styles that corrupted; it's the same
   principle that fixed it, authored by Claude. Prompt steer: "need a layout the
   catalogue lacks? Define a small component in a `<style>` (classes, not inline
   per-element styles). NEVER re-orient a scaffold component with inline overrides."
3. **Auto-scoping bridge (makes #2 safe).** Claude's ad-hoc `<style>` must not
   leak to the app and must survive the render pipeline. The bridge:
   - puts the `<style>` INSIDE the `<section>` (proven: a leading `<style>` is
     hoisted to `<head>` and dropped by the sanitizer's re-parse; inside the
     section it survives — `buildScaffoldSlideHtml` already does this);
   - **prefixes every selector in Claude's `<style>` with `.tq-canvas`** — the
     exact scoping we already apply to our own scaffold (proven zero-leak) — so
     its rules can't escape the slide;
   - brand vars still lock colour/type (Claude's components reference
     `var(--brand-N)`, not raw hex — the existing brand-discipline rule).
   A deterministic server-side CSS selector-prefix pass — the same transform that
   scoped our scaffold.

**Two supporting levers:**
- **Coverage** — we modeled the scaffold on ONE reference deck (`تقرير.html`).
  Generate a handful more via claude.ai/design (varied topics → varied layouts),
  catalogue the layouts Claude reaches for, fold the recurring ones into the base.
  The richer the foundation, the rarer the extend.
- **Validate-and-fix loop (§4 Turn 3+, Phase 3)** — the mechanical backstop. Our
  Chromium measures overflow / overlap / `titleToLinePx≈0` / min-font and sends
  flagged slides back. Catches whatever still slips, every time.

**Trade-off — the decision (made 2026-06-04):**
- *Fixed-only* (the Phase-1 shape): max consistency + brand control, but Claude
  hits the ceiling and hacks inline → recurring overlap until the validate-loop
  cleans it; the validate-loop does all the heavy lifting forever.
- *Foundation + scoped-extend* (**CHOSEN**): far fewer overlaps (components always
  match slides), richer layouts, faithful to how Claude factors design on
  claude.ai/design; cost is slightly less cross-deck uniformity. Attacks the root
  (the inline-override ceiling) instead of patching symptoms.

**Not-a-regression caveat.** This overlap class is layout-POLISH, not correctness
— no JSON corruption, the deck renders. The old JSON path had it WORSE (every
slide bespoke inline styling, no shared system). The scaffold already reduces it;
foundation+scoped-extend + the validate-loop converge it to clean.

**Phase-2 build implications:** (a) the scratchpad/plan pass (Turn 1) assigns a
layout per slide AND flags "needs a custom component" so Turn 2 knows when to
extend; (b) the auto-scoping bridge (CSS selector-prefix pass on Claude's
`<style>`) is a Phase-2 deliverable; (c) sanitize already keeps a scoped `<style>`
(`ADD_TAGS:["style"]`), verify it survives the RTL-rewriter re-parse when authored
by Claude (same inside-section rule).

---

## 4. The agent loop (how we "invoke an agent")

Driven manually with the **Anthropic Messages API** inside the existing
`deck-generate` Inngest function — one `step.run` per turn. **No Agent SDK**
(it's dev-tooling-oriented + bills from a separate credit pool from 2026-06-15).
Tool use is GA and composes with streaming + extended thinking.

### Turn 1 — PLAN (the scratchpad)  [Phase 2]
- System: authoring rules + design-system guidance. User: the brief/content.
- Force a single tool call `submit_plan` (`tool_choice:{type:"tool",
  name:"submit_plan"}`) returning a structured plan:
  ```
  { title, slideCount, slides:[{ label, role, layout }], narrative, notes }
  ```
  (Structured so we can seed the preview's slot count + show a plan, and feed it
  verbatim into Turn 2.) A plain-markdown scratchpad is the simpler v1 if we
  skip the tool. `submit_plan` may be `strict:true` — short metadata only, so
  constrained decoding is safe here. **The plan is the ONLY constrained output;
  the slide HTML in Turn 2 is always free-form streamed** (§3.5 rule).
- Cheap (~1 short turn). Buys coherence + **layout variety** (the plan assigns a
  distinct layout per slide).

### Turn 2 — DRAFT (author the document)  [Phase 1 — the core]
- Messages: [user brief] + [assistant plan] + [user: "author the deck now"].
- `messages.stream` (no tools) → the model streams the `<style>` + `<section>`s.
- We **split sections live** (the adapted `StreamingHtmlSplitter`, §5) and push
  each to `streamingPreview` as it closes — same live-preview contract as today.
- Extended thinking ON (adaptive). Preserve thinking blocks if continuing.

### Turn 3+ — VALIDATE & FIX (our Chromium)  [Phase 3]
- After draft, render each slide in **our** headless Chromium (the
  thumbnail/export renderer) at design size and measure:
  overflow (scrollHeight > height), overlap (bounding-box intersections),
  text-too-small. (Mirrors `data-om-validate`.)
- If any slide fails, send turn N: "These slides overflow/overlap: [labels +
  measurements]. Return corrected `<section>`s for ONLY these." Model returns
  fixed sections; we splice them in. Loop ≤2×.
- **Why our Chromium, not Anthropic's `code_execution` tool:** that tool is a
  Python/Linux sandbox with **no browser** — it can't render/measure layout. We
  already run Chromium for thumbnails + PDF/PNG export; reuse it.

### Streaming + preview
Streaming is **per-turn**. The live per-slide preview happens during Turn 2.
Between turns (plan→draft, draft→validate) there's a short gap (acceptable;
we can show "planning…" / "checking layout…" status).

---

## 5. Parser changes — `StreamingHtmlSplitter` (already built, adapt)

`lib/deck/html-stream.ts` exists + is unit-tested (57 cases). Adapt boundary
from the `<!--TAQREER:SLIDE-->` marker to **real `<section>` elements**:

- Capture the leading `<style>…</style>` (everything before the first
  `<section`) as `sharedStyle`.
- A slide **closes** when the next top-level `<section` opens or the stream ends
  (track tag depth for `<section>` so a nested `<section>` inside a slide — rare
  — doesn't false-split; or rely on the model keeping slides as top-level
  siblings, which the format guarantees).
- Yield `{ slideId, label, role, html: sharedStyle + sectionOuter }`.
- Per-section close → `scanGenImages` + warm dispatch (unchanged hook).
- Re-emit/reset handling: not needed the same way (no JSON draft→re-emit), but a
  second `<style>`/restart can reset like `didReset()`.

Delete (once /create is the only consumer, later for all): `repairJson`,
`collapseJsConcat`, `extractLastJsonObject`, `parseHead`, `assemble`, the
degenerate-salvage guard, `manifestHeadOffset`, `StreamingSlideParser`,
`dumpRun`, the structured-outputs `output_config.format`,
`MODEL_OUTPUT_JSON_SCHEMA`.

---

## 6. Pipeline mapping — what stays vs adapts

| Piece | Status |
|---|---|
| `SlideRenderer` (client) | **Unchanged** — renders `slide.html` (= style+section) + theme vars + sanitize. The `<style>` is scoped within the slide's render container. |
| Theme / brand vars (`themeToCssVars`, fonts, `fontFaces`) | **Unchanged** — still server-injected. |
| `scanGenImages` + image-warm | **Unchanged** — scans per-section html. |
| `dom-to-pptx` export | **Works** — measures each slide (style+section). Verify the `section{width;height}` sizing (we set design size). |
| Sanitize twins (`sanitizeSlideHtml*`) | **Unchanged** — operate per-slide html. A `<style>` tag is allowed (DOMPurify keeps it; verify). |
| Slide-versioning / DB save (`seedSlideVersionsForInitialGeneration`) | **Unchanged** — `{slideId, role, html}` shape preserved. |
| Status route + `DeckView` streaming contract | **Unchanged** — `streamingPreview: SlideType[]`, `streamingTheme`, etc. |
| `SlideManifestSchema` | **Mostly unchanged** — we still assemble `{version, presentationId, title, language, direction, theme, slides[]}` and validate. `theme` from brief (not model). |

**Sizing detail:** today slides set `width/height` on the slide root div. Now
the root is a `<section>`; the shared `<style>` sets `section{width:<W>px;
height:<H>px}`. `SlideRenderer`/export must target the `<section>` as the sized
root. Confirm + adjust the renderer's root selector.

---

## 7. Scope & gating (create first)

The streaming step is shared by create/enhance/mimic/datasheet. To ship /create
without destabilizing the others:

- Add a branch: **create (+ its images mode) → new HTML-doc agent path**;
  enhance/mimic/datasheet → **existing JSON path** (untouched) until migrated.
- Gate on the existing source.kind / flow detection.
- The new prompt(s), the splitter, and the agent loop live behind that branch.
- Keep the JSON machinery alive for the other branches (don't delete yet).
- Migrate the others in a later pass once /create is proven.

---

## 8. Prompt changes (/create authoring prompt)

Replace the /create system prompt's OUTPUT section with **authoring guidance**,
not a JSON/format contract:

- "Author the slide bodies against the PROVIDED design-system scaffold (cached in
  the system prompt — §3.5): one `<section data-label='…' data-role='…'>` per
  slide, built from the scaffold's component classes + brand vars
  (`var(--brand-1…N)`/`var(--font)`). Add a slide-specific class only when
  a layout genuinely needs one. Do not redefine the design system." (The `<style>`
  scaffold is provided/cached; the model fills sections.)
- "Define styling ONCE in `<style>` and reuse via classes — write repeated items
  (list rows, grid cards, timeline steps) out in full as elements; never use a
  JS loop, `.map()`, `+` concatenation, or `${}` — there is no template engine."
- "Vary the layout per slide (cover / list / definition / grid / timeline /
  statement) for rhythm." (Comes from the plan in Phase 2.)
- Keep: BiDi/RTL rules, brand-colour discipline (var(--brand-N) only), GRAPHICS
  (icons/flags/charts), AVOID list, FONT SOURCING.
- Remove: all JSON/valid-json/single-quote/single-line/`{…}`-shape language
  (already stripped) and the structured-outputs schema.
- The chosen **design-style directive** (B.3 style engine) still leads the user
  message — it now informs the `<style>` design system + layout choices.

---

## 9. Revert / cleanup checklist

- [ ] Revert `output_config.format` (the structured-outputs knob) in the streaming call.
- [ ] Keep `MODEL_OUTPUT_JSON_SCHEMA`/JSON machinery only for the non-create branches (for now).
- [ ] Remove `dumpRun` debugger once the HTML path is stable.
- [ ] `estimateSlideCountFromText` (section-aware) — **keep** (still seeds count/plan).
- [ ] Icons GRAPHICS nudge — **keep**.
- [ ] `lib/deck/html-stream.ts` — keep + adapt (no longer "parked").

---

## 10. Implementation phases (each testable; create-only)

**Phase 1 — the format (core fix), single streaming call:  ✅ DONE 2026-06-04**
1. ✅ Adapt `StreamingHtmlSplitter` to `<section>` + shared `<style>`.
2. ✅ New /create authoring prompt (`SYSTEM_PROMPT_CREATE_HTML`, §8). Structured
   outputs reverted; font model collapsed to single `theme.font`.
3. ✅ Branch the streaming step: `isCreateHtmlFlow` → server-built theme +
   `StreamingHtmlSplitter` → `buildScaffoldSlideHtml` (scoped `.tq-canvas` +
   baked canvas size) → manifest. enhance/mimic/datasheet stay on JSON path.
4. ✅ Pipeline verified: scoping zero-leak, sanitize keeps `<style>`, schema, font.
   **Render-bug found + fixed:** a LEADING `<style>` is hoisted to `<head>` by
   the HTML parser → dropped by the sanitizer's RTL-rewriter re-parse → unstyled
   slides. Fix: `<style>` goes INSIDE the `<section>` (rules still apply globally).
5. ✅ Live test (11-slide brief): clean sections, no corruption, live preview,
   brand-driven RTL deck. **Finding → §3.6:** slide 6 overlap from Claude's inline
   override of a horizontal component → motivates FOUNDATION + SCOPED-EXTEND.

**Phase 2 — planning pass + scaffold compatibility (§3.6):**
6. Add Turn 1 `submit_plan` tool; feed plan into Turn 2; seed preview slot count
   from the plan; the plan assigns a layout per slide AND flags "needs a custom
   component" so Turn 2 knows when to extend. Optional: surface the outline in UI.
7. **Foundation + scoped-extend (§3.6):** allow Claude to add factored component
   classes in a `<style>` (not inline overrides); build the **auto-scoping bridge**
   — a deterministic CSS selector-prefix pass that scopes Claude's `<style>` under
   `.tq-canvas` (+ inside-section). Update the prompt's "inline overrides only"
   rule → "extend in a `<style>`, never re-orient a component inline."
8. Coverage: harvest a few more claude.ai/design decks; fold recurring layouts
   into the base scaffold (incl. a proper VERTICAL-steps component — the slide-6 gap).

**Phase 3 — validate-and-fix loop:**
7. A Chromium measurer (overflow/overlap/min-font) reusing the export renderer.
8. Turn 3+ fix loop (≤2 rounds) for flagged slides.

**Phase 4 — migrate enhance/mimic/datasheet** to the HTML path; then delete the
JSON machinery (§5) wholesale.

---

## 11. Risks & open questions

- ~~**`<style>` per slide in our renderer**~~ **RESOLVED 2026-06-04.**
  DOMPurify KEEPS `<style>` (`ADD_TAGS:["style"]`). SlideRenderer does NOT render
  in isolation — it injects into a plain `<div>` in the MAIN app document, so the
  scaffold's global selectors (`:root`/`section`/`h1…`) WOULD leak. Fixed two
  ways: (1) the whole scaffold is scoped under `.tq-canvas` (selector-prefixed,
  proven zero-leak), (2) the `<style>` is placed INSIDE the `<section>` (a leading
  `<style>` is hoisted to `<head>` + dropped by the sanitizer's re-parse). Both
  in `lib/deck/scaffold.ts` (`buildScaffoldSlideHtml` + `withCanvasClass`).
- **Sizing root = `<section>`**: the renderer + dom-to-pptx must treat the
  `<section>` (sized via shared style) as the 1920×1080/1080×1920 root. Adjust
  selectors.
- **Section boundary in the stream**: top-level `<section>` siblings only;
  guard against a nested `<section>` mid-slide (rare). Tag-depth tracking or a
  format rule ("slides are top-level siblings; don't nest `<section>`").
- **Theme from brand vars only**: the model must use `var(--brand-N)` (already
  enforced) so our palette drives colour. A model that hardcodes hex bypasses
  brand — keep the brand-discipline rule.
- **Latency/cost**: Phase 1 single call ≈ today. Phases 2–3 add ~2–3× (extra
  turns). Acceptable for quality; gate validate-loop behind a flag if needed.
- **Plan↔draft drift**: the draft may deviate from the plan; that's fine
  (the plan is guidance, not a contract).
- **deck-stage adoption (future)**: consolidating SlideRenderer + nav + export
  into one `<deck-stage>`-style web component is a tempting cleanup (free PDF via
  `@media print`, built-in nav/scale) but is OUT OF SCOPE here.
- **FONT-MODEL MIGRATION (2026-06-04)**: drop the `fontHeading`/`fontBody` split
  everywhere → one `--font` (Google family) + uploaded-faces set. Touches
  `ThemeSchema`, `themeToCssVars`, the brief→theme mapping, the FONT SOURCING
  prompt, @font-face injection, PPTX font embedding, and the scaffold's type
  styles. Confirm the exact var shape + how multiple uploaded fonts are exposed
  to the model (one `--font` + the model picks weights, or `--font-1/2…`?) before
  building the scaffold.
- **Style-scaffold scope**: decide v1 = one base scaffold + style directive, vs
  authoring 8 per-style scaffolds. Affects Phase-1 effort + how consistent styles
  are out of the gate.

---

## 12. Definition of done (Phase 1)

- /create produces a full, rich, multi-slide RTL deck from the failing brief,
  live-previewed slide-by-slide, exported to PPTX/PDF cleanly.
- No JSON corruption, no stubbing, no retry loop.
- Other flows (enhance/mimic/datasheet) unaffected (still on JSON path).
- tsc + eslint clean; `/security-review` on the prompt-pipeline + any new
  render/validate surface.
