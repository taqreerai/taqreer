# Plan — In-canvas slide editor (DOM-native, ai-canvas-inspired UX)

Status: **PLANNED / not started.** Last updated 2026-06-06.
Owner context: this is the "manual scalpel" editor — direct WYSIWYG editing of a
slide's HTML, sitting alongside the existing AI regen paths. Written in full
detail because context is limited; everything needed to resume is here.

---

## 0.5 — REBUILD DECISION (2026-06-05): faithful **claude.ai/design** clone

Mid-Phase-0 we discovered **claude.ai/design** is the SAME architecture we're
building (HTML-native slides + inline-style control panel), done robustly — proof
the DOM-native path is right and the "nightmare" was only **raw contentEditable**,
not the architecture. User directive: **clone it entirely; iframe + tagging first.**

**The claude.ai/design blueprint (reverse-engineered live, Playwright into its
cross-origin iframe):**
1. **Sandboxed iframe** — slide HTML runs in its own iframe (they use cross-origin
   `*.claudeusercontent.com` + `postMessage`; **we use a same-origin `srcdoc`
   iframe** for the prototype → CSS isolation + clean chrome WITHOUT a postMessage
   bridge; harden to cross-origin later for prod security). This is WHY their chrome
   is clean: the slide is its own document, nothing from the app bleeds onto it.
2. **Element tagging on load** — every element gets a stable id (`data-om-id`);
   **content units** (text blocks, img, svg) also get `data-cc-id`; plain layout
   divs get neither. Enables precise selection + mapping edits back to source HTML.
3. **Selection model** — a click resolves to the nearest **content unit**, SKIPPING
   layout wrappers. Chrome = two `pointer-events:none` overlay divs INSIDE the
   iframe: **hover green `#10B981`**, **selection violet `#8B5CF6`**, 2px, **box
   inflated ~2px** so the border floats OUTSIDE the glyphs (measured: H2 box
   271/310/966×75 → overlay 269/308/970×79). Never overlaps text.
4. **Inline-style panel** — TYPOGRAPHY (Font, Size, Weight, Color, Align,
   Line-Height, Tracking) + SIZE (W/H) + BOX (Opacity, Padding, Margin, Border,
   Radius), bound to selected unit, writes inline styles. (= our A5, confirmed 1:1.)
5. **Transient `contentEditable`** — applied only during an active text edit.
6. HTML stays the single source of truth.

**Already replicated in the lab (this session):** content-unit click resolution
(skips divs) · inflated non-overlapping single outline (focus-ring killed) · robust
text editing (paste→plain-text, `<br>` not `<div>`, no stacked-listener dup, headings
always re-editable) · semantic Layers tree *(lab build; SELECTION was later
simplified to flat visual leaves — see Build status below — while the pruned
tree returns as the productized Layers panel, a navigation aid in the Layout
tab, §5.4)*.

**Rebuild sequence (the full clone):**
- **Chunk 1 — Iframe-isolated renderer.** Render the active slide into a same-origin
  `srcdoc` iframe sized 1920×1080, scaled to fit. Doc = reset + `themeToCssVars` +
  fonts + `theme.background/text` + `var(--font-body)` + the `sanitizeSlideHtml(slide.html)`
  `<section>`. Replaces the in-app `<SlideRenderer>` in the lab canvas. Selection/
  overlay/layers/edit/harness must all re-point from `canvasRef` to
  `iframe.contentDocument` and operate inside it.
- **Chunk 2 — On-load tagging.** After load, walk the iframe DOM: assign `data-tq-id`
  to every element; `data-tq-cc` to content units (reuse `isSelectableUnit`). Stable
  identity for selection + edit-mapping.
- **Chunk 3 — Overlay chrome inside the iframe.** Inject a hover box (green) +
  selection box (violet/brand), `pointer-events:none`, inflated ~2px, tracking the
  hovered/selected unit; click selects content unit; events wired on the iframe doc.
- **Chunk 4 — Text editing in the iframe.** Dbl-click unit → transient
  `contentEditable` with our hardened paste/junk fixes; A1/A2/A3 harness run against
  the iframe doc.
- **Chunk 5 — A5 inline-style panel.** TYPOGRAPHY/SIZE/BOX bound to selected unit,
  writes inline styles into the iframe element.

**Decisions:** same-origin `srcdoc` iframe (not cross-origin) for the prototype —
flag cross-origin+postMessage as prod hardening. Tagging at LOAD time (not in the AI
prompt) — keeps generation untouched. Selection colors: keep brand green for now
(violet is claude's); revisit.

**Build status (2026-06-05):** Chunks **1–4 DONE + verified** in `app/lab/editor/`
(`IframeCanvas.tsx` = render + tag + overlays + edit; `LabEditor.tsx` = shell;
`harness.ts` = round-trip tests + `buildLayerTree`). Bugs found+fixed along the way:
sanitize must run in an effect (was empty), transform-on-iframe paint clip → scale
content inside, RTL right-aligned the stage → pin absolute top-left. **Selection
simplified to flat visual leaves** (user direction): only text/img/svg are selectable
+ listed (a FLAT leaf list, not a tree); containers neither. *(The pruned semantic
tree is a productized Layers-panel navigation aid — §5.4 — NOT the selection model.)*
**Chunk 5 (A5 panel) = next**, plus fonts-into-iframe.
Remaining unknown = **export parity (A7)** — validate in `/project` (export already
wired) rather than build lab export plumbing. Absolute-vs-flow positioning **parked**
until the direct-manipulation phase.

**Commit trail (dev, not pushed):** `36605ac` lab prototype · `81a6bee` productized
engine (`lib/editor/leaves` + `components/preview/editor/SlideEditor`) · `1f51841` +
`9940b77` standalone `/edit` route (**superseded**, see §0.6 decision). **Now building
I1: Edit as a default mode of `DeckView`, in the shell.**

## 0.6 — Integration plan: lab → `/project` (build it ONCE, in the shipping shell)

Phase 0 proved the architecture in `/lab`. From here, **stop building in the lab** —
port the proven `IframeCanvas` into the real shell and build features there. Principles:
HTML stays the single source of truth (no parallel model); **reuse existing
components/primitives, never fork** (`ColorPickerPopover`, `SegmentedToggle`,
`InlineStepper`, brand controls…); realtime = in-place, never `router.refresh`;
`--tq-*` tokens + Latin numerals; editing gated by `lib/api/project-access`.
Each step is a shippable chunk; **touching `/project` needs an explicit go** (it's
the live product, not the throwaway lab).

> **DECISION (2026-06-05, user): the editor is the DEFAULT MODE of `/project`, IN THE
> SHELL.** Not a separate route, not a fullscreen takeover. After generation, edit-capable
> users land on `/project` already in **Edit** mode, with the dashboard chrome (header +
> sidebar) visible. View / Comment / **Edit** are modes of ONE working surface (`DeckView`)
> — because that surface owns everything editing needs alongside it (comments, AI regen,
> export, history/lock, realtime, presence, the slide pill); a separate editor route would
> fragment those. The standalone `/project/[id]/edit` route + `ProjectEditor` shell (commits
> `1f51841`/`9940b77`) were a **de-risk detour — now SUPERSEDED**; the reusable engine
> (`SlideEditor` + `lib/editor/leaves`, commit `81a6bee`) stays, the standalone shell is
> **REMOVED** (route `app/(app)/project/[projectId]/edit/` + `ProjectEditor.tsx` deleted —
> `/project/[id]/edit` now 404s; nothing linked to it). `buildLayerTree` in
> `lib/editor/leaves` is kept as engine for the I2 Layers panel.

- **I1 — Edit as a default mode of `DeckView`.** Add `editMode` state (mutually exclusive
  with `commentMode`), defaulting **on for `canEdit` users** on a completed deck (so you
  land in the editor). In edit mode the hero canvas (`DeckView` ~L3239) swaps
  `SlideRenderer` → `SlideEditor` (controlled: `editorSelected` / `onSelect`); suppress the
  comment overlay + per-slide pill while editing. A **View ⇄ Edit toggle** in the toolbar
  (`PreviewActionBar`). Stays INSIDE the `(app)` shell — **no portal / z-index takeover**.
  Productized engine already in `components/preview/editor/`. *(Status: **DONE** —
  `DeckView` swaps the hero canvas to `SlideEditor` when `editMode && !commentMode`;
  `editMode = canEdit` so owners land in the editor in-shell. Verified live: single
  hero iframe, select works, 6 leaves tagged. Toggle + pill-in-edit = follow-up.)*
- **I2 — A5 property panel** (core editing surface). Bound to the selected leaf:
  TYPOGRAPHY (font, size, weight, color, align, line-height, tracking) + BOX (opacity,
  padding, margin, border, radius) + SIZE (W/H). Writes **export-safe inline styles
  ONLY** (A7 hard rule — no conic-gradient/backdrop-filter/blur). Reuse design-system
  primitives. Consolidate-on-save (no inline override pile).
- **I3 — Persistence.** On commit: serialize edited iframe DOM → `sanitizeSlideHtml` →
  `slide.html` → write a new `SlideVersion` (treated exactly like a regen). `data-tq-id`
  becomes the join key for matching edits back to source. Undo/redo = `slide.html`
  snapshot stack. Status via existing realtime broadcast (in-place).
- **I4 — Export-parity check (A7, the real one).** With persistence live: edit → export
  PPTX + PDF + PNG via existing routes → confirm fidelity. The one real export test.
- **I5 — Roles + realtime + lock.** Gate Edit mode to owner/editor; viewers/comment-only
  can't edit. Broadcast edits in-place; lock so two editors don't clobber.
- **I6 — Images + AI hooks (later).** Image leaf: swap/upload + regen via the existing
  gpt-image pipeline (`deck.image.warm` → `deck-images-generate` → `injectImgSrc`)
  targeted at the selected box. Element-scoped AI ("rewrite/redesign this") uses
  `data-tq-cc` as the address for partial regen.
- **DECIDED (2026-06-05, after a lab spike): general drag/resize/rotate is DROPPED.**
  The only model that keeps the rest of the slide stable is freeze-the-WHOLE-slide-to-
  absolute on first manipulation (per-element freeze re-packs flex/grid siblings —
  measured 502px shift; whole-slide freeze measured ≤2px + 0px disturbance when moving).
  It works, but the UX cost — the entire slide goes rigid the instant you touch anything,
  losing the flow layout — isn't worth it for nudging text/boxes. So: NO geometry editing
  for general elements (they're styled via the I2 pill, not moved). **Exception: IMAGES**
  get move/resize/swap as a scoped, later feature (the one case where direct manipulation
  earns its keep). The lab freeze-drag spike was reverted; see context/log for the data.

**Cadence:** `/security-review` after the persistence route + iframe changes (new
route / schema / upload-handler territory). **Cross-origin hardening:** when ready,
move the slide iframe to a sandboxed cross-origin origin + `postMessage` bridge
(claude.ai's model) so untrusted AI HTML is fully quarantined from the app.

---

## 0. TL;DR

Every editing path we have today is **AI-driven** (full deck regen, single-slide
regen, draw-a-region + comment → partial regen). The missing primitive is a
**manual scalpel**: click an element on the slide and edit it directly — fix
text, restyle, nudge, recolor, change line-height — *without* re-rolling the AI.
This is only cheap because of the HTML-first pivot: a slide is a live DOM
(`<section><style>…scoped CSS…</style>… HTML/SVG …</section>`), so we make
elements selectable + `contentEditable` + drive a property panel that writes
inline styles, then serialize the mutated DOM back into `slide.html` and save it
as a new `SlideVersion`.

We borrow the **UI/UX** of **kyh/ai-canvas** (MIT, our exact stack) — its control
panels + editor shell — but **not its engine** (Konva) and **not its AI stack**
(Vercel AI SDK / Gateway / DALL·E). We keep DOM rendering + our **two** AI backends
(both via Inngest), and both must wire into the canvas: **Claude** (Anthropic)
designs/edits the HTML/SVG/text, and **gpt-image** (OpenAI) generates the raster
images (`deck.image.warm` → `deck-images-generate` → `injectImgSrc`).

**Build order:** static prototype first (`/lab/editor`, real deck, no wiring) →
prove DOM-editing survives our real slides → then port into the `/project` shell →
then wire persistence + AI.

---

## 1. Why this is the right shape (the drift-audit conclusion)

Earlier we killed the "see-and-fix loop" (render → vision/geometry detect → AI
redesign) because the *detector* was noisy ("flags barely-visible stuff that
isn't the problem") and a regen is slow + costs an Opus call. The remaining
drifts are **minor** (a heading one size too big, a block nudged 12px, tight line
spacing, a word too long, a slightly-off color, an overlapping overlay). For
minor drifts, re-rolling the AI is the wrong tool — you want a scalpel. Most
"server-side-fixable vs impossible" drifts collapse into a third bucket: **"the
user just edits them."** That's this editor. (A deterministic auto-fit overflow
pass can ride along later as an assist, but the editor is the headline.)

---

## 2. Reference: kyh/ai-canvas — facts from the study (2026-06-05)

Repo: `https://github.com/kyh/ai-canvas` — MIT, "forkable Next.js template … build
your own Canva/Figma/tldraw." ~23★, template/demo grade. Cloned read-only to
`/tmp/ai-canvas-study` (TEMPORARY — may be gone later; key facts captured below;
re-clone with `git clone --depth 1` if needed). **Never `npm install`/run it**
(untrusted postinstall).

**Stack (= ours):** Next 16 App Router, React 19, TS, **Tailwind 4**, Radix +
shadcn/ui, **Zustand**, Vercel AI SDK v6. Plus `konva` + `react-konva` (the part
we DON'T take) and `react-gcolor-picker`, `@remotion/google-fonts`.

### 2a. Its data model (`src/lib/schema.ts`) — a flat list of absolute boxes
`templateSchema = { size:{width,height} (default 1280×720), background?, blocks:[] }`.
Flat `blocksById` + `blockOrder:string[]` — **no parent/child, no groups, no
flow/flex/auto-layout.** Every block (`blockBaseSchema`) stores **absolute canvas
coords** + CSS-shaped props:
`id, type(enum text|frame|image|arrow|html), label, x, y, width, height,
rotation(deg, default 0), scaleX, scaleY (default 1), visible, opacity (0–100!),
locked?, background? (supports linear-gradient strings), border{color,width,dash:number[]},
radius{tl,tr,br,bl}, shadow{color,offsetX,offsetY,blur,enabled}, flip{horizontal,vertical}`.
- **text** extends: `text, color, fontSize(px), lineHeight(px! absolute, not unitless),
  letterSpacing(px), textAlign(center|left|right|justify), font{family,weight},
  textTransform?, textDecoration?`.
- **frame** = a styled absolute `<div>`. **image**: `url, prompt?, fit(object-fit), position(object-position)`.
- **arrow** (4-pt vector + arrowhead) and **draw** (freehand polyline) are SVG-native — no clean CSS analog.
- **html** block: `html:string` rendered in an `<iframe srcDoc>` via a `react-konva-utils` `<Html>` portal.

→ **Almost every property maps 1:1 to a CSS prop on an absolutely-positioned
`<div>`.** That's why the *controls* transfer. But the model is a **flat absolute
box list**, NOT our nested flex/grid/SVG DOM — so we can't load our slides into
it, and we don't adopt the model.

### 2b. Its property controls (what we HARVEST) — `src/components/canvas/controls/`
Right-panel assembler `views/editor-right-side.tsx`: single block selected →
`LayoutController` always, then `TextController` (text) or `LayerController`
(everything else); nothing selected → `CanvasController`. All write via
`updateBlockValues(id, partial)`. Controls (file → property → value → CSS):
- `controls/layout-controller.tsx`: X/Y (`x`/`y` px), W/H (`width`/`height` px, image is aspect-locked), Rotate (`rotation` deg), Scale X/Y (multiplier). → left/top, width/height, transform:rotate, transform:scale.
- `controls/text-controller.tsx` (text only), composed of `controls/components/textControls/`:
  - `content-control.tsx` → `text` (single-line `<Input>` in panel; on-canvas dbl-click opens an overlay `<textarea>` — NOT contentEditable; we'll use contentEditable instead).
  - `font-picker.tsx` → `font.family` (`font-family`) + `font.weight` "100".."900" (`font-weight`); fonts from `fonts.ts` (~110 Remotion Google fonts, lazy-loaded).
  - `font-size-control.tsx` → `fontSize` px (`font-size`).
  - `line-height-control.tsx` → `lineHeight` **px absolute** (CSS wants unitless multiplier → CONVERT).
  - `letter-spacing-control.tsx` → `letterSpacing` px (`letter-spacing`).
  - `text-align-control.tsx` → `textAlign` (`text-align`); `text-transform-control.tsx`; `text-decoration-control.tsx`.
  - Color via shared `ColorControl` (`disableGradient` for text `color`).
- `controls/layer-controller.tsx` (non-text), via `controls/components/`:
  - `color-control.tsx` (+`color-picker.tsx` = `react-gcolor-picker`, gradient-capable) → `background` (`background`, incl. `linear-gradient`).
  - `border-control.tsx` → `border{color,width,dash}` (dash = Konva number-array `[12,8]`/`[2,6]` → CONVERT to CSS solid/dashed/dotted).
  - `radius-control.tsx` → `radius{tl,tr,br,bl}` (`border-radius` 4-corner).
  - `shadow-control.tsx` → `shadow{color,offsetX,offsetY,blur,enabled}` (`box-shadow`; no spread param).
  - `opacity-control.tsx` → `opacity` **0–100** (CSS wants 0–1 → CONVERT).
  - `flip-control.tsx` → `flip{h,v}` (CSS `transform: scaleX(-1)/scaleY(-1)`).
- Shared shells: `controller-box.tsx` (accordion section), `controller-row.tsx` (label-left/control-right row). Both pure layout, reusable.

**3 unit divergences to convert when lifting:** `lineHeight` px→unitless,
`opacity` 0–100→0–1, border `dash` array→CSS keyword.

### 2c. Its AI + export (what we DON'T take)
- **Export** (`services/export.ts`): only PNG (`stage.toDataURL`) + a JSON dump of
  the block model. **No Konva→HTML serializer.** No arbitrary-HTML importer
  either (grep: no DOMParser/parseHTML/innerHTML). So it can neither ingest nor
  emit our slides → adopting its model would be a full rewrite. Don't.
- **AI**: Vercel AI SDK v6 → AI Gateway (`openai/gpt-5.1-instant` router + agents,
  `dall-e-3` for images); demo mode uses a **hard-coded mock transport**
  (`@loremllm/transport`, `src/components/demo-transport.ts`). Two agents:
  `canvas-agent` emits structured block tool-calls (mutates the scene), `builder-agent`
  emits a full HTML doc into an iframe `html` block, both vision-driven (a canvas
  screenshot is attached each message). **We keep our own pipeline — Claude
  (Anthropic) for structure/text + gpt-image (OpenAI) for raster images, both via
  Inngest; reuse none of theirs — only the chat-input UX surface as a pattern.**

### 2d. Its shell / UX (the structure we mirror)
- `views/editor-bottom-toolbar.tsx`: floating pill, **AI ⇄ Design** tabs (Shift+Tab toggles).
  - AI tab: auto-grow textarea + send.
  - Design tab tools: Select(V), Move/Pan(Space), Text(T), Image(file picker), Frame(F), Arrow(A), Draw(D), | Undo(⌘Z), Redo(⌘⇧Z), | Export ▾ (image / copy-JSON).
- `views/editor-left-side.tsx`: **Layers** list (z-order; per-item: type icon, inline label, click-select, hover-highlight, dimmed-when-hidden; ⋯ = Rename/Duplicate/Delete/Hide-Show/Bring forward/to-front/backward/to-back). Footer: GitHub, theme toggle, settings. **(We DON'T replicate this left-panel Layers; a PRUNED version is KEPT, folded into the Layout tab — see §5.4.)**
- `views/editor-right-side.tsx`: context-sensitive Properties (the controls in §2b).
- Zoom/pan: `zoomable.tsx` (−/+/reset), `use-canvas-zoom-pan.ts` (0.25×–5×, ctrl-wheel zoom / wheel pan). **(We don't need infinite pan; slide is a fixed frame.)**
- Hotkeys (`hooks/use-canvas-hotkeys.ts`): ⌘A select-all, ⌘C/⌘V copy/paste, Space=pan, V/F/T/A/D mode, Backspace/Delete. (No undo/redo/nudge/cut hotkey — gaps.)

---

## 3. Our current `/project` shell (what we modify) — `components/preview/`
- `DeckView.tsx` (~3000 lines): the editor page root. Center = hero slide canvas.
- `SlideNavSidebar.tsx` — **right-edge** deck filmstrip (slide thumbnails + `SlidePill` per-slide status + bulk-lock footer pill). Snaps `right:260`↔`right:80`. aria-label "شريط الشرائح". Swaps with `CommentsPanel` in comment mode.
- `components/slides/PreviewActionBar.tsx` — **left**, portal'd vertical fixed-left toolbar (export PNG/PDF/PPTX/HTML via `useExportActions`, comment, share, history). `data-preview-toolbar="true"`.
- `SlidePill.tsx` — per-slide status pill (generating / locked / done).
- `CommentsPanel.tsx` + `HeroCommentOverlay.tsx` — the draw-region + comment → partial regen flow.
- `HistoryPopover.tsx` (version history), `SlidePresenceStack.tsx` (collab avatars).
- Slide HTML is rendered by `components/slides/SlideRenderer.tsx` (DOMPurify sanitize → `dangerouslySetInnerHTML`, theme CSS vars on the root via `themeToCssVars`).
- Existing AI routes/pipelines we REUSE: `inngest/functions/deck-regenerate-partial.ts` (single-slide / region regen — already HTML-native: reads `slide.html`, asks Claude for HTML body, strips fences, splices), `deck-image-warm.ts` + `deck-images-generate.ts` (gpt-image fill via `deck.image.warm` / `slide.image.ready` broadcast + `injectImgSrc`), the status route `app/api/projects/[id]/status` (`?includeManifest&includeSlideStates&includeImageFills`).
- Slide self-contained HTML built by `lib/deck/scaffold.ts buildSlideHtml` (scoped `<style>` via `lib/deck/scope-css.ts scopeDeckCss`, canvas frame). Brand vars `--brand-1..N`/`--brand-bg`/`--font-heading|body`/`--primary|secondary|accent` injected at slide root by `lib/export/theme-css-vars.ts themeToCssVars` for ALL consumers (preview + PPTX + PDF + PNG + HTML). dom-to-pptx (patched, `patches/dom-to-pptx+1.1.8.patch`) reads **computed styles** off the rendered DOM — so any edit must end up in computed style, and stay RTL/export-safe.

---

## 4. Scope from the study: what works / adapts / won't (editing capabilities)

**Transfers cleanly (the harvest):** the whole property/inspector surface (text:
font family/weight/size/line-height/letter-spacing/color/align/transform/decoration;
box: fill incl. gradient, border, per-corner radius, box-shadow, opacity), inline
text edit (contentEditable, cleaner than their textarea), z-order via DOM reorder,
delete/duplicate/hide, the bottom-toolbar shell, selection + 8 resize handles +
rotate handle + outline (re-implemented on a DOM rect), their components (our stack)
restyled to our tokens.

**Adapts:** "move" = free-drag for **absolutely-positioned** elements (set
left/top/transform); **nudge** (transform/margin) for flow/flex children. Rotate/flip/scale
of arbitrary subtrees = CSS transform but risky on flow + export — limit to
specific elements. Unit conversions (§2b).

**Won't (don't take):** Konva engine, infinite free canvas, **free-drag-anywhere of
a flow element** (the one genuine gap — but slides are composed fixed frames, so
this mostly bites only non-absolute boxes), arrow/draw vector tools, their AI stack.

---

## 5. LOCKED decisions (user, 2026-06-05)

1. **Inspector = a tab inside the right rail.** Right rail is tabbed: **[Slides]**
   (our filmstrip + pills) and **[Layout]** (the property controls for the selected
   element/slide). User picks a slide on Slides, switches to Layout to edit.
2. **Command bar = bottom floating**, same as ai-canvas.
3. **AI triggers live in the bottom bar's AI mode only.** Clicking AI reveals ALL
   our AI actions: slide regen, region-select (comment) regen, element-scoped
   "change this with AI", image regen. Edit mode = manual tools only.
4. **Layers — KEPT, folded into the Layout tab** (reversed 2026-06-05 after an
   architecture review). A tree is the single most useful affordance for the
   hardest case — picking the right node in deeply nested flex/grid — and a
   breadcrumb lets you *walk* the tree but not *see* it (you can't tell where to
   stop climbing). So Layers lives as a compact list at the top of the **Layout
   tab** (no separate left panel → canvas stays wide); right-click ⋯ + breadcrumb +
   click-to-escalate (`Esc`/`↑`/alt-click) stay as **complements**, not replacements.
   - **Grouping — the Layers list is a PRUNED SEMANTIC tree, never the raw DOM**
     (this is what keeps it from being a confusing pile). Rules:
     - **Top level = the slide's composition blocks** — the direct children of
       `<section>` (title, stat row, chart, logo) — how a user thinks about a slide.
     - **Prune noise:** single-child wrapper `<div>`s are flattened (promote child);
       an `<svg>` is **one** "Graphic/Icon" entry, NEVER expanded into its paths;
       inline text spans collapse into their parent text block.
     - **Labels:** text snippet for text nodes; "Image"/"Logo"/"Chart"/"Icon" for
       graphics; role/class for containers. Default 1–2 levels deep, chevron for more.
     - Result: ~6–15 entries per slide, not 50 nodes.
     - **Presentation-only — we NEVER wrap the DOM.** HTML stays the single source
       of truth, so the round-trip stays clean. Multi-select (style/move several at
       once) works without wrapping; **persistent Figma-style groups = injecting a
       wrapper `<div>` = HTML mutation = NOT Phase 0.**
5. **`/project` is the editor** (final destination).
6. **Dark-locked.** No editor theme toggle. Light mode is reserved on the existing
   **header switcher**, kept **inactive** until we build light mode.

**Right-click context menu (the per-element hub):** Edit text · Duplicate · Delete ·
Hide/Show · Bring forward / to front / backward / to back · **Select parent** ·
🖼 Regenerate image · ✨ Change this with AI.

### Target layout
```text
┌──────────────────────────────────────────────────────────────┐
│  top:  deck title · Present · Share · Export ▾ · History       │
├────────────────────────────────────────────────┬─────────────┤
│            CENTER — slide canvas (WIDER)         │ RIGHT (tabs)│
│   select · handles · inline-text · right-click ⋯ │[Slides][Layout]
│   breadcrumb:  section › card › h2               │ Slides: film│
│                                                  │ Layout:      │
│                                                  │  Layers(tree)│
│                                                  │  +Text/Box/Im│
├──────────────────────────────────────────────────┴─────────────┤
│  COMMAND BAR (floating):  [ Edit ⇆ AI ]                         │
│   Edit:  select · T text · ▢ shape · 🖼 image · ↶ ↷             │
│   AI:    slide-regen · region-comment regen · "change this…" ·  │
│          regen-image                                            │
└──────────────────────────────────────────────────────────────┘
            theme: DARK locked  (light → header switcher, off)
```

### Fate of each existing element
- **Right `SlideNavSidebar`** → kept, becomes the **[Slides]** tab of a tabbed right rail; gains a sibling **[Layout]** tab (the Inspector).
- **Left `PreviewActionBar`** → its deck actions (export/share/present/history) move to a **top strip**; the editing tools move to the bottom command bar. The left edge is freed (Layers lives in the Layout tab, not a left panel) → wider canvas.
- **`SlidePill`** → kept; add an **"edited/unsaved"** state; respect **lock** (locked slide = read-only in editor).
- **`CommentsPanel`/`HeroCommentOverlay`** → the region-comment regen becomes one of the AI-mode triggers in the bottom bar (relocated, not retired).

### Feature → new home
| Our feature | Lands as |
|---|---|
| Region + comment → partial regen | AI-mode trigger (kept) + upgraded by element-select "change this" |
| Click-image-to-regen | Right-click `<img data-genid>` → Regenerate (+ edit prompt) → `deck.image.warm` |
| Line-spacing / restyle | Layout-tab controls, instant inline-style, no AI |
| Inline text fix | `contentEditable` on the DOM node |
| Slide/full regen, history, share, export, presence | top strip + filmstrip context menus; plumbing unchanged |

### Hard rules (architecture review, 2026-06-05) — non-negotiable

1. **The round-trip risk is ADDITIVE, not subtractive.** The danger isn't the
   serializer *stripping* RTL/`dir`/spans — it's `contentEditable` + `outerHTML`
   *adding/mutating* things we didn't ask for: stray `<div>`/`<br>`/`<span style>`,
   `&nbsp;`, injected bidi spans, attr-reorder drift, noisy version diffs. **A1 on
   clean HTML already passes byte-perfect (2026-06-05); the real gate is the
   EDIT round-trip — checklist A2/A3.** Fallback if contentEditable can't be tamed:
   a real text model (Lexical/ProseMirror) for **text nodes only**, DOM for layout.
   Decide it in `/lab`, never in Phase 2.
2. **Transforms are export-safe-ONLY.** If dom-to-pptx can't reproduce CSS
   rotate/scale, the editor does NOT expose them — preview MUST equal export.
   A7 decides empirically; until it passes, those controls don't ship.
3. **Inline-style now, class-editing is a real LATER phase (not never).** Phase 0
   is inline-only (keeps the round-trip clean). The accumulation problem is real, so
   (a) **consolidate** an element's repeated writes into ONE clean `style` on save
   (checklist A5 "no redundant accumulation"), and (b) "apply to all of type" =
   editing the shared scoped class — a deliberately-quarantined later phase where the
   CSSOM-serialization risk lives.
4. **Free-drag (absolute) vs nudge (flow) — set the expectation, don't hide it.**
   The editor feels less free than Canva for flow elements; that's inherent to
   DOM-native and fine under the "scalpel" framing.
5. **Grouping is presentation-only.** The Layers tree groups/prunes the DOM for
   display; it NEVER wraps elements in new `<div>`s. HTML stays the single source of
   truth.

---

## 6. Technical architecture (the DOM-edit engine — our Konva substitute)

- **Selection model:** `selectedEl: HTMLElement | null` (+ multi-select set). Click on
  canvas → select leaf; `Esc`/`↑`/alt-click → walk to `parentElement` (stop at the
  `<section>` root). Breadcrumb = ancestor chain. Hover → outline.
- **Overlay handles:** an absolutely-positioned overlay layer over the canvas drawing
  the selection outline + 8 resize handles + rotate handle, computed from the
  element's `getBoundingClientRect()` (relative to the canvas frame). On drag, write
  the result back as inline style. (No Konva Transformer.)
- **Inline-style writer:** `el.style.setProperty(prop, value)` for each control. This
  lands in computed style → preview + dom-to-pptx + Puppeteer all honor it. Prefer
  overriding the element inline (affects just that element); editing the shared
  scoped class is a later "apply to all of type" affordance.
- **contentEditable text:** set `contenteditable` on dbl-click; on blur, read
  `innerText`/`innerHTML`; keep RTL/BiDi intact (don't strip dir/spans).
- **Move:** absolute element → set `left/top` (or `transform: translate`); flow
  element → `transform: translate` nudge or margin; no free-drop for flow.
- **z-order:** reorder the element among its DOM siblings (or set `z-index`).
- **Serializer (critical):** on save, take the live `<section>` DOM →
  `outerHTML` → run through our sanitizer (the `SlideRenderer`/`sanitizeSlideHtml`
  path, or a server `sanitizeSlideHtmlServer`) → that string becomes the new
  `slide.html`. Must round-trip the scoped `<style>` + SVG + RTL untouched. **VALIDATE
  THIS IN THE PROTOTYPE** — it's the main feasibility unknown.
- **Undo/redo:** local snapshot stack of the slide HTML (prototype). Later, tie to
  versioning.
- **Unit conversions** when lifting controls: lineHeight px→unitless, opacity
  0–100→0–1, dash array→CSS keyword.
- **Export-safety invariants:** edits must (a) end up in computed style, (b) not break
  RTL (no stray `dir`/`text-align:start` regressions — see `LANG_DIRECTION`), (c)
  avoid the AVOID list (no conic-gradient/backdrop-filter/blur/mix-blend that
  dom-to-pptx drops), (d) keep the slide within its fixed frame.

---

## 7. AI wiring (reuse OUR pipeline — Phase 5)
- **Element-scoped "change this with AI":** send the selected element's `outerHTML`
  (or multi-selection set) + the instruction to a node-scoped variant of the
  **partial-regen** route (`deck-regenerate-partial.ts`), splice the returned HTML
  back into that node. Tighter target than the drawn rectangle.
- **Region-comment regen:** existing `HeroCommentOverlay` flow, surfaced as an AI-mode
  trigger.
- **Slide regen / full regen:** existing routes.
- **Images = gpt-image** (OpenAI — NOT Claude; Claude does structure/text, gpt-image
  does the raster). Wire it into the canvas TWO ways:
  - **Regenerate / replace** an existing `<img data-genid>` (right-click or the Image
    panel, with an editable prompt) → reuse `deck.image.warm` (gpt-image) →
    `slide.image.ready` broadcast → `injectImgSrc` swap.
  - **Add a NEW image** (the Edit-mode image tool): drop a box → it becomes a
    `data-genimage` / `data-genid` element → describe → triggers the SAME warm/fill
    pipeline → `injectImgSrc`. (Manual image-box creation is the only new part; the
    generate/fill pipeline is reused as-is.)
- Stream the result into the live preview; on accept, write a new version.

## 8. Persistence + realtime + lock (Phase 4)
- Manual edit → serialize → **save as a new `SlideVersion`** (so undo/history works,
  and the edit is a first-class version like a regen).
- Realtime: broadcast the change; receivers apply **in place** (no `router.refresh` —
  house rule; use the status route's fat-sync `?includeManifest&includeSlideStates`).
- **Lock:** a locked slide is read-only in the editor; pill reflects it.
- Roles: respect share roles (viewer/comment can't edit) — thread the existing role.

## 9. Theming
- Dark locked. Use our tokens only (`--tq-*`, Cairo, glass-popover, btn-pill,
  spring 500/35). NO new theme toggle. Reserve light mode on the **header** switcher
  (build later); keep inactive.

---

## 10. Phased build plan

- **Phase 0 — Static prototype** *(START HERE)*. See §11.
- **Phase 1 — Harvest + restyle controls.** Lift §2b controls into our codebase,
  strip Konva, point at a `selectedEl` abstraction, restyle to our tokens.
- **Phase 2 — DOM-edit engine.** §6: selection + breadcrumb/select-parent, overlay
  handles, inline-style writer, contentEditable, move/nudge, z-order, undo/redo,
  serializer-through-sanitizer.
- **Phase 3 — Port into `/project` (DeckView).** Tabbed right rail (Slides|Layout),
  drop left panel, bottom command bar, right-click menu, hero canvas = edit surface,
  `SlidePill` edited/unsaved state.
- **Phase 4 — Wire persistence.** SlideVersion save + realtime in-place sync + lock + roles.
- **Phase 5 — Wire AI.** §7 triggers in AI mode.
- **Phase 6 — Polish.** dark-lock + header light hook, optional auto-fit overflow
  assist, `/security-review`, tests, docs, PR.

## 11. Phase 0 — static prototype (detailed spec)

- **Route:** hidden dev-only page `app/(app)/lab/editor/page.tsx` →
  `localhost:3000/lab/editor?project=<id>` (NOT linked anywhere; gate to dev /
  curator account — mirror the marquee gating to `taqreermail@gmail.com` — so it
  never ships).
- **Loads a real deck:** fetch an existing project's manifest **read-only** via the
  status route (`?project=<id>` → `/api/projects/[id]/status?includeManifest=true`),
  render its slides with the existing `SlideRenderer`. Test on REAL RTL / flex / grid /
  SVG slides.
- **Implements (client-only, edits live in component state — NO backend writes):**
  - the full chrome: tabbed right rail (Slides|Layout), bottom command bar (Edit⇄AI),
    top strip, dark-locked tokens.
  - element selection + outline + 8 handles + rotate, breadcrumb + select-parent,
    right-click context menu.
  - `contentEditable` inline text edit.
  - the Layout-tab controls (harvested) writing live inline styles to the selected element.
  - local undo/redo; a "show serialized HTML" debug button to eyeball the round-trip.
- **Stubbed:** AI buttons show the flow but don't call the model; nothing persists.
- **Goal / exit criteria:** prove (1) DOM selection + inline edit + property controls
  **survive our real slide HTML** (scoped `<style>`, SVG, RTL all intact through a
  serialize round-trip), (2) the panels/tabs/command-bar **feel right**. Iterate on
  feel. Only then Phase 3+.

## 12. Open questions / risks to validate in Phase 0
- Does serialize→sanitize→re-render round-trip the scoped `<style>` + inline `<svg>`
  + RTL faithfully? (Main unknown.)
- Selecting the right element in deeply nested flex/grid (leaf vs container) — is
  breadcrumb + select-parent enough, or do we miss the Layers tree?
- Inline-style overrides vs editing the shared scoped class (when a drift comes from
  a class shared by many elements).
- Resize/move of flow elements — how much do we expose vs lock to absolute-only.
- Export parity: confirm an edited slide still exports identically to PPTX/PDF/PNG
  (dom-to-pptx reads computed styles; transforms/rotation may not survive PPTX).

## 13. House rules to respect (from memory)
- `dev` is the only branch; never `git checkout -b`. Commit only when asked; push only
  on request/milestone. Run `/security-review` after non-trivial changes (new routes,
  schema, prompt-pipeline). Reuse existing components (SaveAsTemplateDialog, dialogs,
  shared primitives) before building new. Never hardcode colors — `--tq-*` only. Latin
  numerals (0-9) only. Realtime = in-place updates, never `router.refresh`. Ask before
  edits that weren't explicitly requested; discuss before coding non-trivial work.

## 14. Pointers
- ai-canvas clone (temp): `/tmp/ai-canvas-study` (re-clone if gone).
- Our shell: `components/preview/{DeckView,SlideNavSidebar,SlidePill,CommentsPanel,HeroCommentOverlay,HistoryPopover}.tsx`, `components/slides/{PreviewActionBar,SlideRenderer}.tsx`.
- Slide build/render/export spine: `lib/deck/{scaffold,scope-css}.ts`, `lib/export/{theme-css-vars,html-document-server,html-export}.ts`, `patches/dom-to-pptx+1.1.8.patch`.
- AI reuse: `inngest/functions/{deck-regenerate-partial,deck-image-warm,deck-images-generate}.ts`, `app/api/projects/[id]/status/route.ts`, `lib/images/slide-images.ts` (`scanGenImages`/`injectImgSrc`).
- The generation flow it edits: `context/html-flow.md`.

## 15. Studio editing stage — full-screen canvas redesign (DEFERRED — build WITH the bottom command bar)

**Status: planned, not built. Build this together with the upcoming bottom toolbar
(the Edit⇄AI command bar from §11) — they're one redesign of the editing surface.**
User direction 2026-06-06. The earlier "toggle the app chrome on /project" attempt
was built (commit `b0ec791`) and **reverted** (`45a05bb`) — it fought the layout (the
slide-nav never reflowed into the freed gap; the floating toggle collided with header
buttons). The right model is a dedicated full-screen Studio, not a togglable chrome.

### The model
The dashboard is "browse"; the editor is its own focused world. Click a project →
full-bleed Studio (NO app header/sidebar) → a "← لوحة التحكم" pill returns you. No
chrome toggle.

### Chrome-less approach (keep the route + auth)
Do NOT move `/project` out of the `(app)` group (it'd re-do the auth gate). Instead
`DashboardShell` detects `pathname.startsWith("/project/")` and renders `{children}`
FULL-BLEED — no `<Header>`, no `<Sidebar>`, no margins/padding. The `/project` page
(DeckView) owns the whole viewport.

### Layout (all inside Taqreer's glass + `--tq-*` tokens — never fork)
```
 ⟵ لوحة التحكم        · · · dotted canvas · · ·        [حفظ][↗ مشاركة][⤓ تصدير]
   ┌─────────┐        ╔════════════════╗        ┌─────────┐
   │ الطبقات │        ║   the slide    ║        │ الشرائح │
   │ (Layers)│        ║ (zoom + pan)   ║        │ (Slides)│
   └─────────┘        ╚════════════════╝        └─────────┘
                   ┌────── bottom command bar (Edit ⇄ AI, §11) ──────┐
                   └──────────  + zoom controls: ⊟ 100% ⊞ ⤢ fit ─────┘
```
- **Dotted canvas:** low-opacity dot grid (radial-gradient, `--tq-*` dot color) over
  `--tq-bg` → "infinite surface" depth. Slide floats with a soft shadow.
- **Floating ROUNDED glass panels** (`glass-popover` recipe, margin from edges — NOT
  docked rails), entering on the 500/35 spring:
  - **RIGHT = Slides** — restyle `SlideNavSidebar` content as a floating card.
  - **LEFT = Layers** — NEW. `buildLayerTree(section)` already exists in
    `lib/editor/leaves.ts` (text/image/graphic rows, flat). Row click = select (→
    StylePill), hover = highlight on canvas.
- **Top-leading:** back-to-dashboard pill (→ `/dashboard`).
- **Top-trailing:** Save / Share / Export — document-level actions (reuse `PreviewActionBar`).
- **Bottom command bar (the toolbox lives HERE — NOT a top cluster):** modeled on the
  harvest source **ai-canvas (github.com/kyh/ai-canvas)** — a floating bottom toolbar
  carrying the editing tools + an **Edit ⇄ AI toggle** (this IS the §11 command bar).
  The current left icon-rail toolbox's actions move into THIS bottom bar (user
  correction 2026-06-06 — earlier note wrongly said "top cluster"). Zoom controls
  (⊟ % ⊞ ⤢ fit) sit alongside it.
- Left edge is then free for the **Layers** panel.

### Existing-pieces mapping
| Piece | In the Studio |
|---|---|
| DashboardShell chrome | suppressed on `/project` → full-bleed (keeps auth gate + route) |
| DeckView hero canvas | becomes the zoom/pan canvas; "fit to screen" computes initial zoom |
| SlideNavSidebar | floating RIGHT panel (restyle) |
| Layers | NEW left panel via `buildLayerTree()` |
| StylePill | unchanged behavior; coordinate math gains a zoom factor (see risk) |
| Save/Share/Export | floating top-trailing cluster (document actions) |
| Toolbox / editing tools + AI toggle | floating **BOTTOM** command bar (ai-canvas style) |

### Zoom + pan (the hard part — Phase 3 of the build)
Slide is in an IFRAME (`SlideEditor`), so wrap it in a transform layer
`transform: translate(panX,panY) scale(zoom)`. Controls: Ctrl/⌘+wheel or pinch =
zoom-around-cursor; plain wheel / space-drag / middle-drag = pan; fit-to-screen +
zoom-% pill. **RISK:** the StylePill maps in-iframe `.tqe-sel` coords → screen via the
iframe's `frameElement` rect; under the outer zoom it must factor the effective scale
(innerScale × zoom). Update its rAF mapping. Build + test this AFTER the shell.

### Build phases (when we do it)
1. **Studio shell** (visual): full-bleed `/project`, dotted bg, back pill, Slides
   floating right, NEW Layers panel left, floating top-trailing actions (incl. folded
   toolbox). Canvas stays fit-to-screen (no user zoom yet).
2. **Bottom command bar** (§11 Edit⇄AI) — the trigger for doing this redesign now.
3. **Zoom + pan** + StylePill zoom-aware coords + zoom controls.

### Aesthetic notes (frontend-design lens, but inside our system)
Dotted canvas for atmosphere/depth; slide as the lit focal object (soft shadow);
floating glass panels (not chrome) so the slide owns the space; staggered 500/35
spring entrance; Cairo + `--tq-*` only.

## 16. Command bar + Edit⇄AI mode system — LOCKED design (2026-06-06)

The editor's last big primitive. Restructures the Studio chrome around an
**Edit ⇄ AI** mode switch. UX locked with the user; build in 7 chunks below.

**Global rules (user, 2026-06-06):** NO zoom/pan (dropped — "serves nothing").
NO button gradients — the mode toggle's active state + Generate use neutral glass
(`--tq-bg-glass`), retiring the old "gradient AI pair" convention for these. The
side panels (Layers left, Slides-nav right) stay floating rounded glass cards,
DETACHED — the top header never docks them. Everything inside Cairo + `--tq-*` +
glass + spring 500/35; reuse `SegmentedToggle`, `glass-popover`, `btn-pill`.

**Harvest source:** kyh/ai-canvas `src/components/canvas/views/editor-bottom-toolbar.tsx`
(re-clone `git clone --depth 1 https://github.com/kyh/ai-canvas /tmp/ai-canvas-study`,
read-only, NEVER install/run). Its shape: a floating pill where **mode tabs sit at
one end** and the **active mode's content fills the rest** — AI tab = auto-grow
textarea + send; Design tab = a row of ghost icon buttons + dividers + Export ▾.
We mirror that shape in our `backdrop-blur-glass` + glass border/shadow.

### Where everything lives (user-decided split)
- **Top header (NEW, full-width, detached):** project title/back on the leading
  (right) edge; on the trailing (left) edge **Export ▾** (popover) + **Share**.
  These two ONLY. The 4 export buttons collapse into one Export button → a
  `glass-popover` menu (PPTX / PDF / PNG / HTML) via `useExportActions`.
- **Bottom pill (the composer):** `[ Edit ⇄ AI toggle ]` · mode content · ‖ ·
  shared `[ History · Lock · Save ]` cluster. (History/Lock absorbed from the
  deleted canvas SlidePill; Save stays; Export+Share left for the header.)
  - **Edit mode content:** `[ 💬 Comment ]` (user feedback). Element editing is
    on-canvas via StylePill — no bar tools needed.
  - **AI mode content:** `[ ◰ تحديد منطقة ] [ ▭ auto-grow input: اكتب تعليمات للذكاء… ▭ ]
    [ ➤ توليد ] [ ↻ أعد تصميم الكل ]`.

### Mode model
- **editMode** stays (canEdit). NEW **studioMode: "edit" | "ai"** (the toggle).
  commentMode becomes a sub-state of EDIT only.
- **Edit:** manual scalpel + USER comments (threaded, persist, NEVER regen).
  Canvas: select→StylePill, Layers panel.
- **AI:** generative. Always-visible instruction input. Canvas: draw a region for
  partial regen. (Layers-panel-in-AI behaviour = PARKED decision — decide at Chunk 5.)

### The two comment concepts (SEPARATED — the core change)
- **User comment (Edit):** drop a feedback pin/note. Persists, shows in the nav's
  Comments tab. Decoupled from regen entirely (kills today's "comment = implicit
  regen directive" coupling).
- **AI directive (AI):** EPHEMERAL one-shot (user-chosen). Draw a region (optional)
  + type instruction → Generate → fires partial regen of that region + clears.
  Nothing stored. Empty input + no region + Generate = clean focused-slide regen.
  `أعد تصميم الكل` = whole-deck regen, a VISIBLE button beside Generate (user-chosen).

### Slide-nav: Slides | Comments tab (keep thumbnails as-is, add a header)
Stop CommentsPanel REPLACING the nav. Add a header to SlideNavSidebar: an optional
project/presence row + a `[ الشرائح | التعليقات ]` tab strip (Slides leading/right).
Slides tab = today's grid (unchanged). Comments tab = today's CommentsPanel body
(feedback-only). Entering Edit-comment mode auto-selects Comments. Width stays 280.

### Build order (7 chunks, smallest-risk → most-coupled)
1. **Top header** — new component; Export popover (4→1) + Share moved up, both
   pulled out of PreviewActionBar.
2. **Bottom pill restructure** — Edit⇄AI `SegmentedToggle`; mode content vs shared
   `[History·Lock·Save]`; absorb History+Lock from SlidePill; DELETE the canvas pill.
3. **Slides | Comments tab** on the nav (stop the full swap).
4. **Decouple user comments from regen** (feedback-only).
5. **AI composer** — always-visible input + draw-region + Generate + deck-regen.
6. **Backend** — thread free-text instruction into single-slide regen; ephemeral
   region+instruction partial-regen (reuse `deck-regenerate-partial.ts`).
7. **Polish** + the parked Layers-in-AI decision + `/security-review`.

### Key files
`components/slides/PreviewActionBar.tsx` (the bottom bar — restructure), NEW
`StudioHeader` + `ExportMenu`, `components/preview/{DeckView,SlidePill,CommentsPanel,
SlideNavSidebar,HeroCommentOverlay}.tsx`, `lib/preview/use-export-actions.ts`.

## 17. Bottom-toolbar AI input — execution spec (2026-06-07, fresh-session ready)

Replaces the in-box AI composer (the `.ai-comment-box` mesh box + textarea popup)
with a **persistent AI input in the bottom bar**. User decisions (locked):
- **Scope by dragging on the canvas** — in AI mode, click-drag on the slide draws
  the region box. No "select region" button.
- **Marker = an AI icon (auto_awesome sparkle) at a CORNER of the drawn box** — not
  the mesh box, not a quiet frame. A small sparkle chip pinned to one corner.
- **No box drawn → whole-slide** regen (boundsJson = null). Same pipeline.

### Grounded wiring (verified 2026-06-07 — do NOT re-guess)
- Text already becomes a `forAi` comment. `HeroCommentOverlay` `onCreate({slideId,
  bounds, content})` → DeckView (~line 2464) `POST /api/projects/{id}/comments`
  with `{ boundsJson: input.bounds, content, forAi: studioMode === "ai" }`; result
  pushed to `setComments`.
- `handleFirePartialRegen` (passed as `onApply` to HeroCommentOverlay) fires the
  partial regen; `deck-regenerate-partial.ts` reads the `forAi` comments + their
  `boundsJson`. Completion path clears AI comments: `setComments(prev =>
  prev.filter(c => !c.forAi))` (~2336).
- Draw bounds currently live in HeroCommentOverlay's local `editor` state (slide-
  space 0..canvasW × 0..canvasH).
- `studioMode` ("edit"|"ai") + `commentMode` live in DeckView (~612-615). In AI
  mode the bottom bar shows a slide-regen button (PreviewActionBar).

### Chunks (smallest-risk → most-coupled)
1. **Lift draw bounds.** HeroCommentOverlay: in AI mode, finishing a drag reports
   `onAiBoundsChange(bounds | null)` up instead of opening the inline textarea.
   The corner-sparkle marker renders on the box; NO inline composer. DeckView holds
   `pendingAiBounds`. Drag-on-canvas is always armed in AI mode (no commentMode gate).
2. **Toolbar AI input** (PreviewActionBar, AI-mode cluster). Glass capsule
   (`glass-popover` recipe, RTL): leading **scope chip** — `pendingAiBounds ?
   "هذه المنطقة" (✕ clears it) : "الشريحة كاملة"` (muted) — · `auto_awesome`
   sparkle (brand-gradient fill) · growing single-line input (placeholder
   "اكتب تغييراتك للذكاء…") · trailing send = `.btn-gradient-anim` circular button.
   Enter or send → DeckView `onAiSubmit(text)`: build `forAi` comment
   `{content: text, boundsJson: pendingAiBounds ?? null}` via the EXISTING /comments
   POST → fire `handleFirePartialRegen` → clear input + pendingAiBounds. The mesh
   gradient lives ONLY here (the one AI hero), per the frontend consult.
3. **Remove old composer + box.** HeroCommentOverlay: delete the AI `CommentEditor`
   (textarea + chips + in-box apply button) and the full `.ai-comment-box` marker
   path; replace with the corner-sparkle marker. globals.css: remove `.ai-comment-box`
   (mesh box + radial scrim) — now unused. Keep the orange USER-comment box untouched.

### States (frontend lens, inside the system)
idle (AI mode, no box): input focused, chip = "الشريحة كاملة". drawing: box grows
with the corner sparkle. submitting: input → compact "يُطبّق…" with the mesh ring
spinning; box sparkle pulses. done: clears (handleFirePartialRegen completion path).

### Key files + anchors
`components/preview/HeroCommentOverlay.tsx` (drop AI composer, add corner-sparkle
marker, `onAiBoundsChange`), `components/slides/PreviewActionBar.tsx` (AI input +
scope chip), `components/preview/DeckView.tsx` (`pendingAiBounds` state, `onAiSubmit`,
wire HeroCommentOverlay + PreviewActionBar; reuse the ~2464 /comments POST +
`handleFirePartialRegen`), `app/globals.css` (remove `.ai-comment-box`). Latin
numerals only; spring 500/35; `--tq-*` tokens only. Run `/security-review` after
(touches a comment-creation path). RTL throughout.

### §17 follow-ups (post-merge cleanups — not blockers, 2026-06-07)
UX papercuts surfaced during the /simplify + review pass:
- **Stale AI input on slide nav.** `aiInput` text lives in PreviewActionBar and is
  NOT cleared when the focused slide changes (DeckView only clears `pendingAiBounds`).
  Navigate away mid-type → stale text persists + region is gone. Fix: clear `aiInput`
  on `currentSlideIndex` change — lift it into DeckView beside `pendingAiBounds`, or
  pass a `resetKey={currentSlideIndex}` prop that clears it internally.
- **Whole-slide AI comment has no on-slide marker.** `if (!c.boundsJson) return null`
  in HeroCommentOverlay drops null-bounds (whole-slide) AI comments → no visual marker;
  the regen overlay is the only feedback. Decide: render a full-slide badge, or confirm
  the overlay is enough (whole-slide legitimately has no region to point at).

Deferred quality cleanups (from /simplify, safe but behavior-touching — do with care):
- Send button + sending spinner: reuse `ToolButton` (gradient/running props) instead of
  the hand-rolled `btn-gradient-anim` markup in PreviewActionBar.
- Extract the AI composer (input + chip + send) into an `AiComposer` component to slim
  the ~750-line PreviewActionBar.
- `.ai-marker-chip .material-symbols-outlined` 17px override → reuse the `.tq-icon-sm`
  utility pattern (add `.tq-icon-md` if 17px is a new common size).

## 18. Unify the generation-phase (preview) shell with the editor shell (2026-06-07, fresh-session ready)

Right now the COMPLETED deck (`/project/[id]`) has the new Studio shell (StudioHeader
top bar + Edit⇄AI bottom command bar + floating Layers/Slides panels + dotted canvas),
but the GENERATION phase (`/preview/[id]` — the "Claude is working" / streaming view)
still renders the OLD chrome. Goal: the generating state renders inside the SAME shell,
with the streaming slides filling the canvas as they arrive. NOT a new page — a
render-branch unification inside DeckView.

### Verified architecture (do NOT re-derive)
- `/preview/[projectId]` = GENERATION-PHASE route; `/project/[projectId]` = COMPLETED route.
  Lifecycle pair with inverse SSR redirects (`isDeckReady` → /project; not-ready → /preview).
  Client: DeckView `router.replace("/project/<id>")` fires on stream-complete.
- The two page files are NEAR-IDENTICAL (`diff` shows only the redirect direction +
  comments differ): both render the SAME `<DeckView>` with the same role props
  (`resolveProjectAccess(id, "view")` → role; `loadProject`; presence profile;
  `deckKey = versionId:status:hasManifest`; `initialMainSidebarWidth` from the sidebar
  cookie). So the page layer needs NO change — the divergence is inside DeckView.
- `components/preview/DeckView.tsx` (~3500 lines) derives `status`
  ("generating"|"completed"|"failed"|"cancelled", ~line 1647) and `editMode = canEdit`
  (role owner/edit). `<StudioHeader>` renders at ~line 3479; `<PreviewActionBar>` is the
  bottom command bar. Streaming slides live in `streamingPreview` state.

### STEP 1 (confirm before editing — the one unknown)
Locate DeckView's generating-vs-completed render branch: grep the RETURN/JSX region
(lines ~3000+) for `status === "generating"`, `streamingPreview`, and any early returns.
Determine whether the StudioHeader shell (3479) wraps BOTH states or only the completed
one — that tells you whether to hoist the shell or just feed the generating content into it.

### Approach (once the branch is found)
- Hoist the shell (StudioHeader + canvas/slide-nav framing) so it wraps BOTH states.
- GENERATING state inside the shell: streaming-preview slides fill the canvas (reuse
  `streamingPreview`); NO Edit⇄AI toggle / editing controls; the bottom bar shows
  generation progress + Cancel (reuse the existing progress + CancelGenerationDialog),
  not the editor controls. Header = back + (maybe) a "generating…" affordance.
- COMPLETED state: unchanged (current editor shell).
- Keep role/editMode gating — viewers never see edit controls.

### Guardrails
Reuse StudioHeader / PreviewActionBar / SlideNavSidebar — never fork. `--tq-*` tokens,
Cairo, RTL, Latin numerals (0-9), glass primitives, spring 500/35. Likely UI-only →
tsc + eslint clean; security review skippable. Verify live: a generating deck shows the
new shell with slides streaming in, and completion still `router.replace`s to /project.

### Key files
`components/preview/DeckView.tsx` (the render branch — the whole change), `StudioHeader.tsx`,
`components/slides/PreviewActionBar.tsx`, `components/preview/SlideNavSidebar.tsx`,
`components/preview/CancelGenerationDialog.tsx`. The two page files
(`app/(app)/{project,preview}/[projectId]/page.tsx`) likely need NO change.

## 19. Regenerate an AI image from the editor pill (2026-06-07, fresh-session ready)

Add a "regenerate" action to the image pill: user selects an AI image → pill shows
Regenerate (next to Replace) → opens a prompt editor pre-filled with the box's prompt
→ edits it → confirm → the image re-generates in place. User decisions (locked):
**editable prompt** (not one-click), and reuse the existing `deck.image.warm` pipeline.

### Why editable-prompt simplifies the hard part (READ THIS FIRST)
The image identity is `genid + hash`, `hash = genImageHash(prompt) = sha256(prompt)[:12]`
(lib/images/store.ts:33), path `${projectId}/gen/${genid}-${hash}.png`. The pipeline is
bill-once: `deck.image.warm` dedups per (projectId, genid, promptHash) for 24h + skips if
the file already exists. Because the user EDITS the prompt, the new prompt → a NEW hash →
a NEW path → the warm function generates fresh there with NO dedup collision and NO
existence collision. So we do NOT need to force past the dedup or invent a rev/nonce for
v1. (Same-prompt-no-edit just re-shows the current image — acceptable; a `data-genrev`
salt for "regenerate with the identical prompt" is a future add, noted at the end.)

### Verified surface (Explore map, do NOT re-derive)
- **Pill:** `components/preview/editor/StylePill.tsx` — image block ~lines 654-676, the
  existing "Replace" button. `kindOf(target)` (~39-43) = IMG. `target` is the selected
  `HTMLElement` (passed from DeckView ~3875). The `<img>` carries `data-genid` (box id),
  `data-genimage` (the PROMPT), `data-tq-cc="1"`. Replace handler `onPickImage` (~442-469):
  upload → POST /api/storage/upload-image → `setAttribute("src",url)` → `dirty.current=true`
  → commit-on-deselect (`onCommit` ~368-376 serializes the slide HTML).
- **Pipeline:** `deck.image.warm` (inngest/functions/deck-image-warm.ts) generates ONE box.
  Payload `{ projectId, slideKey, box{genid, prompt, aspect, hash}, idemKey }` (~68-73).
  Emits `slide.image.ready` broadcast (~84). Client: DeckView listens → GenImageFills
  context (genid→url) → SlideRenderer injects src before sanitise. `scanGenImages`/
  `injectImgSrc` in lib/images/slide-images.ts; hash/path in lib/images/store.ts.
- **Persistence model (KEY):** the slide HTML stores `data-genimage` (prompt) + `data-genid`;
  the src is DERIVED from (genid, hash(prompt)) at render. So persisting a regen = updating
  `data-genimage` to the new prompt (a slide edit, committed like Replace) — the derived
  path then resolves to the freshly-generated image.
- **No single-image regen route exists** — must build one.

### Build chunks
1. **Regen API route** — `POST /api/projects/[id]/slides/[slideKey]/images/[genid]/regen`,
   body `{ prompt: string, aspect?: GenImageAspect }`. Gate `resolveProjectAccess(id,"edit")`
   (owner/edit only). Validate prompt (non-empty, max len). Fire `deck.image.warm` for the
   one box: `{ projectId, slideKey, box: { genid, prompt, aspect, hash: genImageHash(prompt) },
   idemKey: \`regen:${genid}:${hash}\` }`. Return 202. (Aspect: pass from client — read the
   img's intrinsic/declared aspect — or default "landscape".)
2. **Pill UI** (StylePill image block) — add a "إعادة توليد" (Regenerate) button next to
   Replace, rendered ONLY when `data-genid && data-genimage` are present (an AI image, not an
   uploaded/replaced one). Clicking opens a small **glass-popover prompt editor** (reuse the
   glass-popover recipe): RTL textarea pre-filled with `data-genimage`, a confirm button
   (disabled while empty), Esc/click-out cancels. Latin numerals; Cairo; --tq-* tokens.
3. **Client wiring** (StylePill + DeckView/gen-image-context) — on confirm:
   (a) `target.setAttribute("data-genimage", newPrompt)` + `dirty.current=true` (persists on
   deselect, like Replace); (b) mark a PENDING state for that genid so the image shows the
   same loading shimmer the streaming fill uses (reuse GenImageFills' pending path); (c) POST
   the regen route. On the `slide.image.ready` broadcast for that genid → GenImageFills swaps
   the new URL in live → clear pending. (If the user navigates away before it lands, the
   committed `data-genimage` means a reload derives the new path anyway.)
4. **Loading affordance** — spinner/overlay on the regenerating image (reuse the gen-image
   placeholder UI). Optional: a tiny "1 image credit" cue on the confirm, since each regen is
   a paid gpt-image call.

### Guardrails
- **Billing:** each confirmed regen = ONE paid image generation (new prompt → new path). The
  confirm step makes it explicit. Same prompt re-confirmed = deduped (bill-once) — fine.
- Access: owner/edit only (route gate + hide the button for view/comment roles).
- Idempotency: idemKey `regen:${genid}:${promptHash}` so a double-click on the same new
  prompt fires once.
- **Orphaned images:** the previous-prompt PNG stays in storage (a different hash/path). Not
  cleaned up here — note a future GC sweep (orphaned `${projectId}/gen/*` not referenced by
  any current slide's `data-genimage`).
- Reuse glass-popover, StylePill patterns, the gen-image loading UI — never fork. RTL, Cairo,
  Latin numerals, --tq-* only, spring 500/35. Run tsc + eslint + **/security-review** (new
  API route + a write path).

### Future (not v1)
"Regenerate with the IDENTICAL prompt for a different result" → add a `data-genrev` salt to
the hash (`genImageHash(prompt, rev)`), bump rev per regen, persist `data-genrev` on the img.
Touches store.ts + slide-images.ts + the warm/generate read sites. Deferred.

### Key files
NEW `app/api/projects/[id]/slides/[slideKey]/images/[genid]/regen/route.ts`;
`components/preview/editor/StylePill.tsx` (button + prompt-editor popover + wiring);
`components/slides/gen-image-context.tsx` + `components/preview/DeckView.tsx` (pending state +
broadcast swap — mostly reuse); `inngest/functions/deck-image-warm.ts` (fire standalone — it's
already per-box); `lib/images/store.ts` (genImageHash — reuse); `lib/images/slide-images.ts`
(scanGenImages — src derivation, unchanged).

## 20. Multi-select + multi-element editing in the studio editor (2026-06-07, fresh-session ready)

Goal: drag a marquee on the editor canvas to select MULTIPLE elements; if every
selected element is TEXT, show ONE StylePill that edits them all at once.

### Verified surface (do NOT re-derive)
- Selection is SINGLE today: `SlideEditor` (the srcdoc iframe, components/preview/
  editor/SlideEditor.tsx) takes `selected: HTMLElement | null` + `onSelect(el|null)`
  (~32-33). Selectable units = `[data-tq-cc="1"]` leaves (stamped by `isVisualLeaf`,
  ~229). Click handler (~374): click a unit → `onSelect(unit)`; click an
  already-selected TEXT leaf again → contenteditable edit. Selection overlay = a
  `.tqe-sel` box drawn INSIDE the iframe (repositioned on the controlled `selected`,
  ~422). Hover via `mousemove` (~392), select via `click` (~394).
- DeckView holds `editorSelected` and renders `<StylePill target={editorSelected}>`
  (~3417 / ~3797).
- StylePill (components/preview/editor/StylePill.tsx): `target: HTMLElement` (~29),
  `kindOf(target)` → Kind (~50, IMG→"image" / text leaf→"text"), edits live
  (setAttribute/style) + `dirty.current` + `onCommit(slideId, html)` serializes the
  slide ON DESELECT (~16). Positions over `.tqe-sel` / target rect.

### Build chunks
1. **Marquee in SlideEditor.** On `mousedown` over EMPTY canvas (target not inside a
   `[data-tq-cc]` — the slide bg), start a rubber-band: track a rect mousedown→
   mousemove, draw a `.tqe-marquee` box in the iframe; on `mouseup`, select every
   `[data-tq-cc]` whose rect intersects the marquee. A mousedown that doesn't pass a
   small drag threshold falls through to the EXISTING single-click path (don't break
   it). Optional: shift-click to add/remove from the set.
2. **Multi-selection state.** `onSelect(el|null)` → `onSelect(els: HTMLElement[])`
   (single-click = `[el]`, marquee = `[..]`, bg/Esc = `[]`). DeckView
   `editorSelected: HTMLElement[]`. Draw one `.tqe-sel` box PER selected element.
   Keep all single-select behavior when `length === 1` (incl. click-again-to-edit a
   lone text leaf).
3. **StylePill → multi.** `target` → `targets: HTMLElement[]`. GATE: render the pill
   only when `targets.length >= 1 && targets.every(t => kindOf(t) === "text")` (the
   "all text" rule); a mixed / non-text multi-selection shows NO pill (or a disabled
   hint). Controls (font, size, weight, italic, color, align): DISPLAY the first
   target's value, show a "mixed" indicator when targets differ, and APPLY to ALL
   (loop the existing per-element mutation), set `dirty`, and on deselect serialize +
   `onCommit` every slide whose elements changed. Position the pill over the UNION
   bounding box of the targets.
4. **Edges.** contenteditable text-edit only when exactly ONE text leaf is selected.
   Esc / bg-click clears the set. Locked slide / non-edit role → no marquee. Marquee
   must not start on the pill or chrome.

### Guardrails
Extend the existing selection-overlay + StylePill machinery — don't fork. The
serialize/commit path already exists; just loop it over the changed targets +
dedupe by slide. Design system, RTL, Latin numerals, spring 500/35. tsc + eslint;
UI-only → security skippable. Live-verify: marquee-select 3 text blocks → one pill →
change size → all 3 update → deselect → reload → persists; a mixed selection shows
no pill.

### Key files
`components/preview/editor/SlideEditor.tsx` (marquee + multi `onSelect` + per-element
overlay), `components/preview/DeckView.tsx` (`editorSelected` → array, thread to
StylePill), `components/preview/editor/StylePill.tsx` (`targets[]` + all-text gate +
apply-to-all + union positioning + multi-slide commit).
