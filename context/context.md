# Taqreer — Architecture & Handover

Arabic-first, RTL AI presentation platform. User provides content + brand, **Claude designs each slide as HTML**, the browser renders it 1:1, and a patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX. No manual slide editor — every visual change goes through Claude.

| | |
|---|---|
| **Stack** | Next.js 16 + Turbopack, React 19, TypeScript 5, Prisma 7 + Postgres, Inngest, Supabase (auth + storage), Anthropic SDK, Puppeteer |
| **Output** | PPTX (shipped) · PNG/PDF (planned, step 15) · Templates (pending) |
| **Differentiator** | HTML-first generation; preview = export; ~99 % Arabic PPT parity via custom BiDi post-processor |
| **Active plan** | [`context/projects.md`](./projects.md) is the working backlog (steps 9f, 11, 12, 13, 15) |
| **Branch strategy** | All work goes to `dev`. CodeRabbit reviews `dev → main` PRs. |

For the dated log of every fix, see [`log.md`](./log.md). For the patch ledger, see §19.

**Status legend:** ✅ shipped · 🟡 partial · ⏳ planned

---

## Table of Contents

1. [Overview](#01-overview)
2. [Active Flows](#02-active-flows)
3. [Tech Stack](#03-tech-stack)
4. [System Architecture](#04-system-architecture)
5. [Routes](#05-routes)
6. [Data Model](#06-data-model)
7. [Slide Manifest Schema](#07-slide-manifest-schema)
8. [AI Pipeline](#08-ai-pipeline)
9. [Preview Window](#09-preview-window)
10. [Per-Slide Versioning + Comments](#10-per-slide-versioning--comments)
11. [Save Project + Thumbnails](#11-save-project--thumbnails)
12. [Dashboard Tile + Lightbox](#12-dashboard-tile--lightbox)
13. [Templates](#13-templates)
14. [Export Pipeline](#14-export-pipeline)
15. [Pricing & Quotas](#15-pricing--quotas)
16. [Build Phases](#16-build-phases)
17. [Implementation Status & Lessons](#17-implementation-status--lessons)
18. [Technical Risks](#18-technical-risks)
19. [Patch Index](#19-htmltoppt-patch-index)
20. [Agent Onboarding](#20-agent-onboarding)

---

## 01. Overview

User provides content + brand assets. Claude generates every slide as a string of HTML/CSS. Browser renders the slide; export pipeline measures the rendered DOM and emits a PPTX. User lands in the Preview Window to review, regenerate (full deck or per slide), comment, save, and export.

> **Core product rule:** every journey ends inside the Preview Window. Preview is review-only — browse slides, regenerate, save, export. No manual editor; visual changes go through Claude.

---

## 02. Active Flows

Two flows shipped, one flow partial. **Mimic and Data flows are dropped from the active plan.**

### Flow 1 — Create (إنشاء) ✅

Dashboard → `/create/content`. Three-step wizard, brand decided fresh by Claude.

1. **Content** (`/create/content`) — Upload PPTX/PDF/DOCX/TXT/images or paste text. Verbatim toggle.
2. **Brand** (`/create/brand`) — Palette + fonts + logo + position + slide size + count.
3. **Summary** (`/create/summary`) — Editable content + rules card. CTA: `إنشاء`. POST `/api/projects` → `/preview/[projectId]`.
4. **Generate** (`/preview/[projectId]`) — Fires Inngest `deck.generate.requested`. Placeholders + per-card progress polled at 1.5 s. On complete, slides cascade in.

### Flow 2 — Enhance (تحسين) 🟡

Dashboard → `/enhance`.

1. **Upload** (`/enhance`) — PPTX-only. Advanced: keep colors, keep fonts, custom instructions. ✅ shipped
2. **Review** (`/enhance/review`) — Claude vision extraction → palette/fonts/logo + redesign plan + per-asset overrides. 🟡 stub
3. **Generate** — `deck.generate.requested` with `type: "enhance"`. ⏳ pending

### Flow 4 — From Template (إنشاء من قالب) ⏳

Dashboard → `/templates`. Shell only. See §13.

### Flow 5 — Use this as a template ⏳

NEW flow (in the projects.md plan as step 13). 3-dots menu on any project → `/create/from/[projectId]` content-only page that pre-fills brand from the source project (colors / fonts / logo / templateId / format). Skip brand AND summary steps; submit fires `deck.generate.requested` with the copied brand. See `context/projects.md` for the implementation outline.

---

## 03. Tech Stack

Actual installed dependencies. See `package.json` for exact versions.

| Layer | Tools |
|---|---|
| Frontend | Next.js 16.2 (App Router, Turbopack), React 19.2, TypeScript 5 |
| Styling | Tailwind 4 (PostCSS), `globals.css` token system, Framer Motion 12 |
| State | Server-rendered props + `useState`; no global store |
| Database | PostgreSQL 16 (Docker compose for local), Prisma 7.8 |
| Auth + Storage | Supabase (`@supabase/ssr` 0.10, `supabase-js` 2.105). Buckets: `source-files`, `brand-assets`, `slide-previews` (public) |
| Queue | Inngest 4.3 (local: `npx inngest-cli@latest dev`) |
| AI | Anthropic SDK 0.95 (Claude Opus 4.7, streaming, adaptive thinking, prompt caching, self-healing Zod retry) |
| Export | `dom-to-pptx` 1.1.8 (patched), PptxGenJS 4 (under the hood), JSZip, **Puppeteer 24** (thumbnails + planned PNG/PDF export), **sharp** (image resize), **jsdom** (server-side sanitiser) |
| Validation + Sanitization | Zod 4, DOMPurify 3.4 (browser) + JSDOM-backed mirror (server) |
| Email | Resend (planned for invite emails — step 15.4 in projects.md) |
| Observability | Sentry (`@sentry/nextjs` 10.52) |
| Billing (planned) | Stripe 22 SDK + Resend 6 |

> **Local dev requirement:** Postgres 16 + Redis 7 via `docker compose up -d`. `.env.local`'s `DATABASE_URL` points at `localhost:5432`; Supabase is auth + storage only, not the DB.

---

## 04. System Architecture

Browser-side render + library + post-processor. Inngest does long-running generation + thumbnail rendering.

```text
User
 |
 | Next.js 16 Web App (Turbopack)
 |   - (marketing)/  Landing
 |   - (auth)/       Supabase email + Google OAuth
 |   - (app)/        Dashboard, Projects, Templates, Settings, Preview
 |   - /create/*     Flow 1 wizard
 |   - /enhance/*    Flow 2 wizard
 |   - /spike        BiDi regression harness
 |
API Layer (app/api/*)
 |
 |-- /projects                          POST → fires deck.generate.requested
 |-- /projects/[id]                     PATCH rename · DELETE hard delete + storage cleanup
 |-- /projects/[id]/status              GET, polled every 1.5 s
 |-- /projects/[id]/retry               POST retry failed generation
 |-- /projects/[id]/regenerate          POST full deck → re-fires deck.generate.requested
 |-- /projects/[id]/regenerate-partial  POST partial regen on commented slides
 |-- /projects/[id]/favorite            PATCH toggle isFavorite
 |-- /projects/[id]/save                POST pins savedVersionId + per-slide snapshot
 |                                          → dispatches deck.thumbnails.render
 |-- /projects/[id]/slides/[key]/regen     POST one-slide regen
 |-- /projects/[id]/slides/[key]/restore   POST restore to older version
 |-- /projects/[id]/slides/[key]/lock      POST/DELETE lock against regen
 |-- /projects/[id]/slides/[key]/versions  GET history list
 |-- /projects/[id]/comments               GET/POST draft comments
 |-- /projects/[id]/comments/[commentId]   PATCH/DELETE single comment
 |-- /projects/[id]/save-as-template    POST fires template.save.requested
 |-- /storage/upload                    POST signed Supabase upload
 |-- /inngest                           Inngest SDK connector
 |-- /auth/user-sync                    POST upserts Prisma User from Supabase auth
 |-- /usage/plan                        GET plan + quota
 |
Inngest functions (inngest/functions/*)
 |
 |-- deck-generate.ts              Claude Opus 4.7 → SlideManifest with HTML strings
 |                                  (streaming, adaptive thinking, prompt caching,
 |                                   self-healing Zod retry)
 |-- deck-regenerate-partial.ts    Per-slide regen with comments, parallel Claude calls
 |                                  via `step.run("regen-slide-${id}")`, atomic version
 |                                  promotion when complete
 |-- thumbnail-render.ts           Puppeteer (sandboxed Chromium) → page.setContent →
 |                                  per-slide `page.screenshot({clip})` → sharp resize →
 |                                  WebP @ 800px → upload to slide-previews bucket →
 |                                  write Project.thumbnailUrls
 |-- brand-analyze.ts              Legacy fetch-based; needs SDK rewrite
 |-- template-save.ts              Legacy fetch-based; needs SDK rewrite
 |
PostgreSQL (Prisma 7.8) — see §06
Supabase Storage
 |
 |-- source-files/      Uploaded PPTX/PDF/DOCX/TXT/images
 |-- brand-assets/      Logos, palette screenshots, fonts (SIGNED — private)
 |-- slide-previews/    Per-slide thumbnails (PUBLIC) at
 |                      ${userId}/${projectId}/${savedVersionId}/${slideKey}.webp
 |-- generated-presentations/  Reserved for future server-rendered exports
 |-- template-assets/   Reserved for template thumbnails
 |
Export pipeline (client-side, in /preview)
 |
 |-- SlideRenderer mounts manifest.slides offscreen at canvas dimensions
 |-- DOM preprocess: splitMixedScriptFlexChildren, stripArabicLetterSpacing,
 |                   insertScriptTransitionSpaces, extractGradientIntents
 |-- dom-to-pptx (patched) measures the DOM, emits skipDownload Blob
 |-- bidi-postprocess: PASS 1 (rtlCol) + PASS 2 (pPr/run-merge/lang) +
 |                     PASS 3 (shape extension) + PASS 3.5 (pill rows) +
 |                     PASS 4 (gradFill swap)
 |-- downloadBlob → user gets the .pptx
```

---

## 05. Routes

### Frontend Routes

```text
app/
  (marketing)/
    page.tsx                            ✅  Landing
    preview/page.tsx                    ✅  Marketing preview demo

  (auth)/auth/
    login, signup, forgot-password,
    confirmed/page.tsx                  ✅
    callback/route.ts                   ✅  OAuth handler

  (app)/                                shared dashboard chrome (sidebar + header)
    dashboard/page.tsx                  ✅  QuickActions, RecentProjects, MyTemplates, PlanUsage
    projects/page.tsx                   🟡  placeholder — step 11 will deliver 5-per-row + sort + filters
    favorites/page.tsx                  ⏳  step 12 — rename of /features
    features/page.tsx                   ✅  shipped; will be renamed
    templates/page.tsx                  🟡  shell — full grid + filters pending
    templates/[id]/content/page.tsx     ⏳  Flow 4
    brand-kits/page.tsx                 🟡  stub
    folders/page.tsx                    ✅
    settings/page.tsx                   ✅  Account + glass-preset live tuning
    preview/[projectId]/page.tsx        ✅  Unified preview (generating / completed / failed)

  create/                               Flow 1 — إنشاء
    page, layout, content, brand,
    summary, generating                 ✅  Three-step wizard
    from/[projectId]/page.tsx           ⏳  step 13 — content-only "use as template" entry

  enhance/                              Flow 2 — تحسين
    layout, page                        ✅  Upload step
    review/page                         🟡  needs Claude extraction display + redesign plan

  spike/page.tsx                        ✅  BiDi regression harness — don't delete
  spike-pills/page.tsx                  ✅  Pill-row regression harness
```

### API Routes

```text
app/api/
  projects/route.ts                                  ✅  POST creates project + fires deck.generate.requested (validates user-picked language)
  projects/[id]/route.ts                             ✅  PATCH rename + DELETE hard delete + storage cleanup
  projects/[id]/status/route.ts                      ✅  GET polled by DeckView at 1.5 s
  projects/[id]/retry/route.ts                       ✅  POST retry failed generation
  projects/[id]/regenerate/route.ts                  ✅  POST allocate v_n+1 + re-fire (full deck)
  projects/[id]/regenerate-partial/route.ts          ✅  POST partial regen on commented slides
  projects/[id]/favorite/route.ts                    ✅  PATCH toggle isFavorite
  projects/[id]/save/route.ts                        ✅  POST pin savedVersionId + per-slide snapshot
                                                          → dispatches deck.thumbnails.render
  projects/[id]/slides/[slideKey]/regen/route.ts     ✅  POST per-slide regen
  projects/[id]/slides/[slideKey]/restore/route.ts   ✅  POST restore to older version
  projects/[id]/slides/[slideKey]/lock/route.ts      ✅  POST/DELETE lock toggle
  projects/[id]/slides/[slideKey]/versions/route.ts  ✅  GET version history
  projects/[id]/comments/route.ts                    ✅  GET/POST draft comments
  projects/[id]/comments/[commentId]/route.ts        ✅  PATCH/DELETE single comment
  projects/[id]/save-as-template/route.ts            ✅  POST fires template.save.requested
  storage/upload/route.ts                            ✅  POST signed Supabase upload
  inngest/route.ts                                   ✅  GET/PUT Inngest SDK connector
  auth/user-sync/route.ts                            ✅  POST upsert Prisma User
  auth/delete-account/route.ts                       ✅  POST cascade delete
  usage/plan/route.ts                                ✅  GET plan + quota
  content/extract/route.ts                           ✅  Extract text from uploads
  export/embed-fonts/route.ts                        ✅  Server-side font embed for PPTX

  projects/[id]/favorite/route.ts                    ✅  PATCH isFavorite toggle (step 9f)
  projects/[id]/route.ts                             ✅  PATCH (rename) + DELETE (hard delete + storage cleanup) (step 9f)

  // Planned (per projects.md)
  projects/[id]/share/route.ts                       ⏳  Owner-only: manage publicAccessLevel + ProjectShare rows (step 15)
  projects/[id]/export/png/route.ts                  ⏳  Server-side PNG ZIP via Puppeteer (step 15.5)
  invitations/[token]/accept/route.ts                ⏳  Invite acceptance + auto-clone on edit invites (step 15.4)
```

---

## 06. Data Model

Prisma 7.8 with PostgreSQL. Tables are PascalCase — quote them in `psql`: `"PresentationVersion"`, `"Project"`, etc.

| Model | Purpose | Notable fields |
|---|---|---|
| **User** | Mirrored from Supabase auth via `/api/auth/user-sync`. | `supabaseUserId` (unique), email, name, image, plan |
| **Account, Session** | Auth.js compat tables. | provider, providerAccountId |
| **Project** | Top container per generation. | userId, title, status, format, type, folderId, **thumbnailUrls** (String[]), **slideCount** (Int?, frozen on first generate), **dominantColor** (String?, frozen on first generate), **isFavorite** (Boolean, default false), aiPrompt |
| **Presentation** | One per Project; points at the active version + the pinned canonical save. | projectId (unique), currentVersionId, **savedVersionId** (pinned at Save click), **savedSlideVersions** (Json: { slideKey → versionNumber } snapshot at save time), title, language, direction |
| **PresentationVersion** | The slide manifest. `slideJson` stores either streaming progress shape OR final v2 manifest. | presentationId, versionNumber, slideJson, status |
| **SlideState** | Per-slide metadata that survives across deck regens. Matched by `slideKey` (the stable slide id). | presentationId, slideKey, currentVersionNumber, lockedAt, cachedComments |
| **SlideVersion** | Append-only per-slide history capped at 5 rows. | slideStateId, versionNumber, slideJson, source ("create" / "regen" / "partial_regen" / "restore"), createdAt |
| **BrandKit** | Saved brand systems (palette + fonts + logo). | userId, name, jsonData |
| **File** | Uploaded source files, logos, generated artifacts. | projectId, type, filename, mimeType, storageUrl |
| **Job** | Inngest job tracking. | type, status, inputJson, outputJson, progress, errorMessage, model, quality, attempts, tokens |
| **Template** | Public + user-saved templates. | userId, name, category, language, direction, thumbnailUrls, jsonData |
| **Comment** | Per-slide draft + applied comments. | projectId, slideId, content, boundsJson (0..1920 × 0..1080), status ("draft" / "applied") |
| **Folder** | User-organized project folders. | userId, name, parentId |
| **Subscription, UsageEvent** | Stripe + quota tracking. ⏳ wired but enforcement partial. | plan, status, currentPeriodEnd, eventType, count |

**Planned schema (step 15):**

```prisma
enum ProjectAccessLevel { edit, comment, view }

model Project {
  // ... existing ...
  publicAccessLevel ProjectAccessLevel?  // "Anyone with the link" — null = disabled
  hideBrandingBadge Boolean @default(false)
  shares ProjectShare[]
}

model ProjectShare {
  id           String  @id @default(cuid())
  projectId    String
  email        String  // invitee email
  userId       String? // resolved on accept
  accessLevel  ProjectAccessLevel
  invitedBy    String  // owner's User.id
  invitedAt    DateTime @default(now())
  acceptedAt   DateTime?
  inviteToken  String? @unique
  @@unique([projectId, email])
}
```

**Inngest event types:** `deck.generate.requested` · `deck.regenerate.partial.requested` · `deck.thumbnails.render` · `template.save.requested` · `brand.analyze.requested`

---

## 07. Slide Manifest Schema

The schema lives in [`lib/schema/slide.ts`](../lib/schema/slide.ts). Each slide is a string of HTML. The browser does layout; `dom-to-pptx` measures the rendered DOM. **Permissive by design** — validate shape, not content.

```jsonc
{
  "version": "2.0",
  "presentationId": "uuid",
  "title": "3–8 word presentation title",
  "language": "ar" | "en",
  "direction": "rtl" | "ltr",
  "format": "16:9" | "9:16",
  "theme": {
    "palette": ["#FF0080", "#7C3AED", ...],
    "fontHeading": { "name": "Cairo", "url": "https://..." | undefined },
    "fontBody":    { "name": "Inter", "url": "https://..." | undefined },
    "background": "#0D0B1F",
    "text":       "#FFFFFF"
  },
  "slides": [
    { "slideId": "s1", "role": "cover", "html": "<div style=...>...</div>" },
    { "slideId": "s2", "role": "content", "html": "..." }
  ],
  "progress": { "stage": "designing", "currentSlide": 3, "estimatedTotal": 7 }
}
```

### Slide HTML rules (enforced by the system prompt)

- No `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` wrapper. Body content only.
- Set `dir="rtl"` or `dir="ltr"` on the slide root.
- Slide roots set `width:<W>px; height:<H>px` matching the manifest's `format` — 1920×1080 for 16:9, 1080×1920 for 9:16.
- Inline `<style>`, `<svg>`, `<link>`, `<img>` allowed; `<script>`, event handlers, `javascript:` URIs are stripped by DOMPurify at render. The server-side mirror ([`lib/export/sanitize-server.ts`](../lib/export/sanitize-server.ts)) does the same for thumbnail rendering.
- Slide roles: `cover · section · content · stats · quote · image · closing` (optional).

---

## 08. AI Pipeline

### Generate Deck (Flow 1) ✅

1. **Brief assembly** — `POST /api/projects` persists Project + v1 PresentationVersion (status `queued`), fires `deck.generate.requested`.
2. **Inngest `deck-generate`** — `buildUserMessage` emits a per-request "Generation rules" block (tone, design-style hints, verbatim mode, logo placement). System prompt is `cache_control: ephemeral`; per-request mutations would kill the cache.
3. **Claude Opus 4.7 stream** — Adaptive thinking, prompt caching, anthropic-beta context-1m. Subscribes to `stream.on("text")`, counts `"slideId":` occurrences = current slide, throttles DB writes (~800 ms) into `slideJson.progress`.
4. **Parse + Zod validate** — Strip markdown fences, parse JSON, validate `SlideManifestSchema`. On failure: append error to prompt and retry (max 3 attempts inside the Inngest step).
5. **Persist + promote title + filter cols** — Update v1 row to `completed`. Promote `manifest.title` to `Project.title`. **Freeze `slideCount` + `dominantColor` on first generation** (conditional spread, only writes if currently null). `seedSlideVersionsForInitialGeneration` seeds v1 of every slide into `SlideState` + `SlideVersion`.

### Partial Regen ✅

Per-slide regen — comment authoring + apply, OR per-slide pill's regen button.

1. **Author** (CommentsPanel) — drag-box on the hero canvas → comment editor → save as draft (`Comment.status = "draft"`).
2. **Arm** (regen button morphs to AI sparkles when drafts exist + commentMode off).
3. **Fire** — `POST /api/projects/[id]/regenerate-partial` allocates a queued v_n+1, promotes drafts→applied INSIDE the version-allocation transaction, fires `deck.regenerate.partial.requested`.
4. **Inngest `deck-regenerate-partial`** — Parallel Claude calls via `step.run("regen-slide-${id}")` per target slide. Splices new HTML into a manifest copy. `currentVersionId` flips to v_n+1 ONLY on the post-write atomic transaction (`prisma.$transaction([version.update, presentation.update, project.update])`) — deck stays visible during regen.
5. **History** — Each regenerated slide gets a new `SlideVersion` row + `SlideState.currentVersionNumber` bump. History capped at 5 (oldest pruned). `cachedComments` cleared on clean regen; replaced on comment-payload regen.

### Enhance Deck (Flow 2) 🟡

Upload PPTX → `brand.analyze.requested` (planned) extracts palette/fonts/logo via Claude vision → review page lets user override → `deck.generate.requested` with `type: "enhance"`. Currently: upload page works; review + extraction pending.

---

## 09. Preview Window

**Review-only.** Users browse slides, regenerate, save, comment, export. No element editor — visual changes go through Claude.

### Vertical action toolbar (left edge, fixed)

[`components/slides/PreviewActionBar.tsx`](../components/slides/PreviewActionBar.tsx)

| Button | Status |
|---|---|
| Regen / Apply comments (icon morphs `autorenew` ↔ `auto_awesome` when comments armed) | ✅ |
| Comment toggle (with draft count badge — `bg-blue-500` info chip) | ✅ |
| Save Project (icon morphs `save` ↔ `check` when saved) | ✅ |
| Export PPTX | ✅ |
| Download HTML (standalone deck document) | ✅ |
| Export PDF | ⏳ step 15.7 |
| Save as Template | ✅ (wires Inngest event; templates UI pending) |

All buttons use the unified design system: `.btn-pill` for neutral glass, `.btn-gradient` for CTA, `.btn-gradient-anim` for AI triggers, all backdrop blur via Tailwind `backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]` — never raw `backdrop-filter:`.

### Hero canvas + slide nav sidebar

- `SlideRenderer` mounts each `slide.html` string inside a fixed canvas (1920×1080 or 1080×1920) with theme CSS vars (`--brand-bg`, `--brand-text`, `--primary`, `--secondary`, `--brand-1..N`, `--font-heading`, `--font-body`).
- `SlideNavSidebar` (right-edge) — thumbnail strip; swaps with `CommentsPanel` in comment mode.
- Hero in comment mode → `HeroCommentOverlay` paints the draft pin markers + drag-box selection.
- Per-thumbnail apply state: regenerating slides get a `bg-black/55` dim + spinner overlay.

### Per-slide pill (top-center of hero, fades in on canvas hover)

[`components/preview/SlidePill.tsx`](../components/preview/SlidePill.tsx)

Three glass-popover buttons per slide:

| Button | Behavior |
|---|---|
| **Regen** (AI gradient) | Per-slide clean regen via `POST /api/projects/[id]/slides/[slideKey]/regen`. |
| **History** | Opens a portal'd popover anchored under the button. Lists last 5 versions newest-first. Click → restores (non-destructive pointer move via `POST /slides/[slideKey]/restore`). Active row highlighted with brand-gradient outline. |
| **Lock** (CTA gradient when active) | Toggles `SlideState.lockedAt` via `POST/DELETE /slides/[slideKey]/lock`. Locked slides are skipped by full-deck regen. |

### Status

- ✅ Streaming generation with per-card progress polled at 1.5 s
- ✅ Cascade-in slide reveal (Framer Motion stagger)
- ✅ Slide-nav sidebar with thumbnails
- ✅ Comment authoring (drag-box → editor → draft → arm → fire partial regen)
- ✅ Per-slide pill (regen / history / lock)
- ✅ Per-slide history with non-destructive restore (5-version cap)
- ✅ Stuck-detection: in-page slow warning rendered by `DeckView` after 6 min slow / disconnect / 60 s no-progress / 5-min hard cap. (Generation-phase bell alerts were removed — the bell is reserved for post-generation completion notifications.)

---

## 10. Per-Slide Versioning + Comments

Shipped end-to-end (steps 1–6 of the original `plan-comments.md` plus the pill + history additions).

### Comment model

```prisma
model Comment {
  id             String   @id @default(cuid())
  projectId      String
  slideId        String
  content        String
  boundsJson     Json     // { x, y, w, h } in slide-space (0..1920 × 0..1080)
  status         String   // "draft" | "applied"
  // ...
}
```

Comments are SLIDE-bounded. `boundsJson` is validated at create + update. PATCH/DELETE only allowed on `status="draft"` (close TOCTOU window via `updateMany`/`deleteMany` with `status: "draft"` guard).

### Comment flow

1. Toolbar comment toggle ON → CommentsPanel replaces SlideNav. Hero canvas gets a brand-gradient ring + crosshair cursor.
2. User drags a box on the hero → editor popover. Save creates a `Comment(status="draft")`.
3. Toggle comment mode OFF (Apply button in CommentsPanel footer). Drafts persist as `draft`. Regen button morphs to AI sparkles.
4. Click the AI-sparkle regen → `POST /api/projects/[id]/regenerate-partial`. Promotes drafts → applied INSIDE the version-allocation transaction, fires `deck.regenerate.partial.requested`. `applying` state locks the regen button + applies per-slide dim+spinner overlay.
5. Inngest parallel Claude calls per target slide → splice → `currentVersionId` flips to v_n+1 atomically.

### Per-slide versioning model

```prisma
model SlideState {
  presentationId        String
  slideKey              String
  currentVersionNumber  Int
  lockedAt              DateTime?
  cachedComments        Json?         // last partial-regen comment payload (for "try again" — dormant in UI)
  versions              SlideVersion[]
  @@unique([presentationId, slideKey])
}

model SlideVersion {
  slideStateId   String
  versionNumber  Int
  slideJson      Json     // single slide payload
  source         String   // "create" | "regen" | "partial_regen" | "restore"
  createdAt      DateTime @default(now())
  @@unique([slideStateId, versionNumber])
}
```

`MAX_VERSIONS_PER_SLIDE = 5` (oldest pruned). Lock is a SlideState-level flag, not version-level.

### Restore semantics

Restore is **non-destructive** — it moves `SlideState.currentVersionNumber` to the target + splices that version's slideJson INTO the active `PresentationVersion.slideJson` in place. The PresentationVersion row's id does NOT change. This means restore mutates the saved snapshot — see §11 for the Save Project comparator that handles this.

---

## 11. Save Project + Thumbnails

### Save Project button

Toolbar `حفظ المشروع` button. Pins the canonical snapshot.

POST `/api/projects/[id]/save`:
1. Pin `Presentation.savedVersionId = currentVersionId`.
2. Snapshot every `SlideState.currentVersionNumber` → `Presentation.savedSlideVersions` (Json: `{ slideKey → versionNumber }`).
3. Dispatch `deck.thumbnails.render` Inngest event with id `thumbnails:${projectId}:${savedVersionId}` (dedupes rapid Save clicks).

**Side effects:**
- `Project.slideCount` and `Project.dominantColor` are NOT touched here — they're frozen on first **deck-generate completion** (per product call). This is the canonical capture point; Save is a pointer-move only.

### Saved/unsaved indicator (restore-aware)

`DeckView.isSaved` is computed against TWO halves, both required:
1. `savedVersionId === currentVersionId` (catches partial regen + full regen, which both bump `currentVersionId`).
2. Every live `SlideState.currentVersionNumber === savedSlideVersions[slideKey]` (catches per-slide restore, which mutates the version's slideJson in place without bumping `currentVersionId`).

Button morphs `save` ↔ `check` accordingly. After clicking save, `onSaved` updates `DeckView`'s local `savedVersionId` + `savedSlideVersions` without a `router.refresh`. After restoring back to the saved version, the indicator auto-detects "saved" again.

### Thumbnail pipeline

[`inngest/functions/thumbnail-render.ts`](../inngest/functions/thumbnail-render.ts)

1. Load the saved manifest from `PresentationVersion.slideJson`.
2. Build standalone HTML via [`lib/export/html-document-server.ts`](../lib/export/html-document-server.ts) + [`lib/export/sanitize-server.ts`](../lib/export/sanitize-server.ts) (JSDOM-backed mirror of the browser sanitiser — includes the RTL rewriters).
3. Launch Puppeteer, `page.setContent(html)`, wait for `document.fonts.ready`.
4. Per-slide screenshot via `page.screenshot({ clip })` (NOT `el.screenshot()` — that hits a Chrome blank-output bug when clip == viewport; viewport is padded to `canvasH × (slides+1)` to avoid).
5. Sharp resize to 800 px wide + WebP @ Q82.
6. Upload to `slide-previews` bucket at `${userId}/${projectId}/${savedVersionId}/${slideKey}.webp` with `upsert: true`.
7. Write URL array back to `Project.thumbnailUrls`.

Concurrency capped at 2 in-flight (each Chromium ≈ 200 MB). Failure isolation — thumbnail-render failure doesn't block save; tiles fall back to placeholder when `thumbnailUrls` is empty.

---

## 12. Dashboard Tile + Lightbox

### ProjectThumbnail

[`components/app/ProjectThumbnail.tsx`](../components/app/ProjectThumbnail.tsx)

- Full-bleed `aspect-video` thumbnail (NO footer chrome below it — moved to a separate info row).
- 9:16 source thumbnails use `object-cover object-top` → shows the slide's top portion cropped to 16:9. Keeps the grid uniform.
- **Scrub** — cursor X within the thumbnail maps to a slide index. RTL direction: **rightmost edge = slide 1**, leftmost = slide N. Activation gate: first mousemove records entry X; subsequent moves require ≥ 6 px travel before scrub activates (bare hover doesn't trigger).
- **Click** opens the `ProjectLightbox`.
- **Hover** toggles title + 3-dots between muted (`var(--tq-text-muted)`) and white (`var(--tq-text-primary)`) via JS state + inline color (CSS layer cascade fight makes utility-class approach unreliable; inline color sidesteps).

### Info row (below thumbnail, always visible)

Title (start side = right in RTL) + creation date in `.tq-subhead` style + 3-dots button (end side = left in RTL). 3-dots is a real `<button>` sibling of the thumbnail's click button (NOT nested — invalid HTML). `stopPropagation` not required because the buttons aren't ancestors of each other.

### Lightbox slider

[`components/app/ProjectLightbox.tsx`](../components/app/ProjectLightbox.tsx)

- Portal to `document.body` (escapes ancestor stacking contexts).
- Two siblings: solid dim overlay (`var(--tq-surface-modal)`, no own blur) + glass content layer.
- Top toolbar + bottom thumb strip = `.glass-popover backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]`.
- Side arrows = `.btn-pill` positioned 40 px outside the card (via `left: calc(100% + 40px)` / `right: calc(100% + 40px)`).
- Card dimensions computed in JS (`useLayoutEffect` + `ResizeObserver`) — pure-CSS approaches (flex + aspect-ratio + height:100%) all collapsed to 0 width.
- **RTL keyboard nav**: ← = next (visual-left advances), → = previous, Home / End jump, Esc closes.
- Single-slide decks hide arrows + strip.
- Active thumb gradient outline via two-background composition (`linear-gradient(--tq-bg, --tq-bg), var(--tq-gradient-brand)`).

### Dashboard tile layout

3-column grid in `RecentProjects`. `take: 6` on the SSR query → max 2 rows × 3 cols. The widget header (`أحدث المشاريع`) uses `.tq-h1` (canonical typography token). Vertical row gap is `gap-y-6` (24 px); thumbnail-to-footer gap is 12 px.

### 3-dots menu (step 9f, in progress)

Will render as a `.glass-popover` anchored under the 3-dots button:

- Share... → opens Share modal (step 15)
- Rename...
- Add to favorites / Remove from favorites → `PATCH /api/projects/[id]/favorite`
- Copy link → `navigator.clipboard.writeText(${origin}/preview/${id})`
- Use this as a template → `/create/from/[projectId]` (step 13)
- Save copy as template → rendered but **disabled** (no click handler) until user says go
- Send to trash → confirmation modal → `DELETE /api/projects/[id]` (hard delete + storage cleanup)

---

## 13. Templates

> **Status: spec, partially wired.** Templates page is a shell at `/templates`. Save-as-template wires the Inngest event but no UI flow yet. Apply-template flow at `/templates/[id]/content` not built.

Templates store a v2 SlideManifest as `jsonData` + thumbnail URLs. Browse with category/industry/language/direction/plan filters. Pick a template → upload content → Claude maps content into the template's design system. Save current project as a template fires `template.save.requested` via `POST /api/projects/[id]/save-as-template`.

**Recommended categories:** Business Proposal · Investor Report · Pitch Deck · Company Profile · Training Deck · Financial Report · Strategy Deck · Marketing Plan · Event Proposal · Arabic RTL · Government Style · Minimal Corporate.

---

## 14. Export Pipeline

Client-side, in [`lib/export/html-export.ts`](../lib/export/html-export.ts). The preview HTML is the source of truth for the export.

```text
1. exportManifestAsPptx(manifest, fileName)
2. Mount slides offscreen at canvas dimensions, full opacity, no scale transform
3. Wait for React commit + fonts.ready + every <img>.complete
4. DOM preprocess (4 passes):
   - splitMixedScriptFlexChildren
   - stripArabicLetterSpacing
   - insertScriptTransitionSpaces
   - extractGradientIntents (sentinel #FExxxx)
5. exportToPptx(slideNodes, { skipDownload: true, svgAsVector: true })
   ↳ patched dom-to-pptx (5 fixes — see §19)
6. POST /api/export/embed-fonts (server-side font embed)
7. fixBiDiInPptxBlob(blob, JSZip, stats, intents)
   ↳ PASS 1 rtlCol="1" on RTL bodyPr
   ↳ PASS 2 pPr rtl/algn + smart run-merge + lang retag
   ↳ PASS 3 direction-aware shape extension
   ↳ PASS 3.5 pill-row layout
   ↳ PASS 4 sentinel solidFill → real gradFill
8. downloadBlob(fixedBlob, fileName)
```

**PNG export — planned (step 15.5).** Server-side Puppeteer at full canvas resolution + sharp PNG encode + JSZip. **PDF export — planned (step 15.7).** Puppeteer prints the same SlideRenderer HTML.

For per-patch detail see [§19 Patch Index](#19-htmltoppt-patch-index).

---

## 15. Pricing & Quotas

Schema is wired (`Subscription` + `UsageEvent`); enforcement is partial.

| Plan | Limits | Features |
|---|---|---|
| Free | 10 slides, daily quota, limited exports | Create, enhance, selected templates, PPTX export |
| Plus | Up to 60 slides, higher quota, larger uploads | Reusable brand kits, more templates, PPTX/PDF, better AI |
| Pro | Up to 90 slides, highest quota, priority jobs | Save custom templates, area-redesign, premium templates, priority queue |

---

## 16. Build Phases

| # | Phase | Status |
|---|---|---|
| 1 | **Foundation** — Next 16 + Turbopack, Tailwind 4, Supabase, Postgres via Docker, Prisma 7.8, dashboard, project creation | ✅ |
| 2 | **Slide Manifest Engine** — v2 schema, SlideRenderer at canvas dimensions, manifest persisted to PresentationVersion.slideJson | ✅ |
| 3 | **AI Deck Generation** — Anthropic SDK, Opus 4.7, streaming + adaptive thinking + prompt caching + 1M context beta, self-healing Zod retry | ✅ |
| 4 | **Preview Window** — SlideRenderer, vertical toolbar, generating placeholders + per-card progress, cascade-in, slide-nav sidebar, hero comment overlay | ✅ |
| 5 | **PPTX Export** — patched dom-to-pptx + 4-pass post-processor; ~99 % Arabic parity | ✅ |
| 6 | **Comments + Partial Regen** — comment authoring, draft → applied lifecycle, partial regen Inngest flow, per-slide pill (regen / history / lock), 5-version capped history | ✅ |
| 7 | **Save Project + Thumbnails** — savedVersionId + per-slide snapshot + Puppeteer/sharp WebP pipeline + restore-aware indicator | ✅ |
| 8 | **Dashboard Tile Rework** — full-bleed thumbnail + scrub + click-to-lightbox + lightbox slider + .tq-h1 / .tq-subhead unified typography | ✅ |
| 9 | **3-dots Menu** — Favorites toggle + Copy link + Inline rename + Send to trash (wired); Share + Use as template (stubbed); Save copy as template (disabled) | ✅ (step 9f shipped 2026-05-20) |
| 9.5 | **Content language picker + prompt directive** — user-explicit AR/EN pick on /create/content drives Project.language + Presentation.direction + buildUserMessage's LANGUAGE block (Phase A + B). BiDi gating + dir="ltr" on rendered HTML deferred (Phase C). | ✅ (Phases A+B shipped 2026-05-20; C deferred) |
| 10 | **/favorites rename + isFavorite toggle** | ⏳ step 12 |
| 11 | **/create/from/[projectId]** content-only "use as template" entry | ⏳ step 13 |
| 12 | **/projects page** — 5-per-row grid + sort + filters (slide count / language / color) — language column is finally truthful, filter now works | ⏳ step 11 |
| 13 | **Share modal** — schema, Resend invites, public access, auto-clone on edit invites, PNG export, LinkedIn button | ⏳ step 15.1 → 15.6 |
| 14 | **PDF export** | ⏳ step 15.7 |
| 15 | **Enhance Flow review page** — Claude vision extraction + per-asset overrides | 🟡 |
| 16 | **Templates Flow 4** — `/templates` grid + filters, `/templates/[id]/content` apply | ⏳ |
| 17 | **Billing + quota enforcement** — Stripe webhooks → quota checks at job creation → meter UI | ⏳ |

> Mimic Flow (Flow 3) and Data deck Flow (Flow 5) are **dropped from the plan**.

---

## 17. Implementation Status & Lessons

### Working end-to-end today

- **Auth + dashboard.** Supabase email + Google OAuth → real DB-backed dashboard (RecentProjects, MyTemplates, PlanUsage, QuickActions).
- **Create wizard (Flow 1).** Content → brand → summary, with verbatim toggle, font picker, logo with position + exclusion pills.
- **Claude pipeline.** Opus 4.7 + adaptive thinking + prompt caching + self-healing Zod retry. Streams text deltas; throttled progress writes.
- **Preview window.** Cascade-in, slide-nav, comment authoring, per-slide pill (regen / history / lock), Save Project, thumbnail pipeline.
- **Partial regen.** Comment-driven slide regen with parallel Claude calls; deck stays visible during regen; atomic version promotion.
- **PPTX export.** ~99 % preview ↔ PPT parity for Arabic decks.
- **Thumbnail pipeline.** Puppeteer-rendered WebPs per slide on every Save; URLs in `Project.thumbnailUrls`.
- **Dashboard tile rework.** Full-bleed thumbnail + RTL scrub + click-to-lightbox; 3-col grid; canonical `.tq-h1` + `.tq-subhead`. 3-dots menu wired (favorites / copy link / inline rename / trash with confirmation + storage cleanup); share + use-as-template stubbed for steps 15 + 13.
- **Content language pick.** Two-pill picker (`العربية` / `الإنجليزية`) on `/create/content` drives `Project.language` + `Presentation.direction` + a LANGUAGE directive at the top of `buildUserMessage`. AR (default) reinforces RTL + Arabic font stack. EN instructs English-only deck text, dir=ltr, Latin typography. Phase C (BiDi post-processor gating on `language === "en"`) still deferred.
- **Notification system.** Bell dropdown + toast stack + per-user localStorage. Stuck-detection pushes warnings.

### Lessons learned — do not repeat

- **Discuss before coding (workflow rule).** For non-trivial UX/architecture, paraphrase + propose + wait for go.
- **Read globals.css header before any visual.** Never hardcode hex / rgba / blur / radius — compose from tokens / existing classes. Glass surfaces blur via Tailwind `backdrop-blur-glass`, never raw `backdrop-filter:`. Glass elements must have no transform/opacity in their ancestor chain.
- **Custom CSS rules outside `@layer` beat Tailwind utilities inside `@layer utilities`.** Spotted twice: once when `.text-muted` won over `.text-white`; once when a built-in `mb-6` on `.tq-h1` couldn't be overridden via `mb-0`. Workaround: build custom rules with the MINIMUM properties needed, leave the rest for Tailwind utilities to compose.
- **`page.screenshot({clip})` in Puppeteer goes blank when clip == viewport.** Pad the viewport to `canvasH × (slides + 1)` to ensure clip is strictly smaller.
- **Anthropic SDK client must be lazy.** `new Anthropic()` at module load captures whatever `process.env.ANTHROPIC_API_KEY` is at import time. Wrap in `getClient()` inside `step.run()`.
- **Don't use Anthropic structured outputs for the slide manifest.** Passing `zodOutputFormat(SlideManifestSchema)` returns 400. Use a strong system prompt, parse text, Zod-validate, retry with the error appended.
- **Inngest function must *update* v1, not create v2.** `POST /api/projects` creates a v1 PresentationVersion with status `queued`. The handler updates that row. `/regenerate` allocates v_n+1.
- **Send-after-commit is not atomic.** Wrap Inngest event dispatch with `sendInngestEventWithRetry` + status revert on final failure (see `lib/inngest-helpers.ts`).
- **USER RULES override system defaults — at the user-message level.** System prompt is cached; per-request mutations would kill the cache. Use `buildUserMessage`'s rules block.
- **Progress in slideJson, polled — Realtime not required.** Streaming progress writes to `slideJson.progress`; DeckView polls at 1.5 s. Supabase Realtime depends on publication config, which wasn't reliable on local Docker.
- **Local dev DB is Docker compose, not Supabase.** Postgres + Redis run locally via `docker compose up -d`. Supabase is auth + storage only.
- **Delete failed fixes, don't stack.** When a fix doesn't work, revert before trying the next; never accumulate dead paths.
- **Prisma `upsert`'s update branch can't reference current-row state.** If the new value depends on the existing value (e.g. "set `lockedAt = now()` ONLY if currently null"), the upsert update clause has no read-side. Bit us on `/lock/route.ts` where the update branch only wrote `{ cachedComments: DbNull }` for `shouldLock=true`, never `lockedAt` — existing SlideState rows stayed unlocked. Fix: read first, then upsert with the resolved value (see lock route's `existing?.lockedAt ?? new Date()` pattern). Applies anywhere we want idempotent-on-repeat semantics.
- **Outside-click handlers MUST exclude the trigger.** When a portal'd popover/menu uses `mousedown` to detect outside clicks, clicking the trigger fires `mousedown` (closes popover) → `click` (re-opens). Net result: trigger never closes the popover; it always re-opens. Fix: tag the trigger with `data-<name>-trigger` and skip the close in the handler when `e.target.closest("[data-<name>-trigger]")` matches. Bit us on `HistoryPopover` and would have bit `ProjectActionsMenu` if we'd missed it. Pattern: `data-history-trigger`, `data-project-menu-trigger`.

### Coding rules (from `app/globals.css`)

The top comment of `app/globals.css` is the canonical reference. CodeRabbit will flag violations.

- **Token-driven, not hex-driven.** Build new UI by composing semantic classes — never hardcode hex / `rgba()` in TSX.
- **Class catalog** (use, don't redefine): `.glass-card`, `.glass-empty-state`, `.glass-card-danger`, `.glass-dropdown`, `.glass-modal`, `.glass-popover`, `.btn-pill`, `.btn-gradient`, `.btn-gradient-anim`, `.canvas-gradient-border`, `.btn-outline-dark`, `.btn-danger`, `.btn-icon`, `.nav-item`, `.text-muted`, `.tq-h1`, `.tq-subhead`, `.input-dark`, `.tq-avatar-ring`, `.badge-purple`, `.progress-track`/`.progress-bar`, `.page-container`, `.tq-thumbnail`.
- **Four UI patterns**: (1) normal button → `.btn-pill`; (2) CTA → `.btn-gradient`; (3) layout surface (popover/menu/modal) → `.glass-popover` / `.glass-modal` + Tailwind `backdrop-blur-glass backdrop-saturate-[var(--glass-saturation)]`; (4) AI button → `.btn-gradient-anim`.
- **Glass system is runtime-tunable.** Card opacity/blur/saturation are CSS variables initialized by an inline script in `app/layout.tsx` before paint, switchable live from Settings → مظهر التطبيق.

### CodeRabbit (auto-review)

GitHub app auto-reviews `dev → main` PRs. For local CLI:

```bash
coderabbit auth login                 # one-time
coderabbit review --base origin/dev
coderabbit review --type uncommitted
```

---

## 18. Technical Risks

- **AI layout quality varies.** Claude occasionally picks colour matching the background or breaks one-line text into two. Prompt has hard rules; some slip through. Tighten with worked examples when a pattern repeats.
- **HTML sanitization gap (security).** Browser DOMPurify falls back to RAW HTML if SSR singleton lacks `.sanitize`. Single-user dev: fine. Sharing/templates: NOT fine. Server-side sanitisation in `deck-generate.ts` is the pre-launch fix. (The thumbnail pipeline already uses the JSDOM-backed mirror.)
- **PPTX import is complex (Enhance flow).** Don't promise pixel-perfect conversion. Extract palette/fonts/logo/structure outline; let Claude redesign from there.
- **RTL is the business — never regress.** Arabic direction, right alignment, font fallback by script, BiDi metadata, run-merge — all baked into the pipeline. Any change to `bidi-postprocess.ts` or `dom-to-pptx` patches must run through `/spike` first.
- **`dom-to-pptx` is solo-maintained.** Pinned at 1.1.8 + carry 5 patches via `patch-package`. Upgrade → regenerate via `npx patch-package dom-to-pptx`.
- **Claude HTML is unbounded.** Beyond schema shape, Claude could emit slow CSS or huge SVGs. Spot-check large decks with the spike harness.

> **Critical rule:** every Claude response goes through Zod validation. On failure, retry with the validation error appended. After 3 failed attempts the Inngest job fails and surfaces in Sentry. Never let unvalidated Claude output land in `PresentationVersion.slideJson`.

---

## 19. HTMLtoPPT Patch Index

Single ledger of every code-level enhancement on the HTML → PPT pipeline.

### A. `dom-to-pptx` library patches — `patches/dom-to-pptx+1.1.8.patch`

1. **Direction-aware `text-align` mapping** — `dist/dom-to-pptx.mjs` ≈L307 + ≈L2545. Patched to read `direction` and route `start`/`end`/unset to the correct OOXML value. Two emission sites; both must stay patched.
2. **`taqreer_hasUniformScript` in `isTextContainer`** — ≈L720–725. Returns `false` when a container's element children mix scripts. Recurses into mixed-script flex/grid rows.
3. **`isSafeInline` excludes bordered / rounded elements** — ≈L795. Pills / chips / badges keep their styling instead of collapsing into bare inline text.
4. **CSS padding emitted as PptxGenJS `margin`** — ≈L2646 + ≈L2771. PptxGenJS only honours `margin`. Two emission sites.

Total: 7 `Patched (taqreer)` markers.

### B. OOXML BiDi + gradient post-processor — `lib/export/bidi-postprocess.ts`

5. **PASS 1 — `<a:bodyPr rtlCol="1">` flip.**
6. **PASS 2 — paragraph-level RTL + smart run-merge + lang retag.**
7. **PASS 3 — direction-aware shape extension** with aspect-ratio guard (0.85 < cx/cy < 1.18 skips slack growth).
8. **PASS 3.5 — pill-row layout** (vertical-overlap clustering, push apart with 8 px min gap, restore POSITION-based anchor).
9. **PASS 4 — gradient-text sentinel swap** (sentinel `#FExxxx` → real `<a:gradFill>`).

### C. DOM preprocess + gradient extractor — `lib/export/html-export.ts` + `lib/export/gradient-text.ts`

10. **`splitMixedScriptFlexChildren`**.
11. **`stripArabicLetterSpacing`**.
12. **`insertScriptTransitionSpaces`**.
13. **`extractGradientIntents` + sentinel-hex bridge**.

### D. SlideRenderer — `components/slides/SlideRenderer.tsx`

14. **DOMPurify graceful fallback.** Falls back to RAW HTML when `.sanitize` unavailable (Turbopack SSR singleton issue). Pre-launch TODO: server-side sanitisation in `deck-generate.ts`. (The thumbnail server-side path already uses JSDOM-backed sanitiser.)

### Caveats

- **Run-level `gradFill` bounds to the parent shape.** Two inline gradient spans inside the same flex/grid container will read as one continuous gradient. Author each gradient text element as its own block-level node.
- **Run-merge collapses per-run formatting in RTL paragraphs.** PASS 2 keeps the first run's `rPr`.
- **Alpha in gradient stops is dropped.** Colour-to-alpha gradients round-trip as opaque.
- **Conic + repeating gradients are skipped.**

---

## 20. Agent Onboarding

If you're a fresh agent picking this up, read in this order:

1. **[`context/projects.md`](./projects.md)** — the active working plan. Current step + done/pending + open questions. **Source of truth for "what's next".**
2. This file (`context.md`) — architecture + how the pieces fit.
3. [`context/log.md`](./log.md) — dated changelog of every fix.
4. [`app/globals.css`](../app/globals.css) header — design system non-negotiables.
5. [`inngest/functions/deck-generate.ts`](../inngest/functions/deck-generate.ts) — system prompt + Claude call.
6. [`lib/schema/slide.ts`](../lib/schema/slide.ts) — v2 SlideManifest schema.
7. [`components/preview/DeckView.tsx`](../components/preview/DeckView.tsx) — preview state machine, comment + regen + save flows.
8. [`lib/export/html-export.ts`](../lib/export/html-export.ts) + [`bidi-postprocess.ts`](../lib/export/bidi-postprocess.ts) — export entry + BiDi post-processor.
9. [`app/spike/page.tsx`](../app/spike/page.tsx) — BiDi regression harness.

### Branch + PR strategy

- All work goes to `dev`.
- CodeRabbit reviews `dev → main` PRs.
- Don't auto-push. Commit freely; push only on user request, meaningful milestone, or >3 accumulated commits.

### Memory pointers

The Claude Code auto-memory at `~/.claude/projects/-Users-osama-taqreer/memory/` is loaded into every session via `MEMORY.md`. Re-read when in doubt:

**Project context:**
- `project_taqreer.md` — Arabic-first deck gen; RTL/BiDi quality is the differentiator.
- `project_html_pivot.md` — HTML pivot status, ~99 % parity milestone.
- `project_bidi_fix.md` — the three OOXML layers + run-merge architecture.
- `project_dom_to_pptx_patch.md` — the 5 library patches with line numbers.
- `project_local_dev.md` — DATABASE_URL → docker compose, Supabase is auth+storage only.

**Workflow rules (treat as non-negotiable):**
- `feedback_design_system_discipline.md` — never hardcode, always read globals.css header, never guess. User has flagged this 3+ times.
- `feedback_tw_glass_system.md` — Tailwind v4 backdrop-blur-glass utility, never raw `backdrop-filter:`.
- `feedback_discuss_before_coding.md` — paraphrase, propose, wait for go.
- `feedback_never_guess.md` — context/log is source of truth.
- `feedback_delete_failed_fixes.md` — revert before trying the next; never accumulate dead paths.
- `feedback_push_rhythm.md` — don't auto-push; batch commits before pushing.
- `feedback_badge_blue.md` — info chips use Tailwind `bg-blue-500`, not `--tq-blue`.
- `feedback_verify_api_features.md` — WebFetch Anthropic docs before claiming behaviour.

**Quick reference:**
- `reference_docs.md` — MAC_MIGRATION.md + context paths + globals.css tokens.

### Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop

git clone https://github.com/taqreerai/taqreer.git
cd taqreer
npm install                  # postinstall auto-applies the dom-to-pptx patch

# Get .env.local from the team. Required:
#   DATABASE_URL=postgresql://taqreer_user:...@localhost:5432/taqreer
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL=...
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   INNGEST_EVENT_KEY=...
#   INNGEST_SIGNING_KEY=...

docker compose up -d         # postgres 16 + redis 7 detached
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost

# two long-running processes:
npm run dev                  # Next.js on :3000
npx inngest-cli@latest dev   # Inngest dev server on :8288

# helpful scripts:
npx tsx scripts/wipe-decks.ts            # wipe all decks + storage (keeps users)
npx tsx scripts/dump-latest-slide-1.ts   # print latest deck's slide 1 JSON
npx tsx scripts/setup-storage.ts         # one-time Supabase bucket setup (idempotent)
```

### Anti-patterns to avoid

- **Don't reintroduce coordinate math.** The HTML pivot deleted bbox arithmetic, RTL coordinate mirroring, logo coord locking. Don't add them back; the browser does layout.
- **Don't add features that bypass Claude.** No drag-to-edit, no manual element editor. Visual changes go through Claude (regenerate, partial regen, restore).
- **Don't skip the spike.** Any change to `dom-to-pptx` patches or `bidi-postprocess.ts` must run through `/spike` first.
- **Don't tighten the schema.** Zod schema validates SHAPE, not content. Tightening with discriminated unions burns 10 minutes per generation in self-healing retries.
- **Don't hardcode visuals.** Every visual token has a slot in `globals.css`. If a pattern you need isn't there, ADD it there first, give it a class, consume the class from TSX.

---

*Living document — updated each shipping milestone. See [`log.md`](./log.md) for the dated changelog and [`projects.md`](./projects.md) for the current working plan.*
