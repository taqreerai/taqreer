# Taqreer — App Architecture & Design-System Map

> A reference map of the app: stack, routes, i18n, theming, design system,
> components, flows, backend. **Line numbers are approximate** — grep the symbol,
> don't trust `:NN`. Last reviewed 2026-06-13.

## Contents
1. [Stack & top-level layout](#1-stack--top-level-layout)
2. [Route tree](#2-route-tree)
3. [i18n / bilingual (the differentiator)](#3-i18n--bilingual)
4. [Theming (light / dark)](#4-theming-light--dark)
5. [App shell & layout chrome](#5-app-shell--layout-chrome)
6. [Design system (flat, blue)](#6-design-system-flat-blue)
7. [Reusable component inventory](#7-reusable-component-inventory)
8. [User flows](#8-user-flows)
9. [Backend & data](#9-backend--data)
10. [Conventions & gotchas](#10-conventions--gotchas)

---

## 1. Stack & top-level layout

- **Next.js 16 App Router** (Turbopack), React 18/19, TypeScript `strict`.
- **Tailwind v4, CSS-first** — no `tailwind.config`; theme lives in `@theme` / `@theme inline` blocks inside [app/globals.css](app/globals.css). Lightning CSS minifier (quirks — see §10).
- **Bilingual (Arabic + English)** — every page URL carries a locale segment (`/ar/…`, `/en/…`). `<html dir>` + `<html lang>` are set per-locale by the `[lang]` layout. RTL/BiDi quality is the product differentiator (see §3).
- **Light + dark themes** — `tq_theme` cookie, SSR-applied, no flash (see §4).
- **Data**: Prisma → Postgres (dev: docker-compose `localhost:5432`; prod: server-local `taqreer_prod`). **Supabase** = auth + storage + realtime only (NOT the app DB; same Supabase project serves dev AND prod).
- **Generation**: Anthropic Claude (Opus 4.8 default) streams HTML slides via **Inngest** background jobs; gpt-image-2 for generated images.
- **Edge gate**: [proxy.ts](proxy.ts) (Next middleware) — redirects bare URLs to a locale prefix, applies the **coming-soon gate** (`COMING_SOON=1` env → every page rewrites to `/{lang}/coming-soon` unless the `tq_preview` cookie is set; `/preview?key=<COMING_SOON_KEY>` sets it; API routes never gated), then refreshes the Supabase session. Skips locale+session work for static files.
- **Production**: LIVE at https://taqreer.ai on Hetzner — see [deploy.md](deploy.md). `./deploy.sh` rsyncs the LOCAL tree, builds on the server, atomic-swaps, pm2-reloads, and pushes dev+main to GitHub.
- **Root layout**: [app/[lang]/layout.tsx](app/[lang]/layout.tsx) — Cairo + Poppins fonts, `<html dir lang>` from the locale, `themeClass` from the `tq_theme` cookie, Material Symbols, wraps children in `LocaleProvider` (dictionary → client).

---

## 2. Route tree

Everything lives under `app/[lang]/`. `[lang]` ∈ `{ ar, en }` (`lib/i18n/config.ts`).

### `app/[lang]/page.tsx` — landing (public)
Hero, features, BiDi demo band, pricing, templates, footer. `LandingNav` carries the logo, links, **theme toggle + language menu**, and login/signup (authed → Dashboard).

### `app/[lang]/(auth)/*` — auth modal over a marquee wall ([layout](app/[lang]/(auth)/layout.tsx))
`/login`, `/signup`, `/forgot-password`, `/reset-password`. Flat `surface-modal` (no glass). `login` sanitizes the user-controlled `?next=` to internal paths only (open-redirect guard).

### `app/[lang]/(app)/*` — protected; wrapped by `DashboardShell` ([layout](app/[lang]/(app)/layout.tsx))
Auth-gated SSR (redirects to `/[lang]/login?next=`).

| Route | Purpose | Shell mode |
|---|---|---|
| `/dashboard` | Home: QuickActions + HomeLibrary (projects ⇄ templates) | default |
| `/projects`, `/favorites`, `/templates`, `/library` | grids (client filter + paginate) | default |
| `/brand-kits`, `/brand-kits/new` | saved brand identities | default |
| `/settings` | plan banner + profile / password / delete; label-start control-end `.settings-row` rows | default |
| `/plans` | plan summary, change-plan cards (landing-size, popular pill), top-up packs (subscriber-only) | default |
| `/billing` | money admin: cancel/resume + payment methods (SetupIntent) + dunning; `BillingTabs` ties plans/billing/invoices | default |
| `/invoices` | invoice history + Stripe hosted PDFs | default |
| `/checkout`, `/checkout/return` | OUR Elements payment form (Checkout Sessions `ui_mode: elements`); return page auto-redirects to `/dashboard` on success | default |
| `/create`, `/enhance`, `/mimic`, `/datasheet`, `/use-template/[id]` | the 4 creation flows | flow |
| `/project/[projectId]` | **unified studio** — generation AND editing (`DeckView`) | studio (chrome-less) |
| `/preview/[projectId]` | back-compat redirect → `/project` | — |
| `/coming-soon` | pre-launch gate page (proxy rewrites here while `COMING_SOON=1`) | public |

---

## 3. i18n / bilingual

The defining feature. Two **independent** direction axes:
- **Chrome direction** = the UI locale. `<html dir>` is set by the `[lang]` layout; everything in the app shell mirrors with it. Logical CSS only (`start`/`end`, `ms`/`me`, `text-start`, `inset-inline-*`) — never physical `left`/`right`/`ml`.
- **Canvas direction** = the deck's `manifest.direction`. A slide's text direction is independent of the chrome (an Arabic user can edit an English deck). The BiDi demo + the Arabic font specimen are the deliberate exceptions that stay Arabic-aware regardless of locale.

**Machinery**
- `lib/i18n/config.ts` — `locales`, `defaultLocale`, `isLocale`, `dirForLocale`, `LOCALE_COOKIE` (`tq_locale`).
- `lib/i18n/dictionaries.ts` — server-only loader; `getDictionary(locale)` dynamic-imports `dictionaries/{ar,en}.json`. The `Dictionary` type is inferred from `en.json`; `ar.json` must stay structurally identical (key parity).
- `dictionaries/en.json` / `ar.json` — ~895 keys. en is the reference shape.
- `components/i18n/LocaleProvider.tsx` — `useDict()` + `useLocale()` (`{ locale, dir }`) for client components.
- `lib/i18n/navigation.ts` — `localizedHref(path, locale)` (prefix the locale for internal links), `switchLocaleHref(path, next)` (swap the locale segment), **`stripLocale(path)`** (call this before ANY pathname comparison — pathname is `/ar/dashboard`).
- `components/i18n/LanguageMenu.tsx` — the translate-icon dropdown (cookie + `PATCH /api/me` + `router.push(switchLocaleHref)`).
- `proxy.ts` locale-gates bare URLs.

**Rules**: bilingual = translate **and** mirror direction in the same pass; **Latin numerals only (0–9)** even inside Arabic copy (never ٠–٩); internal links use `localizedHref`.

---

## 4. Theming (light / dark)

Dark is the primary brand mode; light is a first-class shadcn-neutral theme.

- **Mechanism**: a `light` class on `<html>` flips the tokens. `tq_theme` cookie (`lib/ui-cookies.ts` `THEME_COOKIE`), read SSR in the `[lang]` layout → `themeClass` → no flash.
- **`components/app/ThemeToggle.tsx`** — flips the `.light` class + writes the cookie. Mounted in `TopUtilityBar`, `LandingNav`, and as a row in the Sidebar profile menu.
- **`:root.light { … }`** in globals.css overrides ONLY the neutral scale (shadcn light defaults) + the accent: `--tq-bg` white, `--tq-panel` soft gray (`#F2F2F2`), `--tq-card #F7F7F7`, `--tq-surface` white, text `oklch(0.145)`, muted `oklch(0.556)`, hairline `oklch(0.922)`. **Light flips the dashboard gutter (white) ↔ rounded content panel (gray)** vs dark.
- **Theme-aware overlays**: `--tq-overlay-soft/-/-strong` (white-alpha on dark, black-alpha on light) → the `bg-overlay-*` utilities. `--tq-dot`, `--tq-studio-dot`, `--logo-invert` likewise.
- **`@theme inline`** maps `--color-foreground/-muted-foreground/-border/-overlay-*/-background/-surface` to the flip-aware `--tq-*` tokens, so `text-foreground` / `border-border` / `bg-surface` flip automatically.
- **Logo**: `components/brand/ThemeLogo.tsx` renders both `/logo-light.svg` (white) and `/logo-blue.svg` (solid `#0057FF`) and CSS-swaps on `:root.light` (`.logo-on-dark` / `.logo-on-light`) — no JS, no flash. Used in LandingNav, footer, Sidebar, auth.

---

## 5. App shell & layout chrome

### [components/app/DashboardShell.tsx](components/app/DashboardShell.tsx)
Client shell: the thin Sidebar rail + the rounded content panel + `<main>`. There is no top header — chrome lives in the Sidebar profile menu + `TopUtilityBar`. Content is offset from the rail via `marginInlineStart: SIDEBAR_WIDTH + 8`. Route-aware panel:
- **studio** (`/project`,`/preview`): chrome-less `studio-canvas` (DeckView paints its own panels).
- **flow** / **default**: content wrapped in **`.tq-content-panel`** (rounded 18px, 8px gutter on all sides). Home/flows get `.tq-panel-glow` / `.tq-panel-flow`; other pages `.tq-panel-gray`.

### [components/app/Sidebar.tsx](components/app/Sidebar.tsx) — thin 60px icon rail
Floated `start-2` (8px off the inline-start edge), transparent (`.sidebar-bg`), fixed-width (icons only, no expand state). Logo/home → 4 create actions → nav links → profile button. Nav pills `.nav-item` / `.nav-active` (active fill is **theme-aware** `--tq-overlay-strong`). Icons `AnimatedIcon size={18}`. Tooltips are **portaled to body** (the rail clips them otherwise). **Profile dropdown** (portal, `role="menu"`): account · New project · Notifications · **Theme toggle** · **Language ›** (drilldown sub-view, instant swap) · Settings · Sign out.

### [components/app/TopUtilityBar.tsx](components/app/TopUtilityBar.tsx) — pinned to the content panel's top
`HealthDot` + search (⌘K command palette) on the start; **ThemeToggle + LanguageMenu** on the end.

### Dashboard home ([dashboard/page.tsx](app/[lang]/(app)/dashboard/page.tsx))
`QuickActions` (4 mesh-hover cards) + **`HomeLibrary`** (one card whose header is a projects ⇄ templates `SegmentedToggle`).

### Layout constants
| | value |
|---|---|
| Sidebar rail | 60px, floated `start-2` |
| Content panel | `.tq-content-panel` 18px radius, 8px gutter |
| Section gap | `space-y-16` (64px) |
| Page scroll | on `<body>` (not `<html>`) so the RTL scrollbar sits on the left |

### Backgrounds
`.tq-aurora` = a bottom-anchored, blurred, drifting **blue** ambient glow on the home dashboard (+ the editor). Flow pages are flat — dot texture only, no glow. `.studio-canvas` = dotted grid + bottom blue glow.

### Z-index ladder
`0` panel glow · `1` main · `30` TopUtilityBar · `50` Sidebar · `1100` action popovers · `1000/1001` dashboard modals · `9999` profile dropdown.

---

## 6. Design system (flat, blue)

**Single source of truth = [app/globals.css](app/globals.css)** — the header comment block is the legend. The system is **flat**: no blur, no shadow, no transparency-as-depth — opaque surfaces + hairline borders.

### One accent: BLUE
The brand runs on a **single blue accent**. The accent token is named `--tq-purple` (a legacy name) and resolves to blue; the aliases `--tq-blue / -violet / -magenta / -lavender` (+ their `-rgb`) all point at it.
- **Dark**: `--tq-purple #3380FF` (brighter accent) / `-hover #0057FF` (deeper) / `-rgb 51,128,255`.
- **Light** (`:root.light`): `--tq-purple #0057FF` (the main brand blue) / `-hover #0046CC` / `-rgb 0,87,255`.
- Blue ramp used by gradients/mesh/aurora: deep `#0042E0`, mid `#1E6BFF`, main `#0057FF`, bright `#3380FF`, light `#66A3FF`.
- **No purple/magenta anywhere** except `--tq-export-html` (violet) / `--tq-export-png` (magenta) — file-type icon tints (a deliberate categorical set alongside PDF=red/PPTX=orange), not brand accent.

### Surfaces (dark)
`--tq-bg #0A0A0A` (gutter) · `--tq-panel #161616` (content panel) · `--tq-card #111111` (inset: BiDi canvas, toggle track) · `--tq-surface oklch(0.205)` (cards + floating chrome). Light flips these (see §4).

### Gradients & glow (the only colour energy)
- **AI mesh** (`.btn-gradient-anim` button + `.canvas-gradient-border`): `@property`-registered `--mesh-x1..6`/`-y1..6` drift across 12 keyframes; an animated all-blue mesh stroke at rest, a full dark-blue mesh fill on hover. This is the "Claude does work here" signal — used sparingly.
- **Aurora** (`.tq-aurora-a/-b`): drifting blue radial blobs, heavy blur, bottom-masked. Home + editor only.
- `.text-gradient`, `--tq-gradient-brand/-full/-avatar` → all-blue ramps.

### Typography
**Cairo** (Arabic + Latin, `next/font`) is the only typeface. **Weight range 400–700 ONLY** — Regular (400) is the main weight and carries titles & display; Bold (700) is the max. **No Black/900 or ExtraBold/800.** Latin numerals only. (Poppins is loaded as `--font-poppins` but the body is `font-sans` = Cairo.)

### Utility classes
`.btn-pill` (secondary) · `.btn-gradient` (solid-blue primary CTA; light hover = darker, dark hover = brighter) · `.btn-gradient-anim` (AI mesh) · `.input-dark` / `.input-search` · `.dropdown-item` · `.nav-item`/`.nav-active` · `.badge-purple` (blue badge) · `.surface-card/-popover/-menu/-modal` · `.bg-overlay-{soft,-,strong}` · `.tq-content-panel` · `.tq-aurora*` · `.logo-monochrome` / `.logo-on-{dark,light}` · `.text-gradient` · `.hide-scrollbar`. All buttons pill-shaped, flat.

### Brand guidelines
**[public/brand-guidelines.html](public/brand-guidelines.html)** — a self-contained, downloadable spec for designers (logo, blue palette, Cairo type, components, glow usage), with a light/dark toggle. Live at `/brand-guidelines.html`.

### The 3 discipline rules (non-negotiable, user-flagged)
1. Never hardcode — use tokens / add a class to globals.css first.
2. Read the globals.css legend before any visual change.
3. Reuse existing primitives — never fork tokens, Cairo, `--tq-*`, or shared components.

---

## 7. Reusable component inventory

### Tier-1 primitives
- **Controls** ([components/create/controls.tsx](components/create/controls.tsx)): `SegmentedToggle<T>` (spring 500/35), `Toggle` (RTL, always-white knob), `PositionDropdown`, etc.
- **`GenerateSplitButton`** ([components/create/GenerateSplitButton.tsx](components/create/GenerateSplitButton.tsx)) — the AI split-button CTA (mesh); preset rows carry fast/thinking + tier-gate pills, gated rows open `UpgradeModal`.
- **`DesignStylePicker`** ([components/create/DesignStylePicker.tsx](components/create/DesignStylePicker.tsx)) — trigger row + gallery modal with static CSS mini-previews (monochrome + one blue), shared by all 4 flows.
- **Brand** ([components/brand/](components/brand/)): `CompactUploadZone`, `FontUploadSlot`, `GoogleFontSlot`, `LogoRow`, `LogoUploadSlot`, `AIImagesPanel`, **`ThemeLogo`**.
- **i18n / theme**: `LocaleProvider`, `LanguageMenu`, `ThemeToggle`, `TopUtilityBar`.
- **`ColorPickerPopover`**, **`Avatar`**, **`AnimatedIcon`** (+ `ParagraphWriteIcon`), **`SlideRenderer`**.

### Dashboard ([components/app/](components/app/))
`HomeLibrary`, `QuickActions`, `ProjectsGrid`, `ProjectThumbnail`, `TemplateTile`, `BrandKitTile`, `Pagination` (dir-aware chevrons), `PlanUsage`, `MyTemplates`, `Sidebar`, `DashboardShell`, `BellDropdown`, **`ProfileAvatar` + `ProfileMenuContent`** (extracted; Sidebar and the studio `UserMenu` compose them), **multi-select bulk delete** (`lib/hooks/useMultiSelect` + `SelectableTile` + `SelectionBar` + `BulkDeleteConfirmDialog` — select-all = visible page only; delete intersects with current-filter deletable ids).

### Billing ([components/billing/](components/billing/), [components/common/](components/common/))
`BillingSection` (the /plans body; `variant="modal"` + `minTier` reuse inside **`UpgradeModal`** — gated-preset upsell with in-modal **`EmbeddedCheckout`**, `redirect:'if_required'`), `BillingTabs`, `ManageBilling`, `InvoicesList`, `CreditGateDialog` (402 offers; opens UpgradeModal), **`NoticeCard`** (app-wide confirm/outcome pattern, bare glyphs — also the checkout return states). Credit store: [lib/credits/store.ts](lib/credits/store.ts) — ONE balance feeding the avatar ring, popup breakdown, and `PlanUsage` banner, ticked by the `credit.balance.changed` nudge. All meters read REMAINING (deplete-as-you-spend); `/plans` renders the shared `PlanUsage` card (`hideAction`) like `/billing`.

### Dialogs / portal menus
Sibling overlay+panel pattern on `surface-modal`: `NewProjectDialog`, `ShareDialog`, `SaveAsTemplateDialog`, confirm dialogs, `TemplateLightbox`, `AllNotificationsModal`. Menus: `ProjectActionsMenu`, `TemplateActionsMenu`, `BrandKitActionsMenu`, `ExportMenu`, `LanguageMenu`.

### Studio/editor ([components/preview/](components/preview/), [components/slides/](components/slides/))
`DeckView` (orchestrator), `SlideNavSidebar` (its footer holds the studio actions), `LayersPanel`, `CommentsPanel`, `HeroCommentOverlay`, `PreviewActionBar` (bottom toolbar), `SlideEditor` (iframe), `StylePill`/`MorePopover`/`FontControl`, `SlidePresenceStack`. Both floating rails are collapsible (bare edge-arrow toggles, auto-collapse <1280px) and anchored to one page band (`RAIL_TOP`/`RAIL_BOTTOM` in SlideNavSidebar) so they're equal-height + centered; the canvas is width-capped (`CANVAS_MAX_WIDTH`). ⌘Z/⌘⇧Z forward out of the `SlideEditor` iframe to DeckView's local history stack.

> Restyle guidance: token/CSS changes go in **globals.css**, not component edits. Reuse widget/dialog/menu chrome; honor chrome-dir + logical properties + portal-menu patterns.

---

## 8. User flows

All four creation flows share the 3-card layout (content / brand / output) and converge on `POST /api/projects → /project/[id]`.

- **/create** — text OR file (PDF/PPTX/DOCX/TXT). File → `POST /api/extract` then poll `/api/extract/[jobId]`. `source.kind = "scratch"`.
- **/enhance** — PDF/PPTX upload w/ XHR progress; returns fonts/colors/pageCount/language/textPerSlide; `source.kind = "enhance"` (preserve content + identity, redesign).
- **/mimic** — design reference → Anthropic doc; `source.kind = "mimic"`. `/use-template/[id]` = same flow seeded from a template.
- **/datasheet** — xlsx/csv → `POST /api/datasheet/parse` (sync) → markdown; `source.kind = "data"`.

**Generation prompt** lives in [inngest/functions/deck-generate.ts](inngest/functions/deck-generate.ts) — `SYSTEM_PROMPT_CREATE_HTML` (+ mimic/enhance addenda); LANGUAGE directive per flow; cover carries `data-deck-title` → `Project.title`.

**Studio** (`/project/[id]`, `DeckView`): generating shell (disabled, streaming) ⟶ seamless ⟶ editor (enabled). Edit = in-place content save; undo/redo = client stack; history = checkpoints on Save + 10-min idle. **Realtime events → in-place state updates, never `router.refresh`.**

---

## 9. Backend & data

### Prisma ([prisma/schema.prisma](prisma/schema.prisma))
```
User → Project → Presentation (1:1) → PresentationVersion (slideJson = full manifest)
                                     → SlideState → SlideVersion (per-slide history, capped 20)
Project → ProjectShare (view|comment|edit, inviteToken) · GeneratedImage · Comment (forAi → partial regen)
        · Job · BrandKit · Template
User → Notification · Subscription (Stripe mirror: stripeSubscriptionId/PriceId,
       cancelAtPeriodEnd, currentPeriodEnd — webhooks only write it)
     · CreditAccount → TopupGrant (FIFO by expiry, 12-mo) · CreditHold
     · UsageEvent · Folder        (User.locale persists the chrome locale;
StripeWebhookEvent = webhook idempotency claims; User.stripeCustomerId)
```
`Presentation.currentVersionId` = active; `savedVersionId` + `savedSlideVersions` = pinned saved snapshot.

### Inngest ([inngest/functions/](inngest/functions/))
`deck-generate` (brief → **holdCredits** → Claude streams `<section>` HTML → `StreamingHtmlSplitter` → `lib/deck/scope-css` + `lib/deck/scaffold` (scopes CSS under `.tq-canvas`, enforces the canvas frame, and mirrors `data-role` into the section class so role-name CSS like `.cover h1` resolves) → seed versions → manifest → **settleHold** → image-warm + thumbnails; release in onFailure; cancel keeps partial + charges streamed slides). Plus `deck-regenerate-partial` (hold/settle, jobKey `regen:{versionId}`), `credits-maintenance` (daily 03:00 — stuck holds >24h, top-up expiry, monthly drip), `deck-image-warm` (gpt-image-2, bill-once), `extract-source`, `brand-analyze`, `thumbnail-render` (Puppeteer→WebP), `template-render`. **Tier priority (Max perk, 2026-06-14)**: `deck-generate` + `deck-regenerate-partial` carry `priority.run = "event.data.tier == 'max' ? 120 : 0"`; the dispatching route stamps `tier` on the event from the project OWNER's plan (`tierForUser`, lib/inngest-helpers).

### Credits & billing ([lib/credits/](lib/credits/), [lib/billing/](lib/billing/))
- **Ledger** (`lib/credits/server.ts`): hold/settle/charge/grants/reset — all atomic via per-user `SELECT FOR UPDATE`, idempotent; balance changes broadcast a pointer-only `credit.balance.changed` nudge (clients refetch `GET /api/credits`).
- **Cost model** (`lib/credits/cost.ts`): TIERS free/plus/pro/max, TOPUP_PACKS x4, per-flow `estimateSlides`, `effectivePreset` (auto-upgrade DISABLED).
- **Preflight** (`lib/credits/preflight.ts`): gates flow/preset/cap/balance → 402 with reduce-slides / cheaper-preset / top-up options (brief slideCount pinned to holdSlides — the under-quote fix).
- **Stripe** (`lib/billing/`): server SDK (`stripe.ts`, apiVersion 2026-04-22.dahlia), catalog by lookup_key + grant metadata (`prices.ts`), customer get-or-create (`customer.ts`), browser singleton (`stripe-client.ts`), **Appearance builder** (`appearance.ts` — live tokens → opaque sRGB, alpha composited over the card).
- Signup grant (`lib/credits/signup.ts`): email-normalize dedupe + IP velocity 3/24h.

### API ([app/api/](app/api/))
Projects (create [**credit preflight 402**]/save/regenerate[-partial]/retry/cancel/status/favorite/share/export{pdf,png}), slides (`[slideKey]/{edit,checkpoint,restore,regen,lock,versions,images}`), comments, brand-kits, templates, extract, datasheet/parse, storage/upload, invitations/[token]/accept, notifications, `me` (locale persist), auth/{user-sync,delete-account}, **credits** (balance), **billing/summary** (plan + mirror state), **stripe/{checkout,portal,webhook,checkout/status}** (checkout returns the session client secret for the Elements form; webhook = sig-verified raw body + StripeWebhookEvent claims → ledger grants), **realtime/token** (HS256 mint, topics claim).

### Auth / realtime / storage
- **Access** ([lib/api/project-access.ts](lib/api/project-access.ts)): Supabase JWT → Prisma User; `resolveProjectAccess` owner > edit > comment > view (SSR + API both gate).
- **Realtime** ([lib/realtime/](lib/realtime/)): **private** `project:{id}` + `user:{supabaseUid}` channels + presence, authorized by a minted HS256 JWT with a `topics` claim (`GET /api/realtime/token`) + realtime.messages RLS policies; explicit `setAuth(token)` before subscribe. The `/status?includeManifest&includeSlideStates` fat-sync is the broadcast handler's refetch. Local dev → status poll fallback.
- **Storage**: Supabase buckets `slide-previews` (WebP, public), `generated-images` (public), `brand-assets`/`source-files` (private).
- **Export** ([lib/export/](lib/export/)): `dom-to-pptx` **patched via patch-package** (BiDi: bodyPr rtlCol + pPr rtl/algn + rPr lang=ar-SA), bidi-postprocess, render-deck-pdf.

---

## 10. Conventions & gotchas

- **`stripLocale(pathname)` before ANY pathname check** — the live pathname is `/ar/dashboard`. Internal links use `localizedHref`; locale switches use `switchLocaleHref`.
- **Two direction axes** — chrome dir (UI locale) vs canvas dir (manifest). Don't conflate. Use logical CSS only.
- **Latin numerals only** in user-facing copy.
- **No em dash** in any writing/copy/comments (user rule) — comma/colon/middot/hyphen instead.
- **Theme = a cookie + a `.light` class** — verify visuals in BOTH themes (flip and compare, don't eyeball one).
- **Turbopack sometimes serves a stale globals.css chunk** after an edit — make a second real content change to force a clean recompile, then verify via `document.styleSheets`.
- **`set-state-in-effect` is a lint error here** — derive initial state in the `useState` initializer, not a mount effect.
- **Page scroll is on `<body>`** (so the RTL scrollbar sits left); `scrollbar-gutter: stable` is required (modals lock `overflow:hidden`).
- **`dev` is the only working branch.** Never `git checkout -b`. Review by size (2026-06-13): small fixes deploy directly via `./deploy.sh` (auto-pushes dev+main); big changes PR `dev → main` for CodeRabbit BEFORE deploying.
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits, schema changes, Inngest prompt edits.
- Editor iframe reload needs `reloadKey` baked into `srcDoc` — see [components/preview/editor/SlideEditor.tsx](components/preview/editor/SlideEditor.tsx).
