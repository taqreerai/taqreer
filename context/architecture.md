# Taqreer — App Architecture & Design-System Map

> Written 2026-06-08 as a reference before reshaping the dashboard. Covers the design
> system, dashboard chrome, reusable components, user flows, and the backend.
> **Line numbers are approximate** (from a code sweep) — grep the symbol, don't trust the `:NN`.
> The design system + glass + editor + generation sections were verified firsthand.

## Contents
1. [Stack & top-level layout](#1-stack--top-level-layout)
2. [Route tree](#2-route-tree)
3. [Dashboard shell & layout chrome](#3-dashboard-shell--layout-chrome)  ← most relevant for a restyle
4. [Design system](#4-design-system)  ← tokens, glass, type, utilities, rules
5. [Reusable component inventory](#5-reusable-component-inventory)  ← reuse, don't rebuild
6. [User flows](#6-user-flows)
7. [Backend & data](#7-backend--data)
8. [Conventions & gotchas](#8-conventions--gotchas)

---

## 1. Stack & top-level layout

- **Next.js 16 App Router** (Turbopack), React 18/19, TypeScript `strict`.
- **Tailwind v4, CSS-first** — no `tailwind.config`; theme lives in `@theme`/`@theme inline` blocks inside [app/globals.css](app/globals.css). Lightning CSS minifier (has quirks — see §8).
- **Arabic-first / RTL** — `<html dir="rtl">`, Cairo font. RTL/BiDi quality is the product differentiator.
- **Data**: Prisma → local Postgres (docker-compose, `localhost:5432`). **Supabase** = auth + storage + realtime only (NOT the app DB).
- **Generation**: Anthropic Claude (Opus 4.8 default) streams HTML slides via **Inngest** background jobs; gpt-image-2 for generated images.
- **Root**: [app/layout.tsx](app/layout.tsx) — fonts (Cairo + Poppins), RTL, Material Symbols, `GlassPreflight` (reads glass preset from localStorage onto `<html>`).
- Three route groups: `app/(marketing)` implicit at `/` ([app/page.tsx](app/page.tsx)), `app/(auth)`, `app/(app)`.

---

## 2. Route tree

### `/` — landing ([app/page.tsx](app/page.tsx))
Hero, features, pricing, templates marquee, trust logos. Public.

### `app/(auth)/*` — glass-modal layout over a marquee wall ([app/(auth)/layout.tsx](app/(auth)/layout.tsx))
`/login`, `/signup`, `/forgot-password`, `/reset-password`. The auth modal = `auth-modal glass-modal backdrop-blur-glass-boost` (kept on the heavy 7× frost — see §4 glass).

### `app/(app)/*` — protected; wrapped by `DashboardShell` ([app/(app)/layout.tsx](app/(app)/layout.tsx))
Auth-gated SSR (redirects to `/login?next=`). Reads `tq_sidebar_collapsed` cookie for no-flash sidebar.

| Route | File | Purpose | Shell mode |
|---|---|---|---|
| `/dashboard` | dashboard/page.tsx | Home: QuickActions, Recent Projects, Activity, Templates, Plan | standard |
| `/projects` | projects/page.tsx | All projects, client filter+paginate | standard |
| `/favorites` | favorites/page.tsx | Starred projects | standard |
| `/templates` | templates/page.tsx | Own + community templates | standard |
| `/library` | library/page.tsx | Uploaded images | standard |
| `/brand-kits`, `/brand-kits/new` | brand-kits/* | Saved brand identities | standard |
| `/settings` | settings/page.tsx | Profile, plan, **glass preset picker**, delete account | standard |
| `/create` | create/page.tsx | Scratch: text/file + brand + output | flow (centered 1280) |
| `/enhance` | enhance/page.tsx | Redesign an existing deck (PDF/PPTX upload) | flow |
| `/mimic` | mimic/page.tsx | Reproduce a design reference (`MimicFlow`) | flow |
| `/datasheet` | datasheet/page.tsx | Data (xlsx/csv) → deck | flow |
| `/use-template/[id]` | use-template/[id]/page.tsx | Template → `MimicFlow` in template mode | flow |
| `/project/[projectId]` | project/[projectId]/page.tsx | **Unified studio** — generation AND editing (DeckView) | studio (chrome-less) |
| `/preview/[projectId]` | preview/[projectId]/page.tsx | **Back-compat redirect → /project** | — |

Studio was unified to one URL (`/project`) 2026-06-07 — DeckView renders both the generating shell (disabled) and the editor (enabled) in the same tree; no remount on completion.

---

## 3. Dashboard shell & layout chrome

The piece most relevant to a restyle. RTL: **sidebar on the right**, content pushed left.

### [components/app/DashboardShell.tsx](components/app/DashboardShell.tsx)
Client shell wrapping Header + Sidebar + `<main>` + children. Owns sidebar collapse state (localStorage `taqreer_sidebar_collapsed` + cookie `tq_sidebar_collapsed` + a cross-tab CustomEvent). Route-aware content padding:
- **studio** (`/project`, `/preview`): no chrome — renders `<div class="studio-canvas">{children}</div>`; DeckView paints its own StudioHeader + floating panels.
- **flow** (`/create`,`/enhance`,`/mimic`,`/datasheet`,`/use-template`): `mx-auto max-w-[1280px] pt-28 px-8 pb-8 space-y-16`.
- **default** (dashboard pages): `pt-28 px-8 pb-8 space-y-16`, edge-to-edge.

### [components/app/Header.tsx](components/app/Header.tsx) — fixed, h-20 (80px), `.header-bg` (border-bottom + blur, no fill)
RTL clusters: **right** = sidebar toggle + theme/lang placeholders; **center** = `HeaderSearch` (debounced cross-project search); **left** = `ServerStatusChip` + `BellDropdown` (notifications) + "مشروع جديد" gradient button (opens `NewProjectDialog`).

### [components/app/Sidebar.tsx](components/app/Sidebar.tsx) — fixed right, **80px collapsed / 260px expanded**, `.sidebar-bg`
Logo → Home → divider → 4 create actions (`/create` إنشاء, `/enhance` تحسين, `/mimic` محاكاة, `/datasheet` من بيانات) → divider → 6 nav links (`/projects`, `/templates`, `/library`, `/brand-kits`, `/favorites`, `/settings`) → usage bar → profile (dropdown portal). Nav pills: `.nav-item` / `.nav-active`. Animated icons (`AnimatedIcon`, hover-driven). Collapsed shows tooltips.

### Dashboard home ([app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx)) — `.page-container` (rtl), `space-y-16`
`QuickActions` (4 glass cards) → 3-col widget pair (`RecentGenerationWidget` 2-col + `RecentActivityWidget` 1-col) → `MyTemplates` → `PlanUsage`. SSR `force-dynamic`.

### Layout constants
| | value |
|---|---|
| Sidebar | 80 / 260 px |
| Header | 80px (h-20) |
| Flow content max | 1280px |
| Page padding | `pt-28 px-8 pb-8` |
| Section gap | `space-y-16` (64px) |
| Sidebar transition | 300ms ease-in-out |

### Z-index ladder
`0` dashboard-bg glow · `1` main · `40` Header · `50` Sidebar · `1100` action popovers · `1000/1001` dashboard modals · `1200/1201` brand/new-project modals · `2000/2001` template lightbox · `9999` profile dropdown.

### Backgrounds
`.dashboard-bg::before` = fixed violet radial glow (`top:145%`, blur 80px). `.studio-canvas` = dotted grid + radial vignette + the same glow.

---

## 4. Design system

**Single source of truth = [app/globals.css](app/globals.css).** Header comment block is a numbered legend of the whole system. Rule (stated there): never invent hex/radius/bg in TSX — compose tokens, or add a class to globals.css first.

### Tokens (`:root`)
**Brand**: `--tq-blue #370BF4` · `--tq-magenta #E036B8` · `--tq-magenta-hot #F900FF` · `--tq-violet #7D2DFF` · `--tq-lavender #9326C9` (+ `-rgb` variants).
**Surface**: `--tq-bg #0E0E18` · `--tq-bg-dim rgba(12,12,12,.55)` · `--tq-bg-strong rgba(14,14,24,.92)` · `--tq-bg-glass rgba(255,255,255,var(--glass-opacity))` (faint white, inline cards) · `--tq-modal-dim` (oklab 45% black).
**Text**: `--tq-text-primary #fff` · `--tq-text-muted #b4b4b4`.
**Border**: `--tq-border-glass` · `--tq-border rgba(40,40,40,.8)` · `--tq-border-focus #ffffff42` (neutral, not brand) · `--tq-avatar-ring`.
**Status triads** (ok/warn/down): `--tq-status-*-{dot,text,bg,border}`.
**Gradients**: `--tq-gradient-brand` (blue→violet 135°, CTAs+progress) · `--tq-gradient-full` (3-stop) · `--tq-gradient-avatar`.
**Radius**: `--tq-radius-md 12px`.
**@theme inline** (Tailwind utilities): `--color-{background,surface,surface-container-*,primary,…}` (Material-style dashboard palette), `--font-sans: "Cairo"…`, gradient bg-images.

### Glass system (runtime-tunable; the big one)
Four `--glass-*` vars drive every glass surface; the Settings page swaps a preset (off/subtle/normal/strong) live via `GlassPreflight`. Defaults (**normal**): `--glass-opacity .04` · `--glass-blur 8px` · `--glass-border-opacity .09` · `--glass-saturation 130%` · plus `--glass-hover-{opacity,border}-add`.

- **`--glass-fill: #00000073`** (≈45% black) — the **dark fill for FLOATING glass** (popovers + modals), added 2026-06-08. Inline cards stay faint-white.
- **Surface classes**: `.glass-card` (white-tint, inline cards) · `.glass-card-danger` (red border) · `.glass-dropdown` (white-tint, portal menus) · **`.glass-modal`** + **`.glass-popover`** (dark `--glass-fill`) · `.in-slide-popover` (dark, comment editor/preview over slides) · `.qa-card` (animated mesh border).
- **Blur is applied via Tailwind utilities, NOT bare `backdrop-filter`** (Lightning CSS strips bare `backdrop-filter` from plain rules). Two utilities:
  - `backdrop-blur-glass` = `calc(--glass-blur * 2.5)` = **20px** (standard glass: header, panels, cards).
  - `backdrop-blur-glass-boost` = `calc(--glass-blur * 1)` = **8px** (floating popovers/modals; was 7×=56px before 2026-06-08).
- **Auth modal is EXCLUDED**: `.auth-modal.glass-modal` overrides back to faint-white fill + `--tw-backdrop-blur: blur(*7)` (56px) so it reads through the marquee wall. (Selector is `.auth-modal.glass-modal` = 0,2,0 so it beats `.glass-modal`'s later source order.)
- Comment surfaces (editor popover, marker preview, standalone CommentsPanel) were aligned to `--glass-fill` + boost 2026-06-08. The **studio nav panels** (Layers/Slides/Comments-tab) deliberately stay on `backdrop-blur-glass` white-tint (user choice).

### Typography
Cairo (variable, `next/font`), Poppins fallback. `.tq-h1` (24/700), `.tq-widget-title` (18/700), `.tq-subhead` (14). **Latin numerals only (0-9)** even in Arabic copy. Material Symbols sized via chained selectors (`.material-symbols-outlined.tq-icon-{sm,lg}`) because the font ships an unlayered `font-size:24px` that beats Tailwind `text-[Npx]`.

### Utility classes (compose these)
`.btn-pill` (secondary, transparent+border) · `.btn-gradient` (primary CTA, brand gradient, pill, flat) · `.btn-pill-danger` (red) · `.btn-gradient-anim` / `.canvas-gradient-border` (animated `--mesh-*` gradient border = "AI does work here") · `.input-dark` / `.input-search` (glass inputs) · `.dropdown-item` · `.nav-item`/`.nav-active` · `.badge-purple` · `.progress-track`/`.progress-bar` · `.modal-dim` · `.studio-canvas` · `.text-gradient` · `.hide-scrollbar` · `.mask-edges`. All buttons are pill-shaped (9999px); flat (no shadows) since 2026-05-22.

### Animation
`--mesh-x1..6`/`--mesh-y1..6` `@property` vars + 12 keyframes drive the drifting gradient borders. Marquee/scroll keyframes for auth + templates. `prefers-reduced-motion` drops them.

### The 3 discipline rules (non-negotiable, user-flagged)
1. Never hardcode — use tokens / add a class to globals.css first.
2. Read the globals.css legend before any visual change.
3. Reuse existing components/primitives — never fork tokens, Cairo, `--tq-*`, glass, or shared primitives.

---

## 5. Reusable component inventory

Tiered by "reuse-me". Full catalog below; **Tier-1 = always reuse**.

### Tier-1 primitives
- **Controls** ([components/create/controls.tsx](components/create/controls.tsx)): `CardHeader`, `SegmentedToggle<T>` (spring 500/35), `Toggle` (RTL), `Pill`, `LanguagePills`, `PositionPicker`/`PositionDropdown`, `ExclusionDropdown`, `InlinePaletteSwatch`.
- **`PillButton`** ([components/create/PillButton.tsx](components/create/PillButton.tsx)) — primary/secondary/ghost CTA, the canonical button across flows.
- **`ColorPickerPopover`** ([components/create/ColorPickerPopover.tsx](components/create/ColorPickerPopover.tsx)) — SV square + hue + hex + presets; used by design cards AND in-canvas pills.
- **Brand** ([components/brand/](components/brand/)): `CompactUploadZone`, `FontUploadSlot`, `GoogleFontSlot`, `LogoRow`, `BrandKitDropdown`, `BrandFontPicker`.
- **`Avatar`** ([components/common/Avatar.tsx](components/common/Avatar.tsx)) — image or initial-on-gradient.
- **`AnimatedIcon`** ([components/icons/AnimatedIcon.tsx](components/icons/AnimatedIcon.tsx)) — Material name → animated SVG (sidebar, QuickActions, toolbar). `ParagraphWriteIcon` = the generating placeholder.
- **`SlideRenderer`** ([components/slides/SlideRenderer.tsx](components/slides/SlideRenderer.tsx)) — renders a slide from HTML+theme; thumbnails AND canvas.

### Dashboard widgets ([components/app/](components/app/))
`DashboardWidget` + `DashboardWidgetHeader` + `DashboardEmptyState` (chrome — swap the body). Widgets: `RecentGenerationWidget`, `RecentActivityWidget`, `MyTemplates`, `PlanUsage`, `QuickActions`. Tiles: `ProjectThumbnail`, `ProjectTableRow`, `TemplateTile`, `BrandKitTile`, `ProjectsGrid`, `Pagination`, `Sparkline`, `GenerateSplitButton`.

### Dialogs/modals (sibling overlay+panel pattern, glass surface — reuse the chrome)
`NewProjectDialog` (singleton, Header), `ShareDialog`, `SaveAsTemplateDialog`, `UseBrandKitDialog`, `AllNotificationsModal`, `TemplateLightbox`, `LibraryImageModal`, `CancelGenerationDialog`, confirm dialogs (`TemplateDeleteConfirmDialog`, `BrandKitDeleteConfirmDialog`, `BrandKitRenameDialog`, `TrashConfirmDialog`).

### Portal menus
`ProjectActionsMenu`, `TemplateActionsMenu`, `BrandKitActionsMenu`, `AccessChipDropdown` (share role picker), `HistoryPopover`, `ExportMenu`, `BellDropdown`.

### Studio/editor ([components/preview/](components/preview/), [components/slides/](components/slides/))
`DeckView` (orchestrator), `StudioHeader`, `SlideNavSidebar`, `LayersPanel`, `CommentsPanel`, `HeroCommentOverlay`, `PreviewActionBar` (bottom toolbar), `SlideEditor` (iframe), `StylePill` + `MorePopover` + `FontControl` (in-canvas), `GenImageProvider` (genid→url context), `SlidePresenceStack`.

> Restyle guidance: token/CSS changes go in **globals.css**, not component edits. Reuse widget/dialog/menu chrome; swap only body content. Honor RTL + AnimatedIcon + portal-menu patterns.

---

## 6. User flows

All four creation flows share the 3-card layout (content/brand/output) and converge on `POST /api/projects → /project/[id]`.

- **/create** — text OR file (PDF/PPTX/DOCX/TXT). File → `POST /api/extract` then poll `/api/extract/[jobId]` → `anthropicFileId`. Brand (saved kit / palette / font / logo) + output (size, count, pagination, design style, AI images). `source.kind = "scratch"`.
- **/enhance** — PDF/PPTX upload with real XHR progress; extraction returns fonts/colors/pageCount/language/textPerSlide; `event.type = "enhance"` (preserves source content + identity, redesigns layout).
- **/mimic** — upload a design reference → minted as an Anthropic doc; `source.kind = "mimic"` (reproduce the reference's visual language). `/use-template/[id]` = same flow seeded from a template.
- **/datasheet** — xlsx/csv → `POST /api/datasheet/parse` (sync) → markdown; `source.kind = "data"`.

**Generation prompt** lives in [inngest/functions/deck-generate.ts](inngest/functions/deck-generate.ts) — `SYSTEM_PROMPT_CREATE_HTML` (+ mimic/enhance addenda). LANGUAGE directive per flow; CONTENT FIDELITY (soft) on scratch; cover carries `data-deck-title` → `Project.title`. (See [context/plan-editor.md](context/plan-editor.md) for editor specs §17-§20.)

**Studio** (`/project/[id]`, `DeckView`): generating shell (disabled, streaming) ⟶ seamless ⟶ editor (enabled). Edit = in-place content save (no version); undo/redo = client stack; history = checkpoints on Save + 10-min idle. Roles gate affordances.

---

## 7. Backend & data

### Prisma ([prisma/schema.prisma](prisma/schema.prisma))
```
User → Project → Presentation (1:1) → PresentationVersion (1:M, slideJson = full manifest)
                                     → SlideState (per slideKey: lockedAt, cachedComments, currentVersionNumber)
                                         → SlideVersion (per-slide history, capped 20, source=create|regen|partial_regen|manual_edit)
Project → ProjectShare (per-invitee: accessLevel view|comment|edit, inviteToken)
        → GeneratedImage (genid, prompt, status, storageUrl)
        → Comment (forAi flag → partial regen) · Job (Inngest telemetry) · BrandKit · Template
User → Notification (bell)  · Subscription · UsageEvent · Folder
```
`Presentation.currentVersionId` = active; `savedVersionId` + `savedSlideVersions` = pinned saved snapshot (drives the saved/unsaved indicator).

### Inngest ([inngest/functions/](inngest/functions/))
`deck-generate` (`deck.generate.requested`): brief → Claude streams `<section>` HTML → `StreamingHtmlSplitter` → scope CSS (`lib/deck/scope-css`) + canvas frame (`lib/deck/scaffold`) → seed versions → save manifest → fire image-warm + thumbnails. Also: `deck-regenerate-partial`, `deck-image-warm` (gpt-image-2, bill-once via storage existence + idem key, broadcasts `slide.image.ready`), `deck-images-generate`, `extract-source`, `brand-analyze`, `thumbnail-render` (Puppeteer→WebP), `template-render`.

### API ([app/api/](app/api/))
Projects (create/save/regenerate[-partial]/retry/cancel/status/favorite/share/export{pdf,png}), slides (`[slideKey]/{edit,checkpoint,restore,regen,lock,versions,images}`), comments, brand-kits, templates, extract, datasheet/parse, storage/upload[-image], invitations/[token]/accept, notifications, auth/{user-sync,delete-account}.

### Auth & access ([lib/api/project-access.ts](lib/api/project-access.ts))
Supabase JWT → Prisma User. `resolveProjectAccess(id, requiredRole)`: owner > edit > comment > view. Owner / accepted ProjectShare / public `publicAccessLevel` / revoked-denies-public. SSR pages + API routes both gate.

### Realtime ([lib/realtime/](lib/realtime/))
Project channel `project:{id}` (comment.*, slide.regen.*, deck.regen.*, slide.lock.*, slides.locks.bulk-changed, slide.image.ready) + user channel `user:{id}` (notifications) + presence. `broadcastToProject/User` from Inngest + routes. **Realtime events → in-place state updates, never `router.refresh`** (the `/status?includeManifest&includeSlideStates` fat-sync is the broadcast handler's refetch). In local dev, broadcasts don't deliver (docker Postgres) — the status poll is the fallback.

### Storage & images
Supabase buckets: `slide-previews` (WebP thumbnails, public), `generated-images` (gpt-image + uploads, public), `brand-assets`/`source-files` (private). `lib/images/`: `genImageHash` (sha256→12hex path), `publicGeneratedImageUrl`, `scanGenImages`/`injectImgSrc`.

### Key lib/ modules
`anthropic/` (quality-params, files) · `schema/slide.ts` (SlideManifest/Slide/Theme, SLIDE_DIMENSIONS) · `deck/` (html-stream, scaffold, scope-css) · `export/` (dom-to-pptx **patched via patch-package**, bidi-postprocess, sanitize-server, render-deck-pdf) · `images/` · `db/slide-versioning.ts` · `realtime/` · `extract/` · `project/` (load-project, flow, derive-color-tags) · `brand/` · `notifications/`.

---

## 8. Conventions & gotchas

- **Glass blur ≠ bare `backdrop-filter`.** Lightning CSS strips it from plain rules — apply blur via the `backdrop-blur-glass`/`-boost` Tailwind utilities; bg via a class.
- **Turbopack sometimes serves a stale globals.css chunk** after an edit — a second touch forces recompile; verify a new rule landed via `document.styleSheets`.
- **`set-state-in-effect` + ref-mutation-in-render are lint errors here.** For derived/accumulated state use React's "adjust state during render" pattern; mirror state→ref in an effect (that's allowed).
- **RTL everywhere** — test on an Arabic page; cascade order matters (e.g. `.auth-modal.glass-modal` needed 0,2,0 to beat `.glass-modal`).
- **Latin numerals only** in user-facing copy.
- **`dev` is the only branch.** Never `git checkout -b`. Push only on request / milestone / >3 commits.
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits, schema changes, Inngest prompt-pipeline edits.
- **`lib/deck/validate-layout.ts` + `vision-check.ts`** are pre-existing untracked files — not part of recent work; don't commit them.
- Editor iframe reload needs `reloadKey` baked into `srcDoc` (the edit path leaves `bodyHtml` stale) — see [components/preview/editor/SlideEditor.tsx](components/preview/editor/SlideEditor.tsx).
