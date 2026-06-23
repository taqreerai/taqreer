# Taqreer — System Reference (v0.1)

Taqreer is a bilingual (Arabic + English) AI presentation platform. A user provides
content and a brand; Claude designs each slide as **HTML**; the browser renders it
1:1; a patched `dom-to-pptx` plus a custom OOXML post-processor exports a
high-fidelity PPTX (and PDF/PNG/HTML). Decks are generated **and** edited inside one
in-canvas studio. **RTL/BiDi fidelity is the product differentiator** — the design
system is bidirectional, the export pipeline carries Arabic direction into OOXML, and
there are no separate RTL assets.

Live at **https://taqreer.ai**.

---

## Table of contents

1. [Stack](#1-stack)
2. [Branding & design system](#2-branding--design-system) → live ref: `/ar/brand`
3. [Routing, chrome & i18n](#3-routing-chrome--i18n)
4. [Auth](#4-auth)
5. [Creation flows](#5-creation-flows)
6. [Generation engine](#6-generation-engine)
7. [Export pipeline](#7-export-pipeline)
8. [The studio (DeckView)](#8-the-studio-deckview)
9. [Data model](#9-data-model)
10. [Credits & billing](#10-credits--billing)
11. [Platform services](#11-platform-services-realtime-notifications-storage-admin)
12. [Abuse & rate limiting](#12-abuse--rate-limiting)
13. [Infrastructure & deploy](#13-infrastructure--deploy)
14. [Environment variables](#14-environment-variables)
15. [API surface](#15-api-surface)
16. [Repository map](#16-repository-map)

---

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** App Router, Turbopack, React 18/19, TypeScript `strict` |
| Styling | **Tailwind v4** CSS-first (`@theme` blocks in `app/globals.css`, no `tailwind.config`) |
| ORM / DB | **Prisma** → **Supabase Pro Postgres** (eu-central-1, session-mode pooler) in prod; Docker Postgres on `localhost:5432` in local dev |
| Auth / storage / realtime | **Supabase** (email + Google OAuth, Storage buckets, Realtime broadcast channels) |
| Generation | **Anthropic Claude** (Opus 4.8 default model) streaming `<section>` HTML, orchestrated by **Inngest** jobs; **gpt-image-2** for AI images |
| Billing | **Stripe** (Checkout Sessions `ui_mode: elements`, webhook → credit ledger) |
| Hosting | **Hetzner** CPX22 (Ubuntu 24.04) behind **Cloudflare**: nginx 443 → pm2 `taqreer-prod` (`next start` :3100) + pm2 `taqreer-inngest` (self-hosted Inngest dev server :8288) |
| Monitoring | **Sentry** (errors + source maps) + **PostHog** EU (consent-gated capture + Query-API read) |
| Bot defense | **Cloudflare Turnstile** on signup / login / forgot-password |

There is no test runner. Everyday commands: `npm run dev` (:3000), `npm run build`,
`npm run lint` (`eslint .`, flat config in `eslint.config.mjs`), `npx prisma migrate
dev --name x`, `npx prisma studio`, one-off ops via `tsx scripts/*.ts`.

---

## 2. Branding & design system

**The living, canonical brand reference is the `/ar/brand` route**
(`app/[lang]/brand/page.tsx`). It imports `app/globals.css` and renders every token,
class, and UI pattern **live** (flip dark ↔ light in-page), so it can never drift from
the real system. **`app/globals.css` is the single source of truth for visual
primitives** — new UI composes existing tokens/classes; nothing invents hex values,
radii, or background recipes in TSX.

Key brand facts (the full reference is `/ar/brand`):

- **One accent: blue.** The accent token is named `--tq-purple` (legacy name) and
  resolves to **blue** — `#3380FF` on dark, `#0057FF` on light. Aliases `--tq-blue`,
  `--tq-violet`, `--tq-magenta` all point at it. No purple/magenta anywhere.
- **Flat + solid (shadcn-style).** Surfaces are solid `--tq-surface` with a hairline
  border — **no blur, no shadow, no transparency**. Elevation is a fill scale:
  `--tq-bg` (#0A0A0A page gutter) → `--tq-panel` (#161616 content panel) → `--tq-card`
  (#111111 inset) → `--tq-surface` (#1E1E1E cards/menus/modals).
- **Typeface: Cairo** only (weights 400–700), Arabic + Latin in one family.
- **Theming.** A `.light` class on `<html>` flips every token; the `tq_theme` cookie is
  read SSR so there is no flash. Dark is primary; light is shadcn-neutral.
- **Four UI patterns** cover almost everything:
  1. `.btn-pill` — secondary button (pill, subtle gray fill, white text).
  2. `.btn-gradient` — primary CTA (pill, **solid** blue fill; the "gradient" in the
     name is legacy).
  3. `.surface-card` / `.surface-menu` / `.surface-modal` / `.surface-popover` —
     layout surfaces (solid surface + hairline border).
  4. `.btn-gradient-anim` — **AI** button (animated mesh-gradient stroke, hover fill);
     the brand cue for "this triggers a Claude call". Sibling `.canvas-gradient-border`
     applies the same ring to the studio canvas in comment mode.
- **Numerals:** Latin digits `0-9` only in user-facing copy, even inside Arabic strings.
- **No em dash** in any copy/comment/commit; comma/colon/hyphen instead.
- Other primitives: `.badge-purple`, `.input-dark`, `.nav-item`/`.nav-active`,
  `.bg-overlay-{soft,strong}`, `.tq-content-panel`, `.studio-canvas`, the `.tq-aurora`
  animated glow, status tokens (`--tq-status-{ok,warn,down}-*`), and Material Symbols
  icon sizing helpers.

---

## 3. Routing, chrome & i18n

### Edge middleware — `proxy.ts`

Runs on every non-API, non-static request (matcher excludes `_next/static`,
`_next/image`, `favicon.ico`, `api/extract`, `api/storage` — the last two bypass so
large multipart uploads are not truncated). In order:

1. **Locale-prefix redirect** — every page URL must carry `/ar` or `/en`. Bare URLs
   redirect using the `tq_locale` cookie, falling back to `ar` (Arabic-first, no
   Accept-Language sniffing).
2. **Coming-soon gate** — when `COMING_SOON=1`, all pages rewrite to
   `/{lang}/coming-soon` unless the `tq_preview` cookie is set (via
   `/preview?key=<COMING_SOON_KEY>`, 30-day TTL); legal routes stay public. Currently
   off (`COMING_SOON=0`).
3. **Supabase session refresh** — refreshes the auth cookie.
4. **Auth gates** — protected app paths without a session redirect to
   `/{lang}/login?next=…`; auth pages with a session bounce to a validated `next`.

### Route tree (`app/[lang]/`, `lang ∈ {ar, en}`)

Root layout `app/[lang]/layout.tsx` sets `<html dir>` from the locale, loads Cairo,
applies the theme class from `tq_theme`, and mounts `LocaleProvider`,
`PostHogProvider`, and the cookie banner.

- **`/`** — public marketing landing (`page.tsx`): hero with an interactive dashboard
  preview, trusted-by logo marquee, flow cards, the BiDi feature band, templates,
  pricing tiers, FAQ, footer.
- **`(auth)/`** — glass-modal auth on a marquee background:
  `login`, `signup`, `forgot-password`, `reset-password`, plus `callback/route.ts`
  (OAuth code exchange) and `confirm/route.ts` (email OTP verify).
- **`(app)/`** — authenticated dashboard shell (`(app)/layout.tsx` verifies the session
  via `getUser()`, redirects banned users to `/banned`, and reads `User.role`):
  - Hub: `dashboard`, `projects`, `templates`, `library` (image library), `brand-kits`,
    `favorites`.
  - Flows: `create`, `create/generating`, `enhance`, `mimic`, `datasheet`.
  - Workspace: **`project/[projectId]`** (the studio), `preview/[projectId]`
    (read-only), `use-template/[id]` + `use-template/project/[id]`.
  - Account & billing: `settings`, `plans`, `billing`, `invoices`, `checkout`,
    `checkout/return`, `usage`.
  - **`admin/`** (role-gated, forced LTR English): `page.tsx` (Overview), `users`,
    `templates`, `broadcast`.
- **`(legal)/`** — `terms`, `privacy`, `refund`, `contact` (share the landing
  nav/footer).
- Standalone: `coming-soon`, `banned`, **`brand`** (live design-system reference),
  `lab/svg-animations` (dev-only BiDi tuning harness), and a catch-all 404.

### Dashboard chrome

`components/app/DashboardShell.tsx` chooses a layout per surface (full-bleed dotted
canvas for the studio, centered 1280px for flows, aurora-glow panel for the hub,
flat panel for lists). The **Sidebar** is a fixed, always-collapsed icon rail (logo,
the 4 flow action buttons, 6 library/tool nav links, an admin entry for admins, and a
profile menu at the bottom). The **TopUtilityBar** carries search (⌘K palette), the
notification bell, a plan badge, a server-health dot, and the theme + language toggles.

### i18n — two independent direction axes

- **Chrome direction** — driven by the UI locale via `<html dir>` (ar → rtl, en → ltr).
  Governs nav, sidebar, chrome.
- **Canvas direction** — driven by the deck's `manifest.direction`. An Arabic user can
  edit an English (LTR) deck inside RTL chrome.

Dictionaries live in `dictionaries/{ar,en}.json` (en is the reference shape; the two
must stay key-parity). Server reads via `getDictionary(locale)`; client reads via
`useDict()` / `useLocale()` (`components/i18n/LocaleProvider.tsx`). Navigation helpers
(`lib/i18n/navigation.ts`): `localizedHref` (prefix internal links), `switchLocaleHref`
(language toggle), `stripLocale` (**call before any pathname comparison** — the live
path is e.g. `/ar/dashboard`). Locale persists in the `tq_locale` cookie and the Prisma
`User.language` column.

---

## 4. Auth

Supabase auth with email/password and Google OAuth. The signup form is single-step
(name + email + password with a live password-rules checklist); login and
forgot-password are single forms. All three carry a Turnstile captcha (the Turnstile
**secret** lives in the Supabase Auth dashboard, not in the repo).

After signup/login the client calls **`POST /api/auth/user-sync`**, which: upserts the
Prisma `User` from the Supabase identity; **grants signup credits once** (400 credits,
guarded by `CreditAccount.signupGrantedAt`, with email-alias-dedupe and IP-velocity
abuse checks); seeds the `tq_locale` cookie from `User.language`; and fires a welcome
email. OAuth lands on `(auth)/callback/route.ts` (code exchange + user upsert); email
links land on `(auth)/confirm/route.ts` (OTP verify for signup confirm, recovery, and
email-change).

The `(app)` layout enforces auth with a `getUser()` round-trip (not just the cookie)
and redirects users with `User.bannedAt` set to `/banned`.

---

## 5. Creation flows

Four flows, each a single page that shares one set of primitives
(`components/create/*`, `components/brand/*`: `CardHeader`, `SegmentedToggle`, `Toggle`,
`InlineStepper`, `ColorPickerPopover`, `BrandFontPicker`, `LogoRow`,
`CompactUploadZone`, `BrandKitDropdown`, `AIImagesPanel`, `DesignStylePicker`,
`GenerateSplitButton`). All hydrate brand inputs (palette, fonts, logo) from the user's
default brand kit.

| Flow | Route | Ingests | Produces |
|---|---|---|---|
| **Create** | `/create` | Text brief (or a content file) + brand + output settings | A new deck from scratch |
| **Enhance** | `/enhance` | An existing deck (PDF/PPTX) + brand | A redesigned deck preserving the source content/images |
| **Mimic** | `/mimic` | A reference deck (or template) + content + brand | A new deck in the reference's visual style |
| **Datasheet** | `/datasheet` | A spreadsheet (XLSX/XLS/CSV) + brand + extra instructions | A deck with charts built from the data |

Each card carries: content/source, a consolidated brand-identity card (palette + fonts
+ logo + save-as-default, plus an AI-images panel where relevant), and output settings
(slide size 16:9 / 9:16, slide count auto/custom, slide numbering, design-style picker,
persistent footer). The CTA is `GenerateSplitButton` (Generate + a quality/preset
split menu).

---

## 6. Generation engine

### Pipeline

1. **`POST /api/projects`** — authenticates; validates and sanitizes brand inputs
   (logo SVG sanitized; font URLs allowlisted to `fonts.googleapis.com` /
   `fonts.gstatic.com`); runs the **credit preflight** (flow + preset allowed for tier,
   estimated slide count ≤ tier cap, cost ≤ balance, else 402 with reduce/top-up
   offers); creates `Project` + `Presentation` + `PresentationVersion` + `Job` rows in
   one transaction; dispatches the Inngest event `deck.generate.requested`.
2. **Inngest `deck-generate`** (`inngest/functions/deck-generate.ts`):
   - **Hold credits** (idempotent on `jobKey`).
   - **Enhance prep** (enhance flow only): rasterize the source PDF/PPTX to per-slide
     PNGs, upload them transiently to the Anthropic Files API.
   - **Stream from Claude** — `client.messages.stream()` with an HTML-authoring system
     prompt + flow-specific addenda. Text deltas are split on `</section>` boundaries by
     `StreamingHtmlSplitter`; each slide's CSS is scoped under `.tq-canvas` and wrapped
     in the canvas frame by `buildSlideHtml`. Live-preview snapshots broadcast to the
     studio while streaming; the stream polls `Job.cancelRequestedAt` every ~2s and
     keeps whatever slides finished if cancelled.
   - **Assemble + save** — validate against `SlideManifestSchema`, extract the cover
     title into the project name, inject uploaded font faces + the logo, write the
     manifest to `PresentationVersion.slideJson`, mark the project generated.
   - **Fan out** — emit thumbnail render + (images mode) image generation; flush the
     transient enhance PNGs; **settle credits** to the actual output cost (clamped to
     the hold, refund the rest); broadcast completion.
   - `onFailure` marks the rows failed, releases the full hold (no tokens billed), and
     flushes any transient files.

### Inngest functions

| Function | Trigger | Purpose | Concurrency |
|---|---|---|---|
| `deck-generate` | `deck.generate.requested` | Full deck generation | per-user 2 + global 10 |
| `deck-regenerate-partial` | per-slide regen event | Single-slide redesign / apply comments | global 5 (per-user 2) |
| `deck-images-generate` | `deck.images.requested` | End-of-deck reconcile of AI image boxes | 3 |
| `deck-image-warm` | `deck.image.warm` | Warm-fill one image box during the stream | 6 |
| `extract-source` | `source.extract.requested` | Normalize an uploaded PDF/PPTX, push to Files API, extract fonts/colors/text | — |
| `thumbnail-render` | `deck.thumbnails.render` | Puppeteer per-slide screenshot → WebP → `slide-previews` bucket | 2 |
| `template-render` | `template.render.requested` | Render a template showcase deck | 2 |
| `brand-analyze` | `brand.analyze.requested` | Vision analysis of an uploaded brand | 3 |
| `credits-maintenance` | cron (daily) | Release stuck holds, expire top-ups, drip monthly allotments | — |
| `notifications-cleanup` | cron | Prune old notifications / broadcasts (>30d) | — |

The Inngest client is `inngest/client.ts`; functions are served from
`app/api/inngest/route.ts`. `deck-generate` and `deck-regenerate-partial` carry a
per-user concurrency cap (key `event.data.actorPrismaUserId`, limit 2) plus a global
cap, and a Max-tier priority boost.

### Anthropic + presets

`lib/anthropic/quality-params.ts` defines the quality presets; `lib/credits/cost.ts`
prices them. The shipped presets:

| Preset | Model | Thinking | Cost (base + per-slide) |
|---|---|---|---|
| **opus-fast** (default) | Opus 4.8 | off | 100 + 10 |
| **opus-balanced** | Opus 4.8 | adaptive (low) | 400 + 22 |
| **fable-low** | Fable 5 | adaptive (low) | 500 + 28 — *parked: Fable is disabled upstream* |

Slide images for enhance/mimic are uploaded to the Anthropic Files API
(`lib/anthropic/files.ts`) and deleted after the run.

### Images

AI image boxes are emitted by Claude as `<img data-genimage data-genid …>` markers
(scanned by `lib/images/slide-images.ts`, max 12 per deck). During the stream each box
fires `deck.image.warm` (deduped by a prompt hash); after save `deck-images-generate`
reconciles every box: calls **gpt-image-2** (`lib/images/gpt-image.ts`), stores
deterministically to the public `generated-images` bucket at
`${projectId}/gen/${genid}-${hash}.png`, writes a `GeneratedImage` row, broadcasts
`slide.image.ready` for live swap, and injects the URL into the manifest.

### Deck data shape

A deck is a **manifest** stored in `PresentationVersion.slideJson`
(`lib/schema/slide.ts`): `{ version, title, language, direction, format, theme
{palette, font, background, text}, slides[{slideId, role, html}] }`. Each slide's
`html` is a **self-contained `<section>`** with its `<style>` scoped under `.tq-canvas`
(`lib/deck/scope-css.ts`) and wrapped in the fixed canvas frame
(`lib/deck/scaffold.ts`, 1920×1080 or 1080×1920). The same HTML renders in the studio,
the read-only viewer, and every exporter. The schema validates **shape only**
(presence/length) — HTML/CSS safety is enforced downstream by DOMPurify, the canvas
frame, and the export sanitizer.

---

## 7. Export pipeline

Four formats from the studio export menu: **PPTX, PDF, PNG, HTML**.

- **PPTX** — built client-side from the rendered DOM by a patched `dom-to-pptx`
  (`patch-package`), then run through a custom OOXML post-processor
  (`lib/export/bidi-postprocess.ts`) that fixes BiDi in three layers PowerPoint
  requires: `<a:bodyPr rtlCol="1">` on RTL text bodies, `<a:pPr rtl="1" algn="r">` per
  RTL paragraph (and explicit `rtl="0"` on LTR-in-RTL), and `lang="ar-SA"` retagging on
  RTL runs — plus run-merging and a glyph-drift width correction so Arabic lines do not
  re-wrap in PowerPoint. Optional gradient-text fills are emitted as `<a:gradFill>`.
- **PDF** — `POST /api/projects/[id]/export/pdf`: server builds a standalone HTML
  document (`lib/export/html-document-server.ts`) and renders it with Puppeteer, one
  slide per page.
- **PNG** — `POST /api/projects/[id]/export/png`: per-slide Puppeteer screenshots at
  canvas resolution, zipped (JSZip).
- **HTML** — standalone self-contained document download.

HTML is sanitized at every boundary, not only export: `lib/export/sanitize.ts` runs on
**view** (`SlideRenderer`) and **editor load** (before the flatten); its JSDOM mirror
`sanitize-server.ts` runs on **save + export** (kept in lockstep, "update BOTH files").
Past DOMPurify (+ font-URL allowlist + data-URL stripping) it runs a **family of RTL
rewriters** that correct Claude's LTR-mental layouts on an RTL slide, reading INLINE styles
only (detached parse, no CSS cascade, so a class-set property or a `dir=ltr` subtree is out of
reach): `rewriteRtlLeadColumnSide` (re-anchors a grid lead `<p>` stranded left under its
heading), `rewriteRtlLtrTextAlign` (right-aligns a `dir=ltr` Latin block, e.g. a tier name,
tagline, or index number), `rewriteRtlArabicRowReverse` (flips an Arabic eyebrow's
`flex-direction:row-reverse` to `row` so it packs right and reads RTL), plus the older
flex/grid fixers (`rewriteRtlRowFlexOrder`, `…FlexEndToFlexStart`, `…MarginAutoEnd`,
`…ImagePanelSide`, `rewriteGridAutoFlowDense`). Each is tightly gated and verified (empirical
cross-deck + adversarial review): a loose gate corrupts correct RTL layouts (the grid
rewriter's naive v1 broke 14). Thumbnails are produced by the `thumbnail-render` Inngest job
(Puppeteer → WebP in the `slide-previews` bucket, written to `Project.thumbnailUrls`).

---

## 8. The studio (DeckView)

`components/preview/DeckView.tsx` is one component that both **generates and edits** a
deck in a single canvas with no remount:

- **Generating → editing handoff** — while generating, it shows progress and streams
  live-preview slides; on completion it becomes the editor in place (undo stacks,
  scroll, and selection survive the transition).
- **Roles** — `owner` / `edit` / `comment` / `view`, resolved from `resolveProjectAccess`
  (owner > edit > comment > view); public links grant view-only.
- **Workspace:** the selected slide swaps from read-only `SlideRenderer` to `SlideEditor`
  (`components/preview/editor/SlideEditor.tsx`), a same-origin iframe that IS the whole canvas.
  The native-size artboard (`#tqe-stage`, 1920x1080 or the deck format) floats inside a
  pan/zoom scene (`#tqe-scene`, one `translate(pan) scale(zoom)` pushed via CSS vars so zoom
  never reloads the iframe). `lib/editor/canvas-fit.ts` fits to screen on load and resize;
  zoom chrome gives `-/NN%/+` plus fit; wheel pans, Cmd/Ctrl+wheel zooms to cursor, Space-drag
  pans.
- **Flatten on enter:** `SlideEditor` flattens the slide (every element becomes a standalone
  absolute box in ONE stacking context) so global z-order / drag / grouping work; a
  simulation-diff bakes each leaf's resolved style so re-flatten is byte-stable. A
  content-parity net keeps it lossless (on a parity miss it leaves the nested HTML untouched),
  and a **fidelity observatory** (`FlattenEvent` + PostHog `flatten.fidelity`) logs residual
  style drift for offline tuning. Flatten is the precondition for every canvas op.
- **Select and manipulate:** click selects the topmost leaf (`resolveHit` over
  `elementsFromPoint`); a drag from empty canvas marquee-selects; Shift-click toggles;
  double-click enters a group. `react-moveable` (portaled into the iframe body) does drag /
  resize / rotate (Shift snaps rotation to 15 degrees; text boxes reflow on resize). Snapping:
  6px edge-snap to the artboard and sibling leaves, plus a custom **canvas-centre** snap with
  cross guides. A multi-selection drags via a self-driven pointer-delta / zoom loop.
- **Layers:** `LayersPanel` lists leaves front-first by z (rebuilt from a `MutationObserver` on
  the stage); drag-reorder restacks (writes z-index), per-layer **lock** (`data-tq-lock`, stays
  selectable but not draggable), and **virtual grouping** (`data-tq-group` id, no reparenting,
  members stay siblings in one z-band, folder-folded in the panel). The slide background pins
  backmost with an editable colour swatch.
- **Element ops:** add a text box (slide-centred, theme font, bilingual default), delete,
  bring-to-front / send-to-back, group / ungroup. Double-click text enters `contentEditable`
  with a custom caret sized to the visible glyph height; Enter inserts a line break (no split).
- **Style pill:** selecting an element raises `StylePill` (a floating glass toolbar, anchored by
  a parent-side rAF loop that reads the live selection rect). Text: size (free-type plus a
  spinner), bold/italic, colour, alignment (L/C/R), and an **RTL/LTR direction toggle** (sets
  `dir` plus a matching `text-align`, so a forced direction survives the flatten, the view-time
  sanitizer, and PPTX export). Image: replace / regenerate (AI). SVG: recolour plus opacity.
  Shape: fill/border. All kinds: canvas-align to a slide edge or centre. A multi-selection
  shows a "mixed" dot.
- **Overlays:** selection borders, hover, marquee, caret, centre guides, and Moveable all live
  in the iframe body as `position:fixed` layers that read each target's live
  `getBoundingClientRect` every frame, so they compose correctly under the scene transform with
  no coordinate math.
- **Undo/redo:** a per-slide client stack of paired `{before, after}` HTML snapshots (max 100),
  pushed on each edit; Cmd+Z / Cmd+Shift+Z apply a snapshot IN PLACE via an `inPlaceApply` token
  (a section innerHTML swap, no iframe reload). An external write (regen / restore / peer edit)
  clears that slide's stack so a stale snapshot cannot apply over a new baseline.
- **Persist vs save:** every edit/undo POSTs `.../edit` silently (per-slide-chained,
  crash-safety, no version row). **Save** (cloud-icon click, or leaving the canvas via a
  `pagehide` keepalive) flushes dirty slides to `.../checkpoint` (`SlideVersion` rows, max 5 per
  slide) then pins `savedVersionId` plus a per-slide snapshot; a **10-minute idle checkpoint**
  auto-saves in the background. The cloud-save control reflects saved / unsaved / saving from a
  dirty-gen counter; `HistoryPopover` lists and restores checkpoints.
- **AI edits:** full regen, or per-slide partial regen driven by comments flagged `forAi`
  (`deck-regenerate-partial`), re-flattening after.
- **Realtime:** presence avatars per slide; live comment + regen + lock + image-ready events.
- **Export:** `ExportMenu` (PPTX/PDF/PNG/HTML), serialized so runs do not overlap.

---

## 9. Data model

Prisma schema (`prisma/schema.prisma`). Core relational graph:

```
User ─1→ Project ─1:1→ Presentation ─1→ PresentationVersion (slideJson = manifest)
                                   └─1→ SlideState ─1→ SlideVersion (≤5)
```

| Group | Models |
|---|---|
| **Deck core** | `User` (Supabase-linked identity, `plan`, `role`, `bannedAt`), `Project` (title, format, status, `thumbnailUrls`, `slideCount`, color tags, `publicAccessLevel`, `brandKitId`/`templateId`/`folderId`), `Presentation` (1:1, `currentVersionId`, `savedVersionId`, `savedSlideVersions`), `PresentationVersion` (append-only, `slideJson`), `SlideState` (per-slide, `lockedAt`, `cachedComments`), `SlideVersion` (≤5 per state) |
| **Collaboration** | `Comment` (user comments and AI instructions via `forAi`, area bounds, screenshot), `ProjectShare` (per-invitee, `accessLevel`, one-time `inviteToken`, soft-delete `revokedAt`), `Notification` (bell events, pointer payloads) |
| **Credits** | `CreditAccount` (per user: `subscriptionBalance`, `monthlyAllotment`, `allotmentResetAt`, `signupGrantedAt`), `TopupGrant` (expiring packs, FIFO), `CreditHold` (per-job pre-auth, `jobKey` unique, source breakdown), `UsageEvent` (audit log) |
| **Billing** | `Subscription` (Stripe mirror: customer/subscription/price ids, cadence, plan, status), `StripeWebhookEvent` (idempotency ledger) |
| **Assets** | `Template` (brand snapshot + rendered PDF/thumbnails, `isPublic`, `isPremium`, `featuredOrder`), `BrandKit` (palette/fonts/logo/tone, one default per user), `Folder`, `GeneratedImage` (one per AI image box) |
| **Jobs / admin** | `Job` (Inngest run tracking, token usage, `cancelRequestedAt`), `AdminBroadcast` (bilingual announcements) |

RLS is enabled on every public table; the app connects as the table owner and bypasses
it. Cross-cutting JSON columns: `PresentationVersion.slideJson`, `BrandKit.{colors,
fonts,assetUrls}`, `Template.brand`, `Comment.boundsJson`, `Notification.payload`,
`CreditHold.{topupTakes,metadata}`.

---

## 10. Credits & billing

### Ledger (`lib/credits/*`)

Hotel-style **hold → settle**: a generation pre-authorizes its quoted cost
(`holdCredits`), then settles to the actual output cost **clamped to the hold**
(`settleHold`) — the user never pays more than was shown; the remainder is refunded to
the exact source buckets. Fixed-cost operations (partial regen, name generation) use
`chargeCredits`. Every mutation locks the user's `CreditAccount` row
(`SELECT … FOR UPDATE`) so concurrent generations can't both pass the balance check,
and every operation is idempotent on a unique key (`jobKey` / `chargeKey` /
`sourceKey`).

Spendable balance = `subscriptionBalance` + Σ unexpired `TopupGrant.amountRemaining`.
The subscription bucket is **set** (not added) each cycle and does not roll over;
top-ups are drawn **FIFO by expiry**, survive resets, and expire 12 months after
purchase. The daily `credits-maintenance` job releases stuck holds (>24h), expires
top-ups, and drips monthly allotments.

**Cost** = `base + slides × perSlide` (regen = `slides × perSlide`, no base), per the
preset table in §6.

### Pricing tiers (`lib/credits/cost.ts`)

| | Free $0 | Plus $15 | Pro $30 | Max $70 |
|---|---|---|---|---|
| Monthly credits | 400 once (signup) | 2,000 | 5,000 | 12,000 |
| Slide cap | 10 | 30 | 60 | 75 |
| Presets | opus-fast | + opus-balanced | + fable-low | all |
| Flows | create only | all 4 | all 4 | all 4 |
| Premium templates | — | — | ✅ | ✅ |

Yearly plans bill ~10% cheaper per month. **Top-up packs** (subscriber-only): Mini 500
/ Small 1,000 / Medium 3,000 / Large 8,000 credits — priced so the cheapest top-up
per-credit rate is still above the highest subscription per-credit rate.

### Stripe (`lib/billing/*`, `app/api/stripe/*`)

The price catalog (`lib/billing/prices.ts`) carries stable `lookup_key`s and grant
metadata — no Stripe IDs in code (`scripts/stripe-setup-products.ts` mints them).
Checkout (`POST /api/stripe/checkout`) creates a Checkout Session with
`ui_mode: elements`, rendered in the themed `/checkout` Payment Element; the grant is
described entirely in session metadata so the webhook is self-sufficient. The webhook
(`POST /api/stripe/webhook`) verifies the signature, dedupes via `StripeWebhookEvent`,
and maps events to ledger grants: `checkout.session.completed` and
`invoice.payment_succeeded` grant the subscription cycle or a top-up;
`customer.subscription.{updated,deleted}` mirror plan/cadence/status and re-grant on
upgrade; `invoice.payment_failed` flips to past-due with a dunning notification.
Receipts and billing notifications are emailed. Surfaces: `/plans` (change plan +
packs), `/billing` (cancel/resume + payment methods), `/invoices`, `/checkout`.

---

## 11. Platform services (realtime, notifications, storage, admin)

### Realtime (`lib/realtime/*`)

Supabase Realtime **broadcast** channels in two classes: `project:{id}` (shared) and
`user:{uid}` (per account). When `SUPABASE_JWT_SECRET` is set, channels require an
HS256 token minted by `mint-token.ts` with a `topics` claim authorizing only the
channels the caller can access (`GET /api/realtime/token`, rate-limited). The browser
token manager fetches once per tab and refreshes before expiry. Project channels carry
comment / regen / lock / image-ready events plus presence; user channels carry
**pointer-only** events (`{ notificationId }`, share-revoked, balance/subscription
changed) — sensitive values never cross the wire; clients fetch full rows over
auth-gated REST. Server broadcasts (`lib/realtime/server-broadcast.ts`) fire after DB
writes, best-effort with a timeout. UI state updates **in place** from these events
(the project status route with `?includeManifest&includeSlideStates` is the fat-sync
fallback); `router.refresh` is reserved for user-initiated actions.

### Notifications (`lib/notifications/*`)

`fanOutNotification` writes a row per recipient (project members or an explicit list,
self-echo skipped) and pushes a pointer event on each recipient's user channel. Types
cover comments, regen/generation outcomes, shares, billing events, email change, and
admin broadcasts (bilingual, rendered in each user's locale). The bell reads
`GET /api/notifications` and marks read via `PATCH`.

### Storage (`lib/storage/*`)

Three Supabase buckets: `source-files` (uploaded decks), `brand-assets` (logos
SVG-only, brand images — private, 1-year signed URLs), `generated-images` (public,
user-uploaded editor images + AI images). Upload routes (`/api/storage/upload`,
`/api/storage/upload-image`) are auth- and ban-gated, rate-limited, size-capped, and
MIME-sniffed by magic bytes; signing (`sign.ts`) enforces the caller's
`${supabaseUserId}/` namespace.

### Admin console (`app/[lang]/(app)/admin/*`)

Role-gated by `User.role === "admin"` (`lib/api/admin-context.ts`:
`requireAdminPage()` 404s non-admins; `requireAdminApi()` 403s; banned admins lose
power). `scripts/set-admin.ts <email>` grants the role. Four screens:

- **Overview** — Prisma KPIs (users, active subs, MRR, decks/credits in 30d) + activity
  feed, plus PostHog read-backs (channel sources, a WebGL globe of geo visitors,
  online-now, traffic totals, device breakdown, conversion funnel).
- **Users** — searchable list; hard-delete (cascades Prisma rows + the Supabase
  identity).
- **Templates** — curate featured/premium templates (`featuredOrder`, `isPremium`).
- **Broadcast** — compose a bilingual announcement; fans out to every user and records
  an `AdminBroadcast` row.

---

## 12. Abuse & rate limiting

An in-memory fixed-window limiter (`lib/rate-limit.ts`, 10k-bucket LRU, per-process)
with helpers keyed on the real client IP (`lib/api/rate-limit.ts`,
`CF-Connecting-IP` → `X-Real-IP` → last `X-Forwarded-For` hop, returns 429 +
`Retry-After`). Guarded routes include the contact form, file extract, storage uploads,
PDF/PNG export, the share-invite email, checkout, account delete, the realtime token
mint, `POST /api/projects`, `POST /api/auth/user-sync`, and `POST /api/datasheet/parse`.
The signup grant adds email-alias dedupe + IP-velocity checks. Generation cost is
bounded by the per-user + global **Inngest concurrency caps** on `deck-generate` /
`deck-regenerate-partial`. (Single-process limiter; a Redis backend is the future
multi-instance upgrade.)

---

## 13. Infrastructure & deploy

### Production box

Hetzner CPX22 (Ubuntu 24.04), behind Cloudflare, reachable as `ssh taqreer`. nginx
terminates TLS on 443 (Let's Encrypt, `client_max_body_size 50m`, enlarged proxy
buffers for Supabase cookies, 300s read timeout for streams) and proxies to:

- **pm2 `taqreer-prod`** — `next start -p 3100` from `/root/taqreer`, serving the
  atomically-swapped `.next-deploy` build (`NEXT_DIST_DIR=.next-deploy`).
- **pm2 `taqreer-inngest`** — self-hosted Inngest dev server :8288 (interim until
  Inngest Cloud), connected via `/api/inngest`.

Both auto-resurrect on boot. System binaries used by the export/extract pipelines are
apt-installed on the box (not deployed): LibreOffice (PPTX→PDF), poppler-utils
(PDF→PNG), fontforge (OTF→TTF for Arabic PPTX), and the Puppeteer Chrome + its system
libs.

**App DB** is Supabase Pro Postgres (eu-central-1, session-mode pooler, TLS, RLS on
every table, Supabase-managed daily backups + PITR). The same Supabase project provides
auth, storage, and realtime for both dev and prod.

### Deploy — `./deploy.sh` (git push-to-deploy)

`dev` is the only working branch. `./deploy.sh` pushes `dev`+`main` to GitHub, then
`git push prod dev:main` to the box's bare repo. The tracked `post-receive` hook
(`scripts/post-receive.sh`) checks `main` into the work-tree, runs `npm ci` +
`prisma migrate deploy`, builds into `.next-build`, **atomically swaps** it to
`.next-deploy`, reloads pm2, and health-checks `GET /ar` (expects 200). `--rebuild`
re-runs the hook on the current `main` (e.g. after an `.env` change); `--force` skips
the dirty-tree guard. Review discipline: small fixes deploy straight from `dev`; schema
/ webhook / feature changes go through a `dev → main` PR first.

Secrets live only in `/root/taqreer/.env` (chmod 600, gitignored). `NEXT_PUBLIC_*`
values are inlined at build time, so changing them requires a rebuild, not just a
reload.

### Monitoring

Sentry is wired via `instrumentation.ts` + `instrumentation-client.ts` (env-tagged,
masked replay, source maps uploaded on deploy). PostHog (EU) captures consent-gated
client events through a managed reverse proxy and reads back through the Query API
(HogQL) for the admin Overview and the signup → deck → export → purchase conversion
funnel.

---

## 14. Environment variables

| Service | Variables |
|---|---|
| Database | `DATABASE_URL` |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (realtime private channels) |
| Anthropic | `ANTHROPIC_API_KEY` |
| Stripe | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV` (dev) |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (secret is in the Supabase Auth dashboard) |
| Runtime / build | `NEXT_DIST_DIR`, `NEXT_PUBLIC_APP_URL`, `NODE_ENV`, `COMING_SOON`, `COMING_SOON_KEY` |

---

## 15. API surface

Under `app/api/` (the proxy never gates API routes):

- **Projects / decks** — `projects` (POST create+dispatch, GET list), `projects/search`,
  `projects/[id]` (PATCH rename, DELETE), `projects/[id]/{status,save,cancel,retry,
  regenerate,regenerate-partial,template-preview,use-as-template,share}`,
  `projects/[id]/slides/[slideKey]/{edit,regen,lock,restore,versions,checkpoint,
  images/[genid]/regen}`, `projects/[id]/slides/lock-all`,
  `projects/[id]/share/[shareId]`, `projects/[id]/comments/*`,
  `projects/[id]/export/{pdf,png}` (PPTX/HTML build client-side).
- **Extraction / data** — `extract`, `extract/[jobId]`, `datasheet/parse`.
- **Templates / brand / library** — `templates/[id]`, `templates/[id]/{use,visibility}`,
  `brand-kits/*`, `storage/upload`, `storage/upload-image`.
- **Auth / user** — `auth/user-sync`, `auth/delete-account`, `me`, `invitations/[token]/accept`.
- **Billing** — `stripe/checkout`, `stripe/checkout/status`, `stripe/webhook`,
  `billing/*` (summary, invoices, payment-methods, subscription cancel/resume),
  `credits`, `usage/{ledger,plan}`.
- **Realtime / notifications** — `realtime/token`, `notifications`, `notifications/[id]`.
- **Admin** — `admin/users/[id]`, `admin/templates/[id]`, `admin/broadcast`,
  `admin/credits/grant`.
- **Platform** — `inngest` (function serve), `status` (health), `contact`,
  `icon.svg`, `robots.txt`, `sitemap.xml`.

---

## 16. Repository map

```
app/
  [lang]/
    layout.tsx                 root layout (dir, fonts, theme, providers)
    page.tsx                   marketing landing
    (auth)/                    login, signup, forgot/reset, callback, confirm
    (app)/                     dashboard shell + hub, flows, studio, billing, admin
    (legal)/                   terms, privacy, refund, contact
    brand/                     LIVE design-system reference
    coming-soon/  banned/  lab/svg-animations/   standalone pages
  api/                         all backend routes (see §15)
components/
  app/        dashboard shell, sidebar, top bar, dialogs, dashboard widgets
  preview/    DeckView studio, SlideEditor (editor/), comments, history, export
  slides/     SlideRenderer, PreviewActionBar
  create/     flow controls (CardHeader, SegmentedToggle, pickers, GenerateSplitButton)
  brand/      brand-kit dropdown, font/logo pickers, AI-images panel
  marketing/  landing sections (Hero, BidiSection, PricingTiers, trusted-by, footer)
  billing/    plan cards, checkout, credit-gate dialog
  admin/      admin console screens + charts/globe
  i18n/  icons/  providers/  common/  contact/  legal/  credits/  analytics/
lib/
  anthropic/  files, quality presets
  deck/       scaffold, scope-css, html-stream, logo-inject
  images/     gpt-image, slide-image scan, store
  export/     bidi-postprocess, html-document-server, sanitize, gradient-text
  credits/    server (ledger), cost, preflight, signup
  billing/    prices, customer, receipt-email
  realtime/   mint-token, token-manager, project/user channels, server-broadcast
  notifications/  storage/  i18n/  api/  schema/  analytics/  prisma.ts
inngest/
  client.ts   functions/   (deck-generate, regenerate-partial, images, thumbnail,
              extract-source, brand-analyze, template-render, crons)
prisma/       schema.prisma + migrations
dictionaries/ ar.json, en.json
scripts/      one-off tsx ops (set-admin, stripe-setup-products, rerender-thumbnails, …)
proxy.ts      edge middleware (locale, coming-soon, session, auth gates)
app/globals.css   design system — single source of truth (rendered live at /brand)
```
