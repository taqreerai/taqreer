# Projects + Dashboard Rework — Plan & Status

Working doc for the dashboard "RecentProjects" rework, the /projects listing,
the 3-dots menu actions, and the supporting thumbnail / metadata pipeline.
Branch: `hotfix/thinking-config-adaptive`. Last sync: 2026-05-20.

---

## Original spec (from user, verbatim)

> let's get the thumbnails of the projects, it should have the 16:9 ratio,
> if the project was 9:16, then we show only the top of the slide this way
> we can keep the 16:9 as the default thumbnail ratio for all ratios
>
> the thumbnail should be full screen, on hover we show title, under it
> creation date, on the left 3 dots
>
> أحدث المشاريع should should the last 6 but 2 rows, 3 columns max 6
>
> the 3 dots show a popup same as the screenshot
>
> Share...
> Rename...
> Add to favorites ( we already have fav page)
> Duplicate ( no need )
> Copy link
> Create from this we change it to "use this as a template" ( should use the
> project as a template for claude, basically use same logo same chrome same
> colors same fonts etc...), if the user clicks this, it should take him to
> a page with only text area or upload content, the content uploaded pasted
> will be used for the same template / project
> Save copy as template ( will discuss with you how we should create
> templates, but you can suggest if you have an approach )
>
> http://localhost:3000/projects projects page should list all projects,
> 5 a row, sort dropdown menu and filter by / slide count / language ar en
> all / color ( 10 main basic colors) so if green was chosen we show all
> slides that have any shade of green as dominant color, etc
>
> read global css header so we can stay consistent, don't guess

### Subsequent clarifications

- **HTML thumbnails scrapped.** Final: Puppeteer-rendered WebP (already
  shipped). Do NOT switch to shadow-DOM HTML snapshots.
- **3-dots position**: top-right (NOT top-left from the original message).
- **Title + creation date overlay**: bottom-right of the tile.
- **Hover behaviour**: thumbnail dims so title / date / 3-dots become
  legible. Idle state shows just the thumbnail.
- **`slideCount` / `dominantColor`**: populated once on **deck-generate
  completion**. Never updated by regen / partial-regen / save.
- **"Save copy as template"**: render the menu item but **NOT clickable**.
  No toast, no "coming soon" — just disabled. User will say when to wire it.
- **"Use this as a template"** target: option (a) — content-only page,
  pre-filled brand (colors / fonts / logo / templateId) from the source
  project. Skip brand AND summary steps.
- **Favorites page**: exists already at `/features`, just needs renaming
  to `/favorites`. `Project.isFavorite` column already exists in schema.

---

## Build order (locked 2026-05-20)

User-visible value first, Share modal last (deepest backend work).

1. **8b** — Move `slideCount` + `dominantColor` capture from `/save`
   route → `deck-generate.ts` completion step. Frozen forever after
   first generate.
2. **9d/9e** — Dashboard tile rewrite. 3-col grid, full-bleed
   thumbnail, hover dims + reveals overlay with title + creation date
   bottom-right + 3-dots top-right. Drop the existing footer
   (title / edit / download / more buttons).
3. **9f** — 3-dots menu (glass-popover). All seven items rendered.
   Wired now: **Add to favorites** (toggles `isFavorite`), **Copy
   link** (clipboard), **Send to trash** (hard delete + confirmation).
   Stubbed: **Share** (opens empty modal — filled in step 15),
   **Rename** (TODO until rename UX decided), **Use this as a
   template** (wired in step 13), **Save copy as template**
   (disabled, no click handler).
4. **12** — `/features` → `/favorites` rename + sidebar link update +
   page filters by `isFavorite: true`.
5. **13** — `/create/from/[projectId]` content-only page. Pre-fills
   brand from source project. Wires "Use this as a template" menu item.
6. **11** — `/projects` page (5-per-row + sort dropdown + filter bar
   for slideCount / language / dominantColor buckets).
7. **15.1 → 15.6** — Share modal (sub-phased in step 15 below).
8. **15.7** — PDF export (deferred to last).
9. **14** — Save copy as template (blocked; user will say when).

---

## Route split — `/preview/<id>` ↔ `/project/<id>` (locked 2026-05-21)

Status: ⏳ planned for the NEXT PR after #28 merges to main.

**Why a new PR**: #28 is already large + has a 9-file conflict with
`c2fac6e` (main's "adaptive runtime / live preview / CR fixes"
commit). Doing the route split on the same branch grows the conflict
surface. Cleaner to land #28, merge to main, then open a focused PR
for: route split + tile-click navigation + template lightbox CTA.

### What changes

1. **`/preview/<id>`** — generation phase ONLY. Streaming UI,
   progress bars, "Claude is designing slide 3 of 8…", placeholder
   cards. When status flips to `completed`, SSR returns a 307
   redirect to `/project/<id>` so bookmarks / notifications /
   shared links keep working.
2. **`/project/<id>`** — NEW route. The working session: slide pill
   (regen / history / lock), comments, save, exports, lightbox.
   Canonical share/bookmark URL for a completed deck.
3. **Dashboard + /projects tile click** → navigates to
   `/project/<id>` (today opens the lightbox).
4. **Template tiles** → click opens the ProjectLightbox component
   (reused, NOT deleted). Future template-flow PR adds the
   "استخدم هذا القالب" CTA inside.

### Code-split approach (locked: option A)

Cut DeckView in half:
- **DeckView** stays in `components/preview/` — generation-only
  rendering, used by `/preview/<id>`.
- **ProjectView** is a NEW component in `components/project/` —
  the `status === "completed"` code path lifted out, used by
  `/project/<id>`.

Net effect: each file roughly halved (DeckView is ~1800 lines
today). Easier to navigate while debugging — `/preview` route
debugging never opens working-session code, and vice versa.

### Updates that ride along

- Bell notifications, `Copy link` action in the 3-dots menu,
  Share modal preview URLs — all currently use `/preview/<id>`,
  switch to `/project/<id>` post-split.
- The Save / export buttons in DeckView's current "completed"
  branch move to ProjectView intact (no behavior change).
- Lightbox stays a shared component (used by templates now;
  could be used by other browseable-content surfaces later).

### Deferred (for the template-flow PR, not this one)

- The lightbox's "Use this template" CTA + the actual `/create/
  from-template/[templateId]` route. The lightbox component
  itself is preserved; only the CTA + destination route are
  deferred. Tile-click → lightbox-open for templates can still
  ship in this PR without the CTA wired (button stays
  disabled / coming-soon until the templates flow PR).

---

## Status

| Phase | What | State |
|-------|------|-------|
| 7 | Save Project button (pins `Presentation.savedVersionId` + freezes filter cols, restore-aware) | ✅ shipped |
| 8 | Thumbnail pipeline (Puppeteer → sharp → WebP → `slide-previews` bucket → `Project.thumbnailUrls[]`) | ✅ shipped |
| 9a | 16:9 aspect tile + top-crop for 9:16 source | ✅ shipped |
| 9b | Hover scrub + RTL direction + gating on movement | ✅ shipped |
| 9c | Click-to-lightbox (tile is the entry point) | ✅ shipped |
| 10 | Lightbox slider (glass system, RTL keyboard nav, arrows outside slide, fade-out on close) | ✅ shipped |
| 9d | Dashboard grid: 3 columns (sm:2 → lg:3) | ✅ shipped |
| 9e | Tile chrome: full-bleed thumbnail + footer (title + date start, 3-dots end), no hover dim | ✅ shipped |
| 9f | 3-dots menu — wired: favorite toggle, copy link, inline-rename, send-to-trash (hard delete + storage cleanup, confirmation modal). Stubbed: share (step 15), use-as-template (step 13). Disabled: save-copy-as-template. | ✅ shipped |
| Lang A | Content language picker (`العربية` / `الإنجليزية`) on /create/content; threads through sessionStorage → POST → Project.language + Presentation.language/direction + brief.language. Replaces 3 hardcoded `"ar"`/`"rtl"` sites. | ✅ shipped |
| Lang B | LANGUAGE directive injected at TOP of `buildUserMessage` based on `brief.language`. AR (default, reinforces RTL + Arabic font stack). EN (new — produce English-only deck text, dir=ltr, drop Arabic font fallbacks). System prompt unchanged (prompt-cache warm). | ✅ shipped |
| Lang C | BiDi post-processor gating on `language === "en"` + rendered HTML `dir="ltr"` for EN decks. Wrap `lib/export/bidi-postprocess.ts` call in `if (manifest.language !== "en")`; update `html-document-server.ts` + `html-document.ts` to switch `dir` on language. | ⏳ deferred (needs Phase B in production first for detection-accuracy data) |
| 8b | Move `slideCount` + `dominantColor` capture from `/save` route → deck-generate completion | ⏳ next |
| **11a** | **/projects page: 5-per-row grid using ProjectThumbnail** | ⏳ next |
| **11b** | **Sort dropdown** | ⏳ next |
| **11c** | **Filters: slide count, language (ar/en/all), color (10 buckets with shade-range matching)** | ⏳ next |
| **12a** | **/features → /favorites rename (route, sidebar link, page title)** | ⏳ next |
| **12b** | **Wire isFavorite toggle from 3-dots menu** | ⏳ next |
| **13** | **`/create/from/[projectId]` content-only page** | ⏳ next |
| **14** | **Wire "Save copy as template" menu item** (TBD — disabled until user says go) | 🚫 blocked |

---

## What's done — detail

### Step 7: Save Project (versions + restore-aware `isSaved`)

- POST `/api/projects/[id]/save` pins `Presentation.savedVersionId` =
  `currentVersionId`, snapshots per-slide `currentVersionNumber` into
  `Presentation.savedSlideVersions` (Json), freezes `Project.slideCount`
  + `Project.dominantColor` on first save.
- `DeckView` computes `isSaved` against BOTH `savedVersionId === currentVersionId`
  AND every slide's live `currentVersionNumber === savedSlideVersions[slideKey]`
  — catches in-place mutations from per-slide restore.
- Save button in toolbar morphs `save` ↔ `check` via AnimatePresence; no
  toast on running/success (user request).
- Files: [app/api/projects/[id]/save/route.ts](app/api/projects/[id]/save/route.ts),
  [components/slides/PreviewActionBar.tsx](components/slides/PreviewActionBar.tsx),
  [components/preview/DeckView.tsx](components/preview/DeckView.tsx),
  [prisma/schema.prisma](prisma/schema.prisma#L100-L110) (`savedVersionId`
  + `savedSlideVersions Json?`),
  [prisma/migrations/20260520093845_presentation_saved_slide_versions](prisma/migrations/20260520093845_presentation_saved_slide_versions).

### Step 8: Thumbnail pipeline (Puppeteer → WebP)

- New Inngest function: `inngest/functions/thumbnail-render.ts`. Triggered
  by `inngest.send({ name: "deck.thumbnails.render", id: thumbnails:${projectId}:${savedVersionId}, ... })`
  from POST `/save`.
- Loads saved manifest, renders standalone HTML server-side via
  [lib/export/html-document-server.ts](lib/export/html-document-server.ts) +
  [lib/export/sanitize-server.ts](lib/export/sanitize-server.ts) (JSDOM-backed
  mirror of the browser sanitiser including RTL rewriters), drives
  Puppeteer (`page.setContent` + `page.screenshot({ clip })` — NOT
  `el.screenshot()`, which hits a Chrome blank-output bug when clip equals
  viewport), resizes via sharp to 800 px wide WebP @ Q82.
- Storage: `slide-previews` bucket (public — flipped in dashboard;
  `scripts/setup-storage.ts` updated). Path:
  `${userId}/${projectId}/${savedVersionId}/${slideKey}.webp`. `upsert: true`
  so retries overwrite.
- Concurrency cap 2 (each run launches Chromium ≈ 200 MB).
- Viewport sized to `canvasW × canvasH × (slides + 1)` so single-slide
  decks don't trigger the clip-equals-viewport blank-output bug.
- Result URL array written back to `Project.thumbnailUrls`.
- Files: [inngest/functions/thumbnail-render.ts](inngest/functions/thumbnail-render.ts),
  [inngest/index.ts](inngest/index.ts), [app/api/inngest/route.ts](app/api/inngest/route.ts),
  [lib/export/sanitize-server.ts](lib/export/sanitize-server.ts),
  [lib/export/html-document-server.ts](lib/export/html-document-server.ts),
  [scripts/setup-storage.ts](scripts/setup-storage.ts).

### Step 9 (partial): ProjectThumbnail component

- Renders saved slide thumbnails from `Project.thumbnailUrls[]`.
- 16:9 aspect tile; `object-cover object-top` for 9:16 source → shows
  the top portion cropped to 16:9 (per spec).
- Hover scrub: cursor X within slide → maps to slide index.
  - **RTL mapping**: rightmost edge = slide 1, leftmost = slide N. Matches
    Arabic reading direction.
  - **Activation gate**: first mousemove records entry X and bails;
    subsequent moves require ≥ 6 px travel before scrub activates. Bare
    hover does NOT trigger scrub indicator.
- Files: [components/app/ProjectThumbnail.tsx](components/app/ProjectThumbnail.tsx).

### Step 10: Lightbox slider

- `ProjectLightbox` component, opens from a tile click. NOT in the
  original spec but kept after user gave UX feedback.
- Structure: `createPortal` to body, two siblings (dim overlay +
  glass-popover content layer). Pattern mirrors `AllNotificationsModal`.
- Glass surfaces: dim uses `var(--tq-surface-modal)` (no own blur).
  Top toolbar + bottom thumb strip use `.glass-popover backdrop-blur-glass
  backdrop-saturate-[var(--glass-saturation)]`.
- Card sized via JS measurement (`useLayoutEffect` + `ResizeObserver`) —
  CSS-only attempts (flex + aspect-ratio + height:100%) all collapsed to
  0 width.
- Arrows: 40 px gap from card edges, positioned via `left/right: calc(100% + 40px)`.
- Keyboard: ← advances (RTL next), → goes back, Home/End jump, Esc closes.
- Single-slide decks hide arrows + strip.
- Active thumb gradient outline via two-background composition
  (`linear-gradient(var(--tq-bg), var(--tq-bg)), var(--tq-gradient-brand)`).
- Files: [components/app/ProjectLightbox.tsx](components/app/ProjectLightbox.tsx).

### Step 9f: Dashboard tile 3-dots menu

- `<ProjectActionsMenu>` portal'd `.glass-popover` anchored to the
  3-dots button's `DOMRect`. Outside-click + Esc close; trigger tagged
  `data-project-menu-trigger` so its own click is excluded from the
  close handler (otherwise mousedown closes → click re-opens —
  same bug pattern we fixed on `HistoryPopover` in the same session).
- Seven menu items, three states:
  - **Wired**: Favorites toggle (optimistic + `PATCH /api/projects/[id]/favorite`),
    Copy link (`${origin}/preview/${id}` to clipboard), Inline rename
    (`<p>` flips to `<input>`; Enter/blur commits to `PATCH /api/projects/[id]`,
    Escape cancels; trimmed + 200-char cap on both sides), Send to trash
    (`<TrashConfirmDialog>` → `DELETE /api/projects/[id]` → cascade DB +
    best-effort wipe `slide-previews/${userId}/${projectId}/**`).
  - **Stubbed**: Share (logs placeholder until step 15), Use as template
    (navigates to `/create/from/[projectId]` — 404s until step 13).
  - **Disabled**: Save copy as template (no handler, per user lock).
- `RecentProjects` tracks a `Set<id>` of just-deleted projects and
  filters the list — tile disappears the moment the server confirms.
  Dashboard SSR select clause gains `isFavorite` so the star icon
  resolves correctly on first paint.
- Files: [components/app/ProjectActionsMenu.tsx](components/app/ProjectActionsMenu.tsx),
  [components/app/TrashConfirmDialog.tsx](components/app/TrashConfirmDialog.tsx),
  [app/api/projects/[id]/favorite/route.ts](app/api/projects/[id]/favorite/route.ts),
  [app/api/projects/[id]/route.ts](app/api/projects/[id]/route.ts) (PATCH rename + DELETE),
  [components/app/ProjectThumbnail.tsx](components/app/ProjectThumbnail.tsx),
  [components/app/RecentProjects.tsx](components/app/RecentProjects.tsx),
  [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx).

### Language Phase A + B (content language picker + prompt directive)

- **Phase A** — UI + persistence. New `<LanguagePills>` 2-segment
  radio (`العربية` / `الإنجليزية`) on `/create/content` row 1, right
  card. Replaced the retired `تصحيح الأخطاء` toggle (model now
  preserves user text verbatim by default; `rules.fixTypos` always
  sent as `false`). Pagination toggle + LanguagePills sit on a
  `justify-between` flex row. `Toggle` component switched from
  `flex` to `inline-flex` so it hugs its content. Threaded through
  sessionStorage → `/create/summary` POST → `/api/projects/route.ts`
  which validates the union with `isContentLanguage` /
  `directionForLanguage` helpers and stamps `Project.language` +
  `Presentation.language` + `Presentation.direction` (`ar → rtl`,
  `en → ltr`) + `brief.language`/`direction`. Replaces three
  hardcoded `"ar"` / `"rtl"` sites. No backfill — existing rows
  stay tagged `"ar"` (per user direction: all current decks are AR
  or BI; both map to AR under the prompt).
- **Phase B** — LANGUAGE directive injected at the TOP of
  `buildUserMessage` based on `brief.language`. System prompt stays
  unchanged (prompt-cache warm). AR reinforces dir=rtl + Arabic
  font stack + inline LTR run wrapping; EN instructs English-only
  slide text, dir=ltr, Latin typography (skip Arabic font
  fallbacks). The OUTPUT JSON spec was already `"language": "ar" | "en"`
  — no schema change. An earlier-same-day "BI" bucket was retired
  in favor of a 2-bucket pick — the AR prompt is already
  bilingual-aware. Legacy `"bi"` payloads collapse to `"ar"` at
  every read site.
- **Phase C** (deferred) — wrap `lib/export/bidi-postprocess.ts`
  call in `if (manifest.language !== "en")`; switch rendered HTML
  `dir` on language in `html-document-server.ts` +
  `html-document.ts`. Needs Phase B in production first so we have
  EN-tagged decks to validate gating against.
- Files: [components/create/controls.tsx](components/create/controls.tsx)
  (LanguagePills + LanguageCode), [components/create/OutputCards.tsx](components/create/OutputCards.tsx)
  (StoredOutput.language), [app/create/content/page.tsx](app/create/content/page.tsx),
  [app/create/summary/page.tsx](app/create/summary/page.tsx),
  [app/api/projects/route.ts](app/api/projects/route.ts) (ContentLanguage
  + isContentLanguage + directionForLanguage),
  [inngest/functions/deck-generate.ts](inngest/functions/deck-generate.ts)
  (LANGUAGE directive in buildUserMessage).

---

## What's next — detail

### 9d–9f: Dashboard tile rework (RecentProjects)

**File**: [components/app/RecentProjects.tsx](components/app/RecentProjects.tsx)

Required changes:
- Grid: `grid-cols-3` (NOT `sm:grid-cols-2`). Max 6 items (`take: 6` already
  set in [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx)).
- Drop the footer (title + date + download/edit/more buttons under the
  tile). Tile is just the full-bleed thumbnail + hover overlay.
- Hover overlay (absolute, fades in on `group-hover`):
  - Background dim (e.g. `bg-black/55` or a `linear-gradient(to top, rgba(0,0,0,0.7), transparent)`)
  - Title (bold, white) in **bottom-right**, creation date (muted) beneath
  - 3-dots button **top-right** (`.btn-pill` icon-only, `more_vert`)
- Tile click → open lightbox (current behavior).
- 3-dots click → open menu (does not propagate to tile click).

### 9f: 3-dots menu

**New file**: `components/app/ProjectActionsMenu.tsx`

- `.glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]` portal.
- Anchored under the 3-dots button via `DOMRect` math (same pattern as
  `HistoryPopover.tsx` and `BellDropdown.tsx`).
- Items (in order, RTL):
  1. **Share** — `share` icon. Action: TBD (probably opens a modal).
  2. **Rename** — `edit` icon. Action: inline rename or modal.
  3. **Add to favorites** / **Remove from favorites** — `star` / `star_outline`.
     Toggles `Project.isFavorite` via PATCH `/api/projects/[id]/favorite` (new).
  4. **Copy link** — `link` icon. `navigator.clipboard.writeText` of the
     preview URL.
  5. **Use this as a template** — `dashboard_customize` icon.
     Navigates to `/create/from/[projectId]`.
  6. **Save copy as template** — `bookmark_add` icon. `disabled` + no onClick.
     Rendered with `cursor-not-allowed opacity-40`.
  7. **Send to trash** — `delete` icon. Destructive variant. Confirmation
     modal. Action: TBD (soft-delete via new column, or hard-delete via
     DELETE `/api/projects/[id]`).
- Esc + outside click + selection close the menu.
- Each item is a `button` with `onClick` (or `disabled` for #6).

### 8b: Move `slideCount` + `dominantColor` to deck-generate

**Current**: populated in `/api/projects/[id]/save/route.ts` on first save.
**Wrong**: should be on first deck-generate completion, then frozen forever.

Plan:
- Move the column writes into `inngest/functions/deck-generate.ts` (in the
  completion step that flips `version.status = "completed"` + project
  status).
- Source `slideCount` from `manifest.slides.length`. Source `dominantColor`
  from the brief's `brand.colors[0]` (`Job.inputJson`), normalised to one
  of the 10 buckets (NOT raw hex per the filter requirement).
- Remove the same logic from `/save` route — Save no longer touches these.
- Backfill: optional one-shot script to populate for existing projects.

### 11: /projects page

**File**: [app/(app)/projects/page.tsx](app/(app)/projects/page.tsx) — currently a stub.

- 5 per row grid (`grid-cols-5`) using the same `ProjectThumbnail` + hover
  overlay component as RecentProjects.
- Sort dropdown — at minimum: most recent, oldest, name A-Z, name Z-A.
- Filter bar:
  - **Slide count**: range or buckets (e.g. ≤ 4, 5–8, 9–12, 13+).
  - **Language**: ar / en / all.
  - **Color**: 10 swatches. Choosing one filters by `dominantColor` falling
    in that hue bucket. The 10 buckets need definition — proposed:
    black / white / red / orange / yellow / green / teal / blue / violet / magenta.
    Map raw hex → bucket via HSL hue ranges (e.g. green = H ∈ [80°, 160°],
    S > 20%, L ∈ [10%, 85%]).
- URL state via `?sort=&color=&language=&slides=` so filter views are
  shareable.

### 12: /features → /favorites rename

**File moves**:
- [app/(app)/features/page.tsx](app/(app)/features/page.tsx) → `app/(app)/favorites/page.tsx`
- Sidebar link in [components/app/Sidebar.tsx](components/app/Sidebar.tsx) /
  [components/app/DashboardShell.tsx](components/app/DashboardShell.tsx) —
  search for "features" / "المفضلة" / `/features` and update.

**Schema**: `Project.isFavorite Boolean @default(false)` already exists
(line 76 of schema.prisma) and has an index `@@index([userId, isFavorite])`
on line 89.

**API**: new `PATCH /api/projects/[id]/favorite` route — toggles or sets
`isFavorite`. Auth: same project-ownership check as `/save`.

**Wiring**:
- Favorites page filters by `isFavorite: true`.
- 3-dots menu's "Add/Remove from favorites" item hits the new endpoint
  + optimistic UI update.

### 13: `/create/from/[projectId]`

**New route**: `app/create/from/[projectId]/page.tsx`

- Server component reads source project's brand: colors, fonts, logo
  (signed URL), templateId, slideSize / format.
- Renders a content-only page: textarea + file upload (same components
  used in `/create/content`).
- "Generate" submits to `/api/projects` with the source brand fields
  copied in, content from the user. SAME deck-generate Inngest function.
- After dispatch, navigate to `/preview/[newProjectId]`.

**Files to check for reuse**:
- [app/create/content/page.tsx](app/create/content/page.tsx) — content
  input UI we can lift.
- [app/api/projects/route.ts](app/api/projects/route.ts) — the existing
  brief-assembly logic.

### 14: Save copy as template (blocked)

- Rendered as menu item but disabled. Wait for user spec.

### 15: Share modal

**Triggered by**: 3-dots menu → "Share..." (item #1 from step 9f).

**Reference**: Gamma's share modal (user showed screenshots 2026-05-20).
Simplified — Taqreer's version is ONE single view, no tabs.

**Layout** (top to bottom):

```
Share <project title>                            [X]
─────────────────────────────────────────────────────

Share
─────
[email input — Add emails or people]
[Anyone with link]                         [access ▾]

Export
──────
[All cards / Range ▾]

Export type
  [Export to PowerPoint]      ↓
  [Export to PDF]             ↓
  [Export to PNGs]            ↓

or you can post this page directly to ...
  [LinkedIn]

Hide "Made with Taqreer" badge    [PLUS]    [toggle]

                                       [Copy share link]
```

**Removed vs. Gamma**:
- ❌ Sharing / Settings tabs (single view only)
- ❌ Embed option
- ❌ Workspace members row
- ❌ Password protection + search-indexing rows

**Surface**: `.glass-modal backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]`
modal via `createPortal` to body (same pattern as `ProjectLightbox`).

**Decisions (locked, user-confirmed 2026-05-20)**:

1. **"Anyone with link" access** — full 4-level dropdown:
   - **Edit** — view + comment + can fire regen / partial-regen
   - **Comment** — view + comment, but CANNOT regen
   - **View** — view only, no comment, no regen
   - **No access** — link disabled (default)
2. **Email input** — full invite system: user types an email +
   picks access level, a `ProjectShare` row is created, an
   invitation email is sent to that address. When the invitee
   logs in, the route check picks up their `ProjectShare` row
   and grants the stored access level.
3. **PNG export** — Puppeteer at full canvas resolution (NOT the
   800 px thumbnail scale); one PNG per slide; ZIP'd for download.
4. **PDF export** — deferred to last step. Render the menu item
   disabled (no click handler) until the rest of the modal ships.
5. **"Made with Taqreer" badge** — must be implemented in exports
   (PPT / PNG / future PDF). Plan-gating on the "Hide badge" toggle
   to be decided later — render the toggle but the plan-gating
   logic is TBD; for now the toggle works for any plan.
6. **Copy share link** — URL is `${origin}/preview/${id}`.
   Default access for someone with the link is **view only**.
   Behaviour:
   - **Not logged in** → redirected to login (`?next=/preview/[id]`)
   - **Logged in, has access** → renders the project (read-only
     for view-tier, editable for edit-tier, etc.)
   - **Logged in, no access** → 403 / not-found

**Decisions locked 2026-05-20 (round 2)**:

A. **Email provider**: **Resend**. Install `resend` SDK, scaffold
   `lib/email/send.ts`, render templated invitation HTML, send via
   API key from env. Tier: free during dev, upgrade later if needed.
B. **Edit-access semantics** — NO shared editing. When an invitee
   accepts an "Edit" invite, the project is **auto-cloned** into
   their account (Project + Presentation + versions + SlideStates
   + thumbnail render kicked off). They edit their COPY; the
   original stays with the owner. View / Comment invites keep the
   reader on the owner's original. Shared-edit / live-collab is
   deferred to the future "Workspace members" feature per user.
C. **API route refactor scope** — drastically reduced. Only two
   routes need to relax owner-only:
   - `/preview/[id]` (page) — allow logged-in users with View /
     Comment / Edit access on this project to read. Edit access
     triggers the auto-clone redirect to their copy's preview URL.
   - `/api/projects/[id]/comments` (+ `[commentId]`) — allow
     Comment + Edit accessors (Edit is rare since edit-invitees
     auto-clone; but the case where someone has Comment AND
     happens to be the owner's account is the typical path).
   Every regen / lock / restore / save / partial-regen route
   stays **owner-only forever**. No `assertAccess()` helper needed
   — just a single helper for the preview + comments routes.
D. **"Range" picker UX** — two number inputs labelled "من" / "إلى",
   defaulting to 1 and `slideCount`. Standard interpretation.

**Schema (locked)**:

```prisma
enum ProjectAccessLevel {
  edit
  comment
  view
}

model Project {
  ...
  // "Anyone with the link" public access. Null = link disabled
  // (only owner can open). Non-null = the access level granted
  // to anyone who opens the link while logged in. Edit-level
  // triggers an auto-clone (see invitation flow below).
  publicAccessLevel ProjectAccessLevel?
  // "Hide Made with Taqreer badge" toggle. Plan-gating wired
  // later; column stored regardless.
  hideBrandingBadge Boolean @default(false)
  ...
  shares ProjectShare[]
}

model ProjectShare {
  id           String              @id @default(cuid())
  projectId    String
  // Invitee email. Always present for emailed invites.
  email        String
  // Resolved User row, set on accept. NULL until accepted.
  userId       String?
  accessLevel  ProjectAccessLevel
  invitedBy    String              // owner's User.id
  invitedAt    DateTime            @default(now())
  acceptedAt   DateTime?
  // Random token in the invite email link. Cleared after accept.
  inviteToken  String?             @unique

  project      Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user         User?               @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([projectId, email])      // one invite per email per project
  @@index([projectId])
  @@index([userId])
}
```

**Auto-clone semantics (Edit invites)**:

- When invitee accepts an Edit invitation OR opens a publicly
  Edit-enabled link, the project is duplicated into their account:
  - New `Project` row (new id, ownership = invitee), copy
    `title`, `format`, `language`, `tone`, `aiPrompt`,
    `templateId`, `brandKitId`, `dominantColor`, `slideCount`.
  - New `Presentation` row + clone of the latest completed
    `PresentationVersion` (single version, fresh).
  - `SlideState` + `SlideVersion` rows cloned to seed the
    invitee's history at v1.
  - `thumbnailUrls` populated by dispatching `deck.thumbnails.render`
    against the new projectId — same Inngest function, fresh
    storage path under the invitee's user folder.
  - Original project + share row untouched. `acceptedAt` set.
- The invitee's `/preview` URL is `/preview/<new id>`. They edit
  freely; the owner doesn't see their changes.
- For View / Comment invites: no clone. Invitee opens the
  owner's original `/preview/<original id>`.

**Files (proposed)**:
- `components/app/ShareModal.tsx` (new)
- `lib/access/preview-access.ts` (new) — `resolvePreviewAccess(projectId, userId)`
  → returns `{ level: "owner" | "edit" | "comment" | "view" | null, redirectTo?: string }`.
  Used by `/preview/[id]` page + comments routes.
- `lib/email/send.ts` (new) — Resend client + invite template.
- `lib/projects/clone.ts` (new) — `cloneProject(sourceProjectId, newOwnerId)`
  returns new projectId. Used by invitation accept flow.
- `app/api/projects/[id]/share/route.ts` — owner-only:
  GET (list shares + publicAccessLevel), POST (create invite + send email),
  PATCH (update publicAccessLevel), DELETE share by id.
- `app/api/projects/[id]/export/png/route.ts` — server-side PNG
  ZIP via Puppeteer. Range support via `?from=&to=`.
- `app/api/invitations/[token]/accept/route.ts` — link target from
  the invitation email. Resolves token → ProjectShare → on Edit
  invites runs `cloneProject` + redirects to new `/preview`.
  On View/Comment invites just sets `acceptedAt` + `userId` and
  redirects to the original `/preview/[id]`.
- `prisma/schema.prisma` + new migration.

**Implementation phasing (proposed for the Share modal alone)**:

| Phase | Scope |
|-------|-------|
| 15.1 | Schema migration + Resend setup (`lib/email/send.ts` with invite template) |
| 15.2 | Share modal UI (form state only, no backend yet) — opens from 3-dots menu's "Share..." item |
| 15.3 | Public-access toggle backend (POST /api/projects/[id]/share + `/preview` access gate + login redirect) |
| 15.4 | Email invite backend (POST /api/projects/[id]/share invite, accept route, clone helper, email template) |
| 15.5 | PNG export (`/api/projects/[id]/export/png` + Range params + "Made with Taqreer" badge added to PNG output) |
| 15.6 | LinkedIn share button + "Copy share link" button |
| 15.7 | PDF export (final step, deferred) |

---

## Schema state

### Already added (don't add again)

```prisma
model Project {
  ...
  thumbnail     String?         // legacy single-image (untouched)
  thumbnailUrls String[]        // ← step 8, per-slide WebPs
  slideCount    Int?            // ← capture location: WRONG (in /save), MUST MOVE to deck-generate
  dominantColor String?         // ← same — MUST MOVE to deck-generate
  isFavorite    Boolean @default(false)  // ← already exists, no migration needed
  ...
  @@index([userId, isFavorite])
}

model Presentation {
  ...
  savedVersionId       String?
  savedSlideVersions   Json?  // ← step 7f
}
```

### Migrations to add

For Share feature (step 15.1):
- New enum `ProjectAccessLevel` (edit / comment / view)
- `Project.publicAccessLevel ProjectAccessLevel?`
- `Project.hideBrandingBadge Boolean @default(false)`
- New `ProjectShare` table (see Schema section above)

**Trash**: hard delete — NO `deletedAt` column. `DELETE
/api/projects/[id]` removes the row + cascades to Presentation,
Versions, SlideStates, Jobs, Comments, Files, ProjectShares.
Storage cleanup: also delete thumbnails from `slide-previews` bucket
under that project's path. Confirmation modal on the 3-dots
"Send to trash" item.

---

## File inventory (touched / to touch)

### Components

- ✅ [components/app/ProjectThumbnail.tsx](components/app/ProjectThumbnail.tsx) — also owns menu open state + inline rename mode + favorite optimistic state
- ✅ [components/app/ProjectLightbox.tsx](components/app/ProjectLightbox.tsx)
- ✅ [components/app/RecentProjects.tsx](components/app/RecentProjects.tsx) — tile chrome + deleted-set filter
- ✅ [components/app/ProjectActionsMenu.tsx](components/app/ProjectActionsMenu.tsx) — 3-dots menu portal
- ✅ [components/app/TrashConfirmDialog.tsx](components/app/TrashConfirmDialog.tsx) — destructive confirm modal
- ✅ [components/create/controls.tsx](components/create/controls.tsx) — LanguagePills + LanguageCode
- ⏳ Sidebar / DashboardShell — update `/features` link (step 12a)

### Routes & API

- ✅ [app/api/projects/[id]/save/route.ts](app/api/projects/[id]/save/route.ts)
- ⏳ Same file — REMOVE slideCount + dominantColor writes (step 8b)
- ✅ [app/api/projects/[id]/favorite/route.ts](app/api/projects/[id]/favorite/route.ts) — PATCH (step 9f)
- ✅ [app/api/projects/[id]/route.ts](app/api/projects/[id]/route.ts) — PATCH (rename) + DELETE (hard delete + storage cleanup) (step 9f)
- ✅ [app/api/projects/route.ts](app/api/projects/route.ts) — Language A pipeline (validates + persists user-picked language)
- ⏳ `app/(app)/projects/page.tsx` — rewrite stub (step 11)
- ⏳ `app/(app)/favorites/page.tsx` — rename from `features` (step 12a)
- ⏳ `app/create/from/[projectId]/page.tsx` — NEW (step 13)
- ⏳ `app/api/projects/[id]/share/route.ts` — NEW (step 15)
- ⏳ `app/api/invitations/[token]/accept/route.ts` — NEW (step 15)
- ⏳ `app/api/projects/[id]/export/png/route.ts` — NEW (step 15.5)

### Inngest / server modules

- ✅ [inngest/functions/thumbnail-render.ts](inngest/functions/thumbnail-render.ts)
- ✅ [inngest/functions/deck-generate.ts](inngest/functions/deck-generate.ts) — Language B LANGUAGE directive injected in `buildUserMessage`; streaming narrowing widened to AR/EN (no BI)
- ⏳ Same file — ADD slideCount + dominantColor writes (step 8b)
- ✅ [lib/export/sanitize-server.ts](lib/export/sanitize-server.ts)
- ✅ [lib/export/html-document-server.ts](lib/export/html-document-server.ts)

### SSR pages

- ✅ [app/(app)/dashboard/page.tsx](app/(app)/dashboard/page.tsx) — select clause done; will likely add `createdAt` for the date overlay
- ✅ [app/(app)/preview/[projectId]/page.tsx](app/(app)/preview/[projectId]/page.tsx) — SavedVersionId + SavedSlideVersions hooked

---

## Design system non-negotiables

(From `globals.css` header + memory `feedback_design_system_discipline` +
`feedback_tw_glass_system`. Re-read [app/globals.css](app/globals.css#L1-L141)
before any visual work.)

1. **Never hardcode** hex / rgba / blur / radius numbers in TSX. Compose
   from tokens or existing classes.
2. **Read globals.css header BEFORE writing any new visual.** Four
   patterns:
   - Normal button → `.btn-pill`
   - CTA → `.btn-gradient`
   - Layout surface (popover/menu/modal) → `.glass-popover` /
     `.glass-modal` + Tailwind `backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]`
   - AI button → `.btn-gradient-anim`
3. **Glass surfaces**: backdrop blur via the Tailwind utility, NEVER raw
   `backdrop-filter:`. Glass elements must have NO transform / opacity ≠ 1
   in their ancestor chain (creates a stacking context that traps
   backdrop-filter). Self-transform / self-opacity on a glass element is OK.
4. **RTL**: dashboard runs `dir="rtl"`. Logical CSS properties
   (`start`/`end`) auto-flip; physical (`left`/`right`) don't. Scrub +
   keyboard nav follow Arabic reading direction (rightmost = first,
   ← advances).

---

## Resolved decisions

- ✅ **Trash**: hard delete (no soft-delete column). Confirmation modal.
- ✅ **Share modal**: full spec captured in step 15 above. Decisions in
  the "Decisions locked" subsections.
- ✅ **Email provider**: Resend.
- ✅ **Edit-access semantics**: auto-clone, no shared editing.
- ✅ **`/create/from/[projectId]`**: option (a) — content-only page,
  pre-filled brand from source.
- ✅ **Content language picker**: user-explicit 2-bucket pick
  (`العربية` / `الإنجليزية`) on `/create/content` row 1, right card.
  `Project.language` is now truthful per user-pick — Step 11c's
  language filter is unblocked. The "BI" bucket from an early draft
  was retired same day; AR already covers bilingual content under
  the existing prompt's LANGUAGE & DIRECTION rules.
- ✅ **`fixTypos` toggle**: retired 2026-05-20. Model preserves user
  text verbatim by default; tone/correction picks deferred to a
  future per-language settings drawer.

## Deferred refactors (low-priority, called out by the 2026-05-20 audit)

Documented here so they're not lost; not on the active build order.

- **File splits**: `app/create/brand/page.tsx` (2190 lines) → extract
  `ScreenshotExtractionPane`, `CompactUploadZone`, `FontUploadSlot`,
  `BrandColorRow`, `extractDominantColors`, persistence helpers.
  `components/preview/DeckView.tsx` (1785 lines) → extract
  `useDeckRealtime`, `useSaveProject`, `useSlideHistory` hooks.
  `lib/export/bidi-postprocess.ts` (1122 lines) → split passes
  into `lib/export/bidi/{pass-1,...}.ts`. `inngest/functions/
  deck-generate.ts` (1056 lines) → move `SYSTEM_PROMPT` to
  `inngest/prompts/deck-system.ts`.
- **API route helper migration**: `lib/api/project-context.ts`
  exists (steps 7+ use the inline pattern); migrate the existing
  10 `/api/projects/[id]/*` routes one at a time when touching
  them for other reasons. Risky to do all in one pass.
- **Z-index centralisation**: layers in use are 30 / 40 / 50 /
  1000-1001 / 1050 / 1099 / 1100 / 2000-2001 / 9999. Settings
  modal (z-50) renders behind Sidebar profile dropdown (z-9999) —
  cosmetic bug. Centralise in `lib/ui/z-index.ts` or as CSS tokens
  when the layering causes a real issue.
- **Spike pages**: `/spike`, `/spike-pills` are publicly routable.
  Either move under `app/_spike/` (Next ignores `_`-prefixed
  private folders → harness becomes inaccessible — not useful) OR
  gate via NODE_ENV guard → 404 in prod. Pick a strategy when the
  team is sure the harnesses don't need prod debugging.

## Still open (ask before coding)

1. **Rename UX** — inline edit on the dashboard tile, or modal?
   Affects step 9f's "Rename..." menu item.
2. **Color filter palette** — confirm the 10-color list
   (black / white / red / orange / yellow / green / teal / blue / violet / magenta).
3. **HSL hue ranges** for color bucket matching — confirm defaults:
   - black: L < 15%
   - white: L > 90%
   - red: H ∈ [340°, 360°] ∪ [0°, 20°]
   - orange: H ∈ [20°, 50°]
   - yellow: H ∈ [50°, 80°]
   - green: H ∈ [80°, 160°]
   - teal: H ∈ [160°, 200°]
   - blue: H ∈ [200°, 250°]
   - violet: H ∈ [250°, 290°]
   - magenta: H ∈ [290°, 340°]
4. **Sort options** on /projects — recent / oldest / name A-Z / name Z-A.
   Anything else?
5. **"Made with Taqreer" badge plan-gating** — toggle works regardless of
   plan for now; final plan-tier rules are TBD.
6. **`/preview/[id]` access gate** — confirm: when a NOT-logged-in user
   opens a shared link, they're redirected to `/auth/login?next=/preview/[id]`.
   When the LOGGED-IN user has no share entry and isn't the owner, what
   do they see — 403 page, 404, or "you need access" CTA that shows the
   project title + an "ask for access" link?

---

## Memory pointers (read before drift)

- [`feedback_design_system_discipline`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_design_system_discipline.md)
- [`feedback_tw_glass_system`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_tw_glass_system.md)
- [`feedback_discuss_before_coding`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_discuss_before_coding.md)
- [`feedback_never_guess`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_never_guess.md)
- [`feedback_delete_failed_fixes`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_delete_failed_fixes.md)
- [`feedback_badge_blue`](~/.claude/projects/-Users-osama-taqreer/memory/feedback_badge_blue.md)
- [globals.css header (single source of truth for visual primitives)](app/globals.css#L1-L141)
