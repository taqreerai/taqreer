# Plan — In-canvas slide editor (DOM-native, ai-canvas-inspired UX)

Status: **PLANNED / not started.** Last updated 2026-06-05.
Owner context: this is the "manual scalpel" editor — direct WYSIWYG editing of a
slide's HTML, sitting alongside the existing AI regen paths. Written in full
detail because context is limited; everything needed to resume is here.

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
- `views/editor-left-side.tsx`: **Layers** list (z-order; per-item: type icon, inline label, click-select, hover-highlight, dimmed-when-hidden; ⋯ = Rename/Duplicate/Delete/Hide-Show/Bring forward/to-front/backward/to-back). Footer: GitHub, theme toggle, settings. **(We DROP this — see §5.)**
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
4. **Layers panel = DROPPED** (was going to be left, same as theirs). Reason: for a
   slide (≤~30 visible elements) the panel is mostly its ⋯ menu. Move the ⋯ actions
   to a **right-click context menu** on the canvas element → more canvas width.
   - The ONE thing a tree did that right-click can't = **select an element you can't
     click** (occluded, or the **parent container** of a clicked leaf — common in
     nested flex/grid HTML). Cover it cheaply with: **(a)** click-to-escalate /
     "select parent" (`Esc`/`↑`/alt-click walks up the DOM), **(b)** a one-line
     **selection breadcrumb** (`section › card › h2`, click a crumb to select that
     ancestor), **(c)** a "Select parent" entry in the right-click menu.
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
│                                                  │ Layout:Text/│
│                                                  │  Box/Image  │
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
- **Left `PreviewActionBar`** → its deck actions (export/share/present/history) move to a **top strip**; the editing tools move to the bottom command bar. The left edge is freed (no Layers panel) → wider canvas.
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
