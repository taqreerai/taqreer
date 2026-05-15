# Taqreer — Architecture & Handover

Arabic-first, RTL AI presentation platform (taqreer.ai). User provides content + brand, **Claude designs each slide as HTML**, the browser renders it 1:1, and a patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX. There is no manual slide editor — every visual change goes through Claude.

| | |
|---|---|
| **Stack** | Next.js 16 + Turbopack, React 19, TypeScript 5, Prisma 7 + Postgres, Inngest, Supabase (auth + storage), Anthropic SDK |
| **Output** | PPTX (shipped), PDF (pending), templates (pending) |
| **Differentiator** | HTML-first generation; preview = export; ~99% Arabic PPT parity via custom BiDi post-processor |
| **Branch strategy** | All work goes to `dev`. CodeRabbit reviews `dev → main` PRs. No more feature branches. |

For the dated log of every fix, see [`log.md`](./log.md). For the patch ledger with file:line references, see §19.

**Status legend:** ✅ shipped · 🟡 partial · ⏳ pending

---

## Table of Contents

1. [Overview](#01-overview)
2. [Product Flows](#02-product-flows)
3. [Tech Stack](#03-tech-stack)
4. [System Architecture](#04-system-architecture)
5. [Routes](#05-routes)
6. [Data Model](#06-data-model)
7. [Slide Manifest Schema](#07-slide-manifest-schema-v2--html-first)
8. [AI Pipeline](#08-ai-pipeline)
9. [Preview Window](#09-preview-window)
10. [AI Comments (spec)](#10-ai-commenting-and-regeneration)
11. [Templates (spec)](#11-template-system)
12. [Export Pipeline](#12-export-pipeline)
13. [Pricing & Quotas](#13-pricing--quotas)
14. [Build Phases](#14-build-phases)
15. [Implementation Status & Lessons](#15-implementation-status--lessons-learned)
16. [Risks](#16-technical-risks)
17. [MVP Scope](#17-mvp-scope)
18. [HTML Pivot — decision + what shipped](#18-html-pivot--decision--what-shipped)
19. [Patch Index](#19-htmltoppt-patch-index)
20. [Agent Onboarding](#20-agent-onboarding)

---

## 01. Overview

User provides content + brand assets. Claude generates every slide as a string of HTML/CSS. Browser renders the slide; export pipeline measures the rendered DOM and emits a PPTX. User lands in the Preview Window to review, regenerate, export, or save as a template.

| Flow | What it does |
|---|---|
| **1. Create (إنشاء)** | Start from scratch. Paste/upload content, set brand, generation rules. Claude designs from a fresh palette. |
| **2. Enhance (تحسين)** | Upload an existing PPT. Claude extracts the original theme/palette/fonts and redesigns the layout while preserving brand identity. |
| **3. Mimic (محاكاة)** | Upload your content + a reference deck whose style you admire. Claude rebuilds your content in the reference style. Iterative review loop. |
| **4. From Template (إنشاء من قالب)** | Pick a template, add content. The template supplies the design system; Claude maps your content into it. |
| **5. From Data (إنشاء من بيانات)** | Upload an Excel/CSV, pick brand. Claude reads the file directly and composes a data-presentation deck (charts as inline SVG, KPI cards, comparisons). No server-side parsing, no sheet editor — auto-pilot. ⏳ Standby — un-stubs after Flow 2 (Enhance) ships. |

> **Core product rule:** every journey ends inside the Preview Window. Preview is review-only — browse slides, regenerate, export to PPTX/PDF, save as a template. No manual editor; visual changes go through Claude.

---

## 02. Product Flows

Four primary flows on the dashboard, RTL right→left.

### Flow 1 — Create (إنشاء) — start from scratch

Dashboard tile 1 → `/create/content`. Three-step wizard, brand decided fresh by Claude.

1. **Content** (`/create/content`) — Upload PPTX/PDF/DOCX/TXT/images or paste text. Verbatim toggle (`اتركها لنا`).
2. **Brand & Settings** (`/create/brand`) — Palette + fonts + logo + position picker + slide size + count. Logo cover/closing exclusion pills.
3. **Summary & Rules** (`/create/summary`) — Editable content + rules card (tone, design style, fix typos, pagination, persistent overlay). CTA: `إنشاء` or `إنشاء وحفظ كهوية بصرية`. POST `/api/projects` → `/preview/[projectId]`.
4. **Generate** (`/preview/[projectId]`) — Fires Inngest `deck.generate.requested`. Page handles generating state — placeholders + per-card progress polled at 1.5 s. On complete, slides cascade in.

### Flow 2 — Enhance (تحسين) — preserve original theme/colors

Dashboard tile 2 → `/enhance`. Goal: improve a deck while keeping its original visual identity.

1. **Upload** (`/enhance`) — PPTX-only. Advanced: keep colors, keep fonts, custom instructions. ✅ shipped
2. **Review** (`/enhance/review`) — Show extracted palette, fonts, logo, structure + redesign plan; allow per-asset overrides. 🟡 stub — needs Claude vision extraction wiring.
3. **Generate** — Fires `deck.generate.requested` with `type: "enhance"`. ⏳ pending

### Flow 3 — Mimic (محاكاة) — redesign in a reference style

Dashboard tile 3 → `/mimic`. Two uploads + iterative review. ⏳ entire flow pending.

### Flow 4 — From Template (إنشاء من قالب)

Dashboard tile 4 → `/templates`. 🟡 templates page is a shell; `/templates/[id]/content` not built.

### Flow 5 — From Data (إنشاء من بيانات) — auto-pilot

Dashboard tile 5 → `/datasheet`. ⏳ scaffolded as "قريباً" stub. Un-stubs after Flow 2 ships.

**MVP shape (per 2026-05-15 product call):**

1. **Upload** — `.xlsx` / `.xls` / `.csv` to Supabase Storage (same path as Flow 1's content step).
2. **Brand** — same wizard as Flow 1, OR pick a saved BrandKit.
3. **Generate** — fires `deck.generate.requested` with `type: "data"` and the file attached. Claude reads the file directly (Anthropic Files API or attachment); no server-side parser.
4. **Render** — same `/preview/[projectId]`. Claude composes data slides with inline `<svg>` charts (round-trip to OOXML vectors via `svgAsVector: true`). No sheet editor; the deck is the deliverable.

**Pieces still to build when un-stubbed:** XLSX → Anthropic file-upload glue in `/api/projects` route, `type: "data"` branch in `inngest/functions/deck-generate.ts`, "DATA DECK MODE" prompt section telling Claude how to compose data slides + emit SVG charts.

---

## 03. Tech Stack

Actual installed dependencies as of 2026-05-15. See `package.json` for exact versions.

| Layer | Tools | Purpose |
|---|---|---|
| Frontend | Next.js 16.2 (App Router, Turbopack), React 19.2, TypeScript 5 | Application shell, dashboard, creation flows, preview |
| Styling | Tailwind 4 (PostCSS), `globals.css` token system, Framer Motion 12, GSAP, Lenis | Tokens (`--tq-*`, `--glass-*`), interactions, scroll/animation |
| State | Server-rendered props + `useState`; no global store | `sessionStorage` handoff between wizard steps |
| Database | PostgreSQL 16 (Docker compose for local), Prisma 7.8 (`@prisma/adapter-pg`) | Users, projects, presentations, brand kits, jobs |
| Auth + Storage | Supabase (`@supabase/ssr` 0.10, `supabase-js` 2.105) | Email + Google OAuth; signed file uploads |
| Queue | Inngest 4.3 (local: `npx inngest-cli@latest dev`) | Long-running AI generation, export, regeneration |
| AI | Anthropic SDK 0.95 (Claude Opus 4.7, streaming, adaptive thinking, prompt caching, self-healing retry) | Slide HTML generation; brand/area extraction (planned) |
| Export | `dom-to-pptx` 1.1.8 (patched), PptxGenJS 4 (under the hood), JSZip, Puppeteer 24 (PDF — pending) | HTML→PPTX via offscreen render + library + custom OOXML post-processor |
| Validation + Sanitization | Zod 4, DOMPurify 3.4 (with graceful fallback — see §15) | Slide manifest shape; HTML sanitization at render |
| Observability | Sentry (`@sentry/nextjs` 10.52) | Error reporting from API routes + Inngest jobs |
| Billing (planned) | Stripe 22 SDK + Resend 6 transactional email | Plans, quotas, payment webhooks. Not yet wired. |

> **Local dev requirement:** Postgres 16 + Redis 7 via `docker compose up -d`. `.env.local`'s `DATABASE_URL` points at `localhost:5432`; Supabase is auth+storage only, not the DB.

---

## 04. System Architecture

Browser-side render + library + post-processor. Inngest does the long-running generation.

```
User
 |
 | Next.js 16 Web App  (Turbopack)
 |   - (marketing)/  Landing
 |   - (auth)/       Supabase email + Google OAuth
 |   - (app)/        Dashboard, Projects, Templates, Settings, Preview
 |   - /create/*     Flow 1 wizard (content → brand → summary)
 |   - /enhance/*    Flow 2 wizard (upload → review)
 |   - /spike        BiDi regression harness (don't delete)
 |
API Layer  (app/api/*)
 |
 |-- /projects                          POST creates project + fires deck.generate.requested
 |-- /projects/[id]/status              GET polled by DeckView every 1.5 s
 |-- /projects/[id]/retry               POST retry failed generation
 |-- /projects/[id]/regenerate          POST allocate v_n+1 + re-fire
 |-- /projects/[id]/save-as-template    POST fires template.save.requested
 |-- /storage/upload                    POST signed Supabase Storage upload
 |-- /inngest                           Inngest SDK connector
 |-- /auth/user-sync                    POST upserts the Prisma User from Supabase auth
 |-- /usage/plan                        GET plan + quota
 |
PostgreSQL (Prisma 7.8)
 |
 |-- User, Account, Session, Subscription, UsageEvent
 |-- Project, Presentation, PresentationVersion (slideJson)
 |-- File, Comment, Job, Template, BrandKit, Folder
 |
Supabase Storage
 |
 |-- source-files/   Uploaded PPTX/PDF/DOCX/TXT/images
 |-- brand-assets/   Logos, palette screenshots, fonts
 |-- exports/        (planned) Generated PPTX/PDF
 |
Inngest functions  (inngest/functions/*)
 |
 |-- deck-generate.ts    Claude Opus 4.7 → SlideManifest with HTML strings
 |                       (streaming, adaptive thinking, prompt caching, self-healing Zod retry)
 |-- brand-analyze.ts    legacy, needs SDK rewrite
 |-- template-save.ts    legacy, needs SDK rewrite
 |
Export pipeline  (client-side, in /preview)
 |
 |-- SlideRenderer mounts manifest.slides offscreen at 1920×1080 with theme CSS vars
 |-- DOM preprocess: splitMixedScriptFlexChildren, stripArabicLetterSpacing,
 |                   insertScriptTransitionSpaces, extractGradientIntents
 |-- dom-to-pptx (patched) measures the DOM, emits skipDownload Blob
 |-- bidi-postprocess: PASS 1 (rtlCol) + PASS 2 (pPr/run-merge/lang) + PASS 3 (shape extension) + PASS 4 (gradFill swap)
 |-- downloadBlob → user gets the .pptx
```

---

## 05. Routes

### Frontend Routes

```
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
    projects/page.tsx                   ✅
    templates/page.tsx                  🟡  shell only — needs search, filter, "create from template" CTA
    templates/[id]/content/page.tsx     ⏳  Flow 4
    brand-kits/page.tsx                 🟡  stub
    folders/page.tsx                    ✅
    features/page.tsx                   ✅
    settings/page.tsx                   ✅  Account + glass-preset live tuning
    preview/[projectId]/page.tsx        ✅  Unified preview — placeholders + cascade-in + vertical toolbar

  create/                               Flow 1 — إنشاء
    page, layout, content,
    brand, summary, generating          ✅  Three-step wizard

  enhance/                              Flow 2 — تحسين
    layout, page                        ✅  Upload step
    review/page                         🟡  needs Claude extraction display + redesign plan

  mimic/                                Flow 3 — محاكاة
    content, reference, review          ⏳  entire flow

  datasheet/                            Flow 5 — إنشاء من بيانات
    page.tsx                            ⏳  stub only ("قريباً") — un-stubs after Flow 2

  spike/page.tsx                        ✅  BiDi regression harness — don't delete
```

### API Routes

```
app/api/
  projects/route.ts                          ✅  POST creates project + fires deck.generate.requested
  projects/[id]/status/route.ts              ✅  GET polled by DeckView every 1.5 s
  projects/[id]/retry/route.ts               ✅  POST retry failed generation
  projects/[id]/regenerate/route.ts          ✅  POST allocate v_n+1 + re-fire
  projects/[id]/save-as-template/route.ts    ✅  POST fires template.save.requested
  storage/upload/route.ts                    ✅  POST signed Supabase Storage upload
  inngest/route.ts                           ✅  GET/PUT Inngest SDK connector
  auth/user-sync/route.ts                    ✅  POST upsert Prisma User (try-catch + profile sync)
  auth/delete-account/route.ts               ✅  POST cascade delete
  usage/plan/route.ts                        ✅  GET plan + quota

  // Pending
  ai/enhance-extract/route.ts                ⏳  Flow 2 — Claude vision extracts theme/palette/fonts
  ai/mimic-extract/route.ts                  ⏳  Flow 3 — extracts reference style contract
  templates/[id]/route.ts                    ⏳  GET single template
  export/pdf/route.ts                        ⏳  PDF path
  webhooks/stripe/route.ts                   ⏳  Billing
```

---

## 06. Data Model

Prisma 7.8 with PostgreSQL. Tables are PascalCase — when querying via `psql`, double-quote them: `"PresentationVersion"`, `"Project"`, etc.

| Model | Purpose | Notable fields |
|---|---|---|
| **User** | Mirrored from Supabase auth via `/api/auth/user-sync`. | `supabaseUserId` (unique), email, name, image, plan |
| **Account, Session** | Auth.js compat tables (Supabase covers the active session). | provider, providerAccountId |
| **Project** | Top container per generation. Title is promoted from the Claude-generated manifest title on completion. | userId, title, status, folderId |
| **Presentation** | One per Project; points at the active version. | projectId, currentVersionId, language, direction, aspectRatio |
| **PresentationVersion** | **The slide manifest lives here.** `slideJson` stores either the in-flight progress shape or the final v2 manifest. | presentationId, versionNumber, slideJson, status, createdBy |
| **BrandKit** | Reusable brand systems (palette/fonts/logo). Saved when user picks "إنشاء وحفظ كهوية بصرية". | userId, name, jsonData |
| **File** | Uploaded source files, logos, generated artifacts. | projectId, type, filename, mimeType, storageUrl |
| **Job** | Inngest job tracking row (status + outputJson for later inspection). | type, status, inputJson, outputJson, progress, errorMessage |
| **Template** | Public + user-saved templates. ⏳ spec | userId, name, category, language, direction, thumbnailUrl, jsonData |
| **Comment** | Future area/element comments. ⏳ spec | presentationId, slideId, type, positionJson, content, status |
| **Folder** | User-organized project folders. | userId, name, parentId |
| **Subscription, UsageEvent** | Stripe + quota tracking. ⏳ wired up but not enforced end-to-end yet | plan, status, currentPeriodEnd, eventType, count |

**Inngest event types:** `deck.generate.requested` · `brand.analyze.requested` · `area.redesign.requested` · `deck.export.requested` · `template.save.requested`

**File types:** `source_content` · `brand_guideline` · `logo` · `reference_ppt` · `original_ppt` · `image` · `exported_pptx` · `exported_pdf`

---

## 07. Slide Manifest Schema (v2 — HTML-first)

The schema lives in [`lib/schema/slide.ts`](../lib/schema/slide.ts). Each slide is a string of HTML. The browser does layout; `dom-to-pptx` measures the rendered DOM. **Permissive by design** — validate the shape, not the content.

```jsonc
// Top-level manifest
{
  "version": "2.0",
  "presentationId": "uuid",
  "title": "3–8 word presentation title",   // promoted to Project.title + PPTX filename
  "language": "ar" | "en",
  "direction": "rtl" | "ltr",
  "theme": {
    "palette": ["#FF0080", "#7C3AED", ...],   // 2–8 hex colours, exposed as --brand-1, --brand-2, ...
    "fontHeading": { "name": "Cairo", "url": "https://..." | undefined },
    "fontBody":    { "name": "Inter", "url": "https://..." | undefined },
    "background": "#0D0B1F",                   // exposed as --brand-bg
    "text":       "#FFFFFF"                    // exposed as --brand-text
  },
  "slides": [
    { "slideId": "s1", "role": "cover", "html": "<div style=...>...</div>" },
    { "slideId": "s2", "role": "content", "html": "..." }
  ],
  // Streaming progress, present during generation, removed when complete:
  "progress": { "stage": "designing", "currentSlide": 3, "estimatedTotal": 7 }
}
```

### Slide HTML rules (enforced by the system prompt)

- No `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` wrapper. Slide body content only.
- Set `dir="rtl"` or `dir="ltr"` on the slide root. The export pipeline handles all BiDi metadata downstream — no `<bdi>`, no U+200E/U+200F marks.
- Inline `<style>`, `<svg>`, `<link>`, `<img>` allowed; `<script>`, event handlers, `javascript:` URIs are stripped at render by DOMPurify (graceful fallback when SSR singleton is missing — see §15).
- Slide roles: `cover · section · content · stats · quote · image · closing` (optional).

The pre-pivot schema was a JSON manifest with per-element `{type, x, y, width, height, style.fontSize, …}`. Claude was doing layout math. That schema was deleted in §18.

---

## 08. AI Pipeline

Single Claude call per deck. The Inngest function streams text deltas, throttles progress writes to `slideJson.progress`, validates with Zod, retries on schema failure with the validation error appended to the prompt.

### Create Deck (Flow 1)

1. **Brief assembly** — `POST /api/projects` persists Project + v1 PresentationVersion (status `queued`), then fires `deck.generate.requested` with the brief (content + brand + rules).
2. **Inngest `deck-generate`** — Calls `buildUserMessage` to produce a "Generation rules" block (tone, design-style hints, typo policy, pagination, persistent overlay, verbatim mode, logo placement). USER RULES at the top of the user message override system defaults — keeps the system prompt cacheable.
3. **Claude Opus 4.7 stream** — Adaptive thinking on, prompt caching on, anthropic-beta context-1m. Subscribes to `stream.on("text")`, counts `"slideId":` occurrences = current slide, throttles DB writes (~800 ms) into `slideJson.progress`.
4. **Parse + Zod validate** — Strip markdown fences, parse JSON, validate with `SlideManifestSchema`. On failure: append the Zod error to the prompt and retry (max 3 attempts inside the Inngest step).
5. **Persist + promote title** — Update v1 row to `completed` with the final manifest. Promote `manifest.title` to `Project.title` and `Presentation.title`; sanitised for the export filename.

### Enhance Deck (Flow 2) — partial

Upload PPTX → `brand.analyze.requested` (planned) extracts palette/fonts/logo via Claude vision → review page lets user override → `deck.generate.requested` with `type: "enhance"` + the (possibly overridden) brand contract → same generation flow.

### Mimic Deck (Flow 3) — pending

Content upload + reference upload → `mimic.extract.requested` (planned) extracts the reference style contract → iterative review → `deck.generate.requested` with `type: "mimic"` and the reference style as additional context.

> **System prompt size:** the `SYSTEM_PROMPT` const in [`inngest/functions/deck-generate.ts`](../inngest/functions/deck-generate.ts) is the source of truth for what Claude is told. Edit it directly — there is no separate prompt store. It's marked `cache_control: ephemeral`, so per-request mutations would kill the cache; per-request rules go through `buildUserMessage`.

---

## 09. Preview Window

**Review-only.** Users browse slides, regenerate the deck, export, save as template. There's no element editor — visual changes go through Claude.

```
┌────────────────────────────────────────────────────────────┐
│   Vertical action toolbar (left)                          │
│   - Regenerate (أعد التصميم)                              │
│   - Export PPTX                                           │
│   - Export PDF (قريباً)                                   │
│   - Save as template                                      │
│   - Comment (قريباً)                                      │
│                                                           │
│   Main slide area (center)                                │
│     - Cascade-in slides at 1920×1080 (scaled to fit)      │
│     - Generating state: placeholder grid + per-card        │
│       progress (done ✓ / current spinner / pending pulse) │
└────────────────────────────────────────────────────────────┘
```

### Rendering approach

`SlideRenderer` ([`components/slides/SlideRenderer.tsx`](../components/slides/SlideRenderer.tsx)) renders each `slide.html` string inside a fixed 1920×1080 wrapper with theme CSS vars (`--brand-bg`, `--brand-text`, `--primary`, `--secondary`, `--brand-1..N`, `--font-heading`, `--font-body`) and the document's `direction` set on the root. DOMPurify is attempted on every render with a runtime check for `.sanitize`; if unavailable (Turbopack SSR singleton issue, see §15), falls back to RAW HTML — acceptable for single-user dev, NOT for sharing/templates (security TODO).

### Status

- ✅ Streaming generation with per-card progress polled at 1.5 s from `/api/projects/[id]/status`
- ✅ Cascade-in slide reveal (Framer Motion stagger)
- ✅ Vertical toolbar: Regenerate, Export PPTX, Save as template (popover form)
- ⏳ Slide-panel side navigation (thumbnails)
- ⏳ Area-select + comment overlay (toolbar slot is "قريباً" placeholder)
- ⏳ PDF export (toolbar slot is "قريباً")

---

## 10. AI Commenting and Regeneration

> **Status: spec, not built — needs reframing for HTML-first.** The original spec assumed element-level patches against a JSON-element schema (`update_element` with `x/y/width/height`). With HTML-first, area-redesign would either patch the slide HTML (LLM rewrites a region) or regenerate the whole slide. Design decision pending.

### Original spec (preserved for reference)

Users highlight a region on a slide, leave a text comment ("make this more premium"), and Claude regenerates that area. Comment types: `deck_comment` · `slide_comment` · `element_comment` · `region_comment`. Inngest event: `area.redesign.requested`. Handler sends Claude a focused context package (current slide HTML, brand kit, selected region, user comment) and returns a patch.

---

## 11. Template System

> **Status: spec, not built — see §14 Phase 6.** Templates page is a shell at `/templates`. Apply-template flow at `/templates/[id]/content` not built. Save-as-template wires the Inngest event but no UI flow yet.

### Original spec (preserved)

Templates store a v2 SlideManifest as `jsonData` + thumbnail. Browse with category/industry/language/direction/plan filters. Pick a template → upload content → Claude maps content into the template's design system. Save current project as a template.

**Recommended categories:** Business Proposal · Investor Report · Pitch Deck · Company Profile · Training Deck · Financial Report · Strategy Deck · Marketing Plan · Event Proposal · Arabic RTL · Government Style · Minimal Corporate.

---

## 12. Export Pipeline

Client-side, in [`lib/export/html-export.ts`](../lib/export/html-export.ts). The preview HTML is the source of truth for the export.

```
1. exportManifestAsPptx(manifest, fileName)
2. Mount slides offscreen at 1920×1080, full opacity, no scale transform
3. Wait for React commit + fonts.ready + every <img>.complete
4. DOM preprocess (4 passes):
   - splitMixedScriptFlexChildren    wrap text nodes when sibling has dir or parent is flex/grid
   - stripArabicLetterSpacing        kill inherited letter-spacing on Arabic-bearing elements
   - insertScriptTransitionSpaces    add space at every Arabic↔Latin / Arabic↔digit adjacency
   - extractGradientIntents          replace background-clip:text + gradient with sentinel hex (#FExxxx)
5. exportToPptx(slideNodes, { skipDownload: true, svgAsVector: true })
   ↳ patched dom-to-pptx (5 fixes — see §19 patch index)
6. fixBiDiInPptxBlob(blob, JSZip, stats, intents)
   ↳ PASS 1  rtlCol="1" on RTL bodyPr
   ↳ PASS 2  pPr rtl/algn + smart run-merge + lang retag + LTR override
   ↳ PASS 3  direction-aware shape extension (10% on opposite side, capped)
   ↳ PASS 4  swap sentinel solidFill → real <a:gradFill>
7. downloadBlob(fixedBlob, fileName)
```

**PDF export — pending.** UI shows "قريباً". Plan: Puppeteer prints the same SlideRenderer HTML to PDF (one page per slide). `puppeteer` 24 is already installed.

For per-patch detail see [§19 Patch Index](#19-htmltoppt-patch-index).

---

## 13. Pricing & Quotas

Schema is wired (`Subscription` + `UsageEvent`); enforcement is partial.

| Plan | Limits | Features |
|---|---|---|
| Free | 10 slides, daily quota, limited exports | Create, enhance, selected templates, PPTX export |
| Plus | Up to 60 slides, higher quota, larger uploads | Reusable brand kits, more templates, PPTX/PDF, better AI |
| Pro | Up to 90 slides, highest quota, priority jobs | Save custom templates, area-redesign, premium templates, priority queue |

```jsonc
// Quota fields per plan
{
  "plan": "pro",
  "maxSlidesPerDeck": 90,
  "maxDailyGenerations": 50,
  "maxUploadSizeMb": 100,
  "maxBrandKits": 20,
  "maxSavedTemplates": 50,
  "maxExportsPerDay": 100
}
```

---

## 14. Build Phases

Status as of 2026-05-15.

| # | Phase | Status |
|---|---|---|
| 1 | **Foundation** — Next.js 16 + Turbopack, Tailwind 4, Supabase auth + storage, Postgres via Docker, Prisma 7.8, dashboard, project creation flow | ✅ shipped |
| 2 | **Slide Manifest Engine** — v2 schema, SlideRenderer at 1920×1080, manifest persisted to `PresentationVersion.slideJson` | ✅ shipped |
| 3 | **AI Deck Generation** — Anthropic SDK, Opus 4.7 with streaming + adaptive thinking + prompt caching + 1M context beta, self-healing Zod retry, USER RULES override pattern | ✅ shipped (brand vision extraction still planned for Flow 2) |
| 4 | **Preview Window MVP** — SlideRenderer HTML, vertical toolbar, generating placeholders + per-card progress polling, cascade-in animation | 🟡 partial — slide-panel thumbnails + area-select overlay still pending |
| 5 | **Export** — HTML → PPTX via patched `dom-to-pptx` + 4-pass post-processor; ~99% Arabic parity | ✅ PPTX shipped · ⏳ PDF pending |
| 6 | **Templates Library + Flow 4** — `/templates` grid + filters, "Create from this template" CTA → `/templates/[id]/content` | ⏳ pending |
| 7 | **Enhance Flow** — upload page shipped; review page needs Claude vision extraction + per-asset overrides | 🟡 partial |
| 8 | **Mimic Flow** — content + reference upload, iterative review | ⏳ pending |
| 9 | **From Data Flow** — upload Excel/CSV, Claude reads it directly, composes data deck with inline SVG charts. Stub at `/datasheet` is in place; full build kicks off after Phase 7 (Enhance) ships | ⏳ pending (stubbed) |
| 10 | **Logo support** — Stage 1 ✅ shipped (2026-05-15): SVG-only enforcement on `/create/brand` + server-side at `/api/storage/upload`; prompt updated with logo-color/contrast rule (Claude inspects logo dominant ink, designs background to contrast). Stage 2 ⏳ pending: server-side SVG monochrome detection + `currentColor` rewrite so Claude can recolour monochrome wordmarks per slide via CSS instead of relying on prompt-only handling. | 🟡 partial |
| 11 | **Billing + quotas enforcement** — Stripe webhooks → Subscription rows → quota checks at job creation → quota meter UI | ⏳ pending |

---

## 15. Implementation Status & Lessons Learned

### Working end-to-end today (2026-05-15)

- **Auth + dashboard.** Supabase email + Google OAuth → real DB-backed dashboard (RecentProjects, MyTemplates, PlanUsage).
- **Create wizard (Flow 1).** Content → brand → summary, with verbatim toggle, font picker, logo with position + exclusion pills, rules card.
- **Claude pipeline.** `deck-generate` Inngest function, Opus 4.7 + adaptive thinking + prompt caching + self-healing Zod retry. Streams text deltas; throttled progress writes to `slideJson.progress`.
- **Manifest title promotion.** Claude-generated 3–8-word title becomes `Project.title` + PPTX export filename (sanitised for FS).
- **Preview + generating fused.** `/preview/[projectId]` handles generating (per-card progress), completed (cascade-in), failed (retry/back).
- **Status polling.** `/api/projects/[id]/status` at 1.5 s; `router.refresh()` on completion picks up the manifest. (Realtime is optional.)
- **HTML→PPTX export.** ~99% preview ↔ PPT parity for Arabic decks. Pipeline: SlideRenderer offscreen → preprocess → patched dom-to-pptx → bidi-postprocess → download.
- **Reliable event dispatch.** Every Inngest event-after-commit uses `sendInngestEventWithRetry` (4 attempts, exponential backoff) + status revert on final failure.
- **Dev tooling.** `scripts/wipe-decks.ts` wipes all deck rows + storage; `scripts/dump-latest-slide-1.ts` prints slide-1 of the most recent deck.
- **Spike harness** at `/spike` — 4 hand-crafted RTL test slides + before/after XML diagnostic. Re-run after any `dom-to-pptx` upgrade or BiDi change.

### What's left

> ⚠️ **SECURITY — server-side sanitization before sharing/templates launch.** Today's renderer falls back to RAW HTML when DOMPurify's `.sanitize` isn't available. Acceptable for single-user dev; **NOT** acceptable when decks can be shared or templated. Plan: sanitize server-side in `inngest/functions/deck-generate.ts` before Claude's HTML hits the DB. Options: (a) `sanitize-html` server-side, (b) SSR-safe client sanitizer, (c) force a client-only DOMPurify load.

- **Logo support (user-end implementation)** — Phase 9 next step; design + UX scoped to the user.
- **Same-colour-as-background** — Claude occasionally picks text/shape colour matching its container. Prompt has forbidden-combinations rules; would need a theme-aware contrast compositor in code to fully prevent.
- **Enhance review page** — needs `brand.analyze.requested` wiring to display Claude's extracted palette/fonts/logo before generation.
- **Slide-panel + area-comment overlay** in Preview Window (Phase 4 remaining).
- **PDF export** via Puppeteer.
- **Mimic flow + Templates flow** entire builds.
- **Other Inngest functions** (`brand-analyze`, `template-save`) still use legacy `fetch` against the Claude API — need the SDK rewrite that `deck-generate` got.

### Lessons learned — do not repeat

- **Anthropic SDK client must be lazy.** `new Anthropic()` at module load captures whatever `process.env.ANTHROPIC_API_KEY` is at import time. If env loading races module load, the client captures empty *permanently*. Wrap in `getClient()` called inside `step.run()`.
- **Don't use Anthropic structured outputs for the slide manifest.** Passing `zodOutputFormat(SlideManifestSchema)` returns 400 *"compiled grammar is too large"*. Use a strong system prompt, parse Claude's text (strip markdown fences), Zod-validate, retry on failure with the validation error appended. Self-healing pattern, max 3 attempts.
- **Inngest function must *update* v1, not create v2.** `POST /api/projects` creates a v1 PresentationVersion with status `queued`. The handler must update the v1 row (using `versionId` from the event payload). The `/regenerate` route is the place to allocate v_n+1.
- **Send-after-commit is not atomic.** Routes that fire Inngest events after a Prisma transaction can leak orphaned "queued" rows if the send fails. Always wrap with `sendInngestEventWithRetry` (in `lib/inngest-helpers.ts`) and revert statuses to `failed` on final failure.
- **USER RULES override system defaults — at the user-message level.** System prompt is `cache_control: ephemeral`; per-request mutations would kill the cache. The prompt has a top-of-prompt "USER RULES (HIGHEST PRIORITY)" section + `buildUserMessage` emits a "Generation rules" block at the end of every request. Cache stays hot; behavior is per-request.
- **Progress in slideJson, polled — Realtime not required.** Streaming progress writes to `slideJson.progress`; DeckView polls `/api/projects/[id]/status` at 1.5 s. Supabase Realtime depends on the publication being configured, which wasn't reliable.
- **Sync server props into client state on `router.refresh()`.** `useState(initialManifest)` only seeds on mount. The polling fallback that triggers `router.refresh()` on complete updates server props but leaves client state stuck on "generating". Fix: a `useEffect` that pulls `initialManifest` into state on null → non-null AND clears the cached manifest when the server reports a queued version.
- **Strip `previewDataUrl` from Claude input.** The Create wizard used to send the logo as a base64 data URL — bloated each Claude call by ~3000 input tokens for no benefit. Drop it; the renderer uses `storageUrl`.
- **Discuss before coding (workflow rule).** For non-trivial UX/architecture/design requests, pause: paraphrase intent, propose plan, surface tradeoffs, wait for explicit "go".
- **Local dev DB is Docker compose, not Supabase.** Postgres + Redis run locally via `docker compose up -d`; `.env.local`'s `DATABASE_URL` points at `localhost:5432`. Supabase is auth + storage only.

### Coding rules (from `app/globals.css`)

The top comment of `app/globals.css` is the canonical reference. CodeRabbit will flag violations.

- **Token-driven, not hex-driven.** Build new UI by composing semantic classes — never hardcode hex or `rgba()` in TSX. Token layers: brand palette (`--tq-*`), surfaces, text, borders, gradients, shadows, radii, glass system.
- **Class catalog** (use, don't redefine): `.glass-card`, `.glass-empty-state`, `.glass-card-danger`, `.glass-dropdown`, `.glass-modal`, `.btn-gradient`, `.btn-outline-dark`, `.btn-danger`, `.nav-item`, `.text-muted`, `.input-dark`, `.tq-avatar-ring`, `.badge-purple`, `.progress-track`/`.progress-bar`, `.page-container`.
- **Glass system is runtime-tunable.** Glass card opacity/blur/saturation are CSS variables initialized by an inline script in `app/layout.tsx` before paint, switchable live from Settings → مظهر التطبيق.
- **Page chrome.** All authenticated pages use `page-container` on the root. Always use Tailwind utility classes; reach for `globals.css` semantic classes only when Tailwind can't express it.

### CodeRabbit (auto-review)

CodeRabbit's GitHub app auto-reviews PRs (currently used for `dev → main` PRs). For local CLI runs:

```bash
# one-time auth (interactive terminal, not from inside Claude Code)
coderabbit auth login

# review uncommitted vs origin/dev (typical pre-PR check)
coderabbit review --base origin/dev
coderabbit review --type uncommitted
```

Reviews are cached server-side per diff hash; re-running the same diff returns "no findings".

---

## 16. Technical Risks

The pivot solved most coordinate-math risks; the live ones are AI quality, security, and a few open library questions.

- **AI layout quality varies.** Claude occasionally picks text/shape colour matching the background, emits inconsistent inner-margins, or breaks one-line text into two. Prompt has hard rules; some slip through. Tighten prompt with worked examples when a pattern repeats.
- **HTML sanitization gap (security).** DOMPurify falls back to RAW HTML when its SSR-loaded singleton lacks `.sanitize`. Single-user dev: fine. Sharing/templates: NOT fine. Server-side sanitization in `deck-generate` is the pre-launch fix.
- **PPTX import is complex (Enhance flow).** Don't promise pixel-perfect PPTX → manifest conversion. Enhance should extract palette/fonts/logo/structure outline; Claude redesigns from there. Don't aim for round-tripping.
- **RTL is the business — never regress.** Arabic direction, right alignment, font fallback by script, BiDi metadata, run-merge — all baked into the pipeline. Any change to `bidi-postprocess.ts` or `dom-to-pptx` patches must run through the spike harness at `/spike` first.
- **`dom-to-pptx` is on a single maintainer.** Healthy project but solo. We pin v1.1.8 + carry 5 patches via `patch-package`. If a future upgrade breaks our patches, regenerate via `npx patch-package dom-to-pptx`.
- **Claude HTML is unbounded.** Beyond the schema (which only validates shape), Claude could emit slow CSS, huge inline SVGs, or dom-to-pptx-unfriendly patterns. Spot-check large decks with the spike harness.

> **Critical recommendation:** every Claude response goes through Zod validation. On failure, retry with the validation error appended to the prompt (self-healing). After 3 failed attempts the Inngest job fails and surfaces in Sentry. Never let unvalidated Claude output land in `PresentationVersion.slideJson`.

---

## 17. MVP Scope

The first release proves the main product promise. Everything in MVP today is either shipped or has a clear unblocker.

1. ✅ User logs in (Supabase email + Google OAuth)
2. ✅ Dashboard with real DB-backed widgets
3. ✅ Create flow: paste content → brand wizard → summary → generate
4. ✅ Preview Window with HTML rendering at 1920×1080, RTL
5. ✅ Full-deck regeneration from action bar
6. ✅ PPTX export with Arabic BiDi correctness
7. 🟡 Save project / save deck as template (save fires; templates UI pending)
8. ⏳ Logo support — user-end implementation (next)
9. ⏳ Server-side HTML sanitization (security gate — required pre-launch)

**Delay until V2:** Perfect PPTX import · Reference PPT mimic (Flow 3) · Area-level comments + redesign · PDF export · Templates marketplace · Team permissions · Approval workflow · Advanced charts.

---

## 18. HTML Pivot — decision + what shipped

2026-05-13 decision; ~99% preview ↔ PPT parity by 2026-05-14. The pivot replaced a JSON-element schema + PptxGenJS pipeline with HTML-first authoring + `dom-to-pptx` + a custom OOXML post-processor. Claude is now a designer, not a layout engine.

### Why we pivoted

- **BiDi was death-by-a-thousand-cuts.** Three rounds of fixes on top of PptxGenJS (multi-run text, `<bdi>` in renderer, dir attribute, prompt rules) and bullet-side / leading-colon / mixed-script-flip bugs kept resurfacing. Root cause: hand-coding what the browser already does correctly.
- **The schema was a leaky abstraction.** Every visual feature became another rule + another renderer branch. Claude was doing designer math (bbox arithmetic, mirror x for RTL).
- **Renderer and export drifted.** What previewed in React didn't match the PPTX, especially gradients and mixed-script ordering.

### Three gates — all passed

1. **Gate 1: BiDi spike** ✅ — One static HTML page with Arabic test strings. Library output had bidi flaws → custom `bidi-postprocess.ts` introduced. Spike kept at `/spike` as a regression harness.
2. **Gate 2: One-pager plan** ✅ — New schema (`{slideId, role, html}`), new system prompt (HTML/CSS authoring rules + design tokens), client-side export through SlideRenderer offscreen, dom-to-pptx for measurement, custom post-processor for OOXML fixes.
3. **Gate 3: Implementation** ✅ — Built on the now-deleted `html-pivot` branch, merged to `dev` + `main`. All future work goes directly to `dev`; `dev → main` via PR for CodeRabbit review.

### What stays the same

- Create wizard (content → brand → summary).
- Inngest generation pipeline (queue, polling, status, retry).
- Claude Opus 4.7 SDK integration (streaming, adaptive thinking, prompt caching).
- Prisma schema for Project / Presentation / PresentationVersion (`slideJson` just stores a different shape).
- Auth, Supabase, dashboard, settings.

### What we learned about `dom-to-pptx`

- **It uses PptxGenJS under the hood.** Not a replacement — a layout-engine wrapper. PptxGenJS quirks (e.g. `margin` vs `inset`) still apply and triggered our padding patch.
- **Browser-only.** Confirmed. Client-side export from the preview is the chosen path. Puppeteer + dom-to-pptx is a future option for background export jobs.
- **BiDi correctness needs help.** The library doesn't emit `rtlCol="1"` on body, `pPr rtl` on paragraphs, or merge script-split runs. Our 4-pass post-processor (PASS 1–4) handles all of it. Three OOXML layers must all flip RTL for PowerPoint to render correctly — Keynote tolerates partial state, PowerPoint doesn't.
- **Five library bugs needed patching.** See §19. All applied via `patch-package` on `postinstall`.
- **Pinned at 1.1.8.** If we upgrade, regenerate the patch (`npx patch-package dom-to-pptx`) and re-run the `/spike` regression harness.

---

## 19. HTMLtoPPT Patch Index

Single ledger of every code-level enhancement on the HTML → PPT pipeline. When we add a new patch, it lands here too.

### A. `dom-to-pptx` library patches — `patches/dom-to-pptx+1.1.8.patch` (auto-applied via `postinstall`)

1. **Direction-aware `text-align` mapping** — `dist/dom-to-pptx.mjs` ≈L307 + ≈L2545. Upstream maps `text-align: start` and unset to OOXML `algn="l"` regardless of `style.direction`. Patched to read `direction` and route `start`/`end`/unset to the correct value (`algn=r` for RTL, `algn=l` for LTR). Two emission sites; both must stay patched.
2. **`taqreer_hasUniformScript` in `isTextContainer`** — ≈L720-725. Helper returns `false` when a container's element children mix scripts. Lets the walker recurse into mixed-script flex/grid rows instead of collapsing them into one PowerPoint text frame.
3. **`isSafeInline` excludes bordered / rounded elements** — ≈L795. Upstream inlined small text-like elements into the parent text frame when "safe", which collapsed pills / chips / badges into bare inline text and dropped their styling. Patched to return `false` for any element with a border or (visible-bg + border-radius).
4. **CSS padding emitted as PptxGenJS `margin`** — ≈L2646 (bg-image / gradient / softEdge branch) + ≈L2771 (bgColor / border / textPayload branch). Upstream stuffed computed padding into `inset:` while hardcoding `margin: 0`; PptxGenJS only honours `margin`, so all CSS padding was silently dropped. Patched to convert `textPayload.inset` (inches) to a 4-tuple of points and pass as `margin: _paddingPt`. Two emission sites; both must stay patched.

*Total: 7 `Patched (taqreer)` markers in the patch file. Table-cell emission (~L325) was already correct upstream — no patch needed.*

### B. OOXML BiDi + gradient post-processor — `lib/export/bidi-postprocess.ts`

5. **PASS 1 — `<a:bodyPr rtlCol="1">` flip.** PptxGenJS emits `rtlCol="0"` by default; PowerPoint treats it as a hard LTR-column hint that overrides paragraph-level `rtl="1"`. Flip every `txBody` whose paragraphs contain strong-RTL text. This was the missing piece that kept slide 4 broken in the spike even after pPr fixes were correct.
6. **PASS 2 — paragraph-level RTL + smart run-merge + lang retag.** For each RTL paragraph: set `<a:pPr rtl="1" algn="r">` when missing; merge adjacent `<a:r>` runs sharing an `rPr` signature (excluding `lang`) so PowerPoint can apply UAX-9 across script-split runs (eliminates "%12 خلال" jumble); retag every surviving run + `endParaRPr` `lang` to `"ar-SA"`. LTR-content paragraphs inside an RTL `txBody` get explicit `rtl="0"` + default `algn="r"` so English titles in Arabic decks read LTR but stay right-anchored.
7. **PASS 3 — direction-aware shape extension.** Short (≤80 chars) text shapes under 3 M EMU wide grow `cx` by 10% on the side OPPOSITE the text anchor; clamped to slide bounds. Absorbs PowerPoint's slightly-wider glyph metrics so single-line text doesn't wrap. Anchored side never moves → Claude's slide margins are preserved.
8. **PASS 4 — gradient-text sentinel swap.** For every `<a:rPr>` whose `<a:srgbClr val="FExxxx"/>` matches a sentinel allocated by `extractGradientIntents`, drop the `<a:solidFill>` and insert a real `<a:gradFill>` built from the recipe (linear → `<a:lin>`; radial → `<a:path path="circle">` + center-degenerate `fillToRect`).

### C. DOM preprocess + gradient extractor — `lib/export/html-export.ts` + `lib/export/gradient-text.ts`

9. **`splitMixedScriptFlexChildren`** (`html-export.ts`). Wrap direct text nodes in a `<span>` when the parent is a flex/grid container with mixed-script siblings, OR when an element child has explicit `dir`. Lets the patched `isTextContainer` see non-uniform script element children and recurse → one shape per child at its measured position.
10. **`stripArabicLetterSpacing`** (`html-export.ts`). Kill inherited `letter-spacing` on any element directly bearing Arabic text. CSS `letter-spacing` breaks Arabic contextual shaping (the connecting glyphs decouple).
11. **`insertScriptTransitionSpaces`** (`html-export.ts`). Insert a space at every Arabic↔Latin / Arabic↔digit adjacency inside text nodes so PowerPoint's BiDi resolver doesn't glue them into the wrong script run.
12. **`extractGradientIntents` + sentinel-hex bridge** (`gradient-text.ts`). Walk the offscreen DOM, find every element using `background-clip: text` + linear/radial gradient, replace its CSS with a unique sentinel hex (`#FExxxx`), stash the recipe in a `Map`. PASS 4 then swaps each sentinel `solidFill` for the real `gradFill`. Multi-stop / explicit percentages / multi-layer backgrounds / radial all covered; conic + repeating-* skip cleanly. `parseColorToHex` front-gates on `CSS.supports('color', input)` so non-color keywords like `circle` can't slip through canvas `fillStyle`'s "keep previous on invalid" behaviour. Per-element sentinels (no recipe dedup) keep separate gradient elements as separate runs.

### D. SlideRenderer — `components/slides/SlideRenderer.tsx`

13. **DOMPurify graceful fallback.** `dompurify@3.4.3`'s `createDOMPurify()` returns a factory without `.sanitize` when `window` is missing at module load (Turbopack SSR pass), and Turbopack appears to share that SSR singleton with the client bundle. Renderer tries `DOMPurify.sanitize` and falls back to RAW HTML when it's unavailable. **Pre-launch TODO:** reintroduce server-side sanitization in `inngest/functions/deck-generate.ts` before sharing / templates ship.

### Caveats and known limits worth tracking

- **Run-level `gradFill` bounds to the parent shape, not the run.** Two inline gradient spans inside the same flex/grid container will read as one continuous gradient stretched across the shape — OOXML semantic limit, not a fixable bug. Author each gradient text element as its own block-level node for independent per-element fills.
- **Run-merge collapses per-run formatting in RTL paragraphs.** PASS 2's smart-merge keeps the first run's `rPr` when collapsing script-split runs. Acceptable today; needs a "merge by compatible `rPr`" pass when inline-styled spans inside one paragraph become a real use case.
- **Alpha in gradient stops is dropped.** `parseColorToHex` ignores alpha; colour-to-alpha gradients round-trip as opaque. Prompt rule pushes those to inline SVG with `stop-opacity`.
- **Conic + repeating gradients are skipped.** Extractor returns `null`; dom-to-pptx falls back to whatever it does for unrecognised CSS (usually a flat colour). Prompt rule already forbids them.

---

## 20. Agent Onboarding

If you're a fresh agent picking this up, start here.

### Branch + PR strategy

- **All work goes to `dev`.** No more feature branches; iterate directly on `dev`.
- **CodeRabbit reviews `dev → main` PRs.** When a milestone lands, open the dev → main PR, let CodeRabbit auto-review, fix surfaced issues on `dev`, then merge.
- **Don't auto-push.** Commit freely; push only on user request, meaningful milestone, or >3 accumulated commits.

### Code tour — read in this order

1. [`lib/schema/slide.ts`](../lib/schema/slide.ts) — the v2 SlideManifest schema. Permissive by design.
2. [`inngest/functions/deck-generate.ts`](../inngest/functions/deck-generate.ts) — system prompt + streaming Claude call + self-healing Zod retry. Single source of truth for what Claude is told.
3. [`components/slides/SlideRenderer.tsx`](../components/slides/SlideRenderer.tsx) — renders a slide HTML string at 1920×1080 with theme CSS vars + DOMPurify graceful fallback.
4. [`lib/export/html-export.ts`](../lib/export/html-export.ts) — production export entry. Mounts slides offscreen, runs preprocess, calls dom-to-pptx, runs the post-processor, downloads.
5. [`lib/export/bidi-postprocess.ts`](../lib/export/bidi-postprocess.ts) — the 4-pass OOXML post-processor (BiDi + gradient).
6. [`lib/export/gradient-text.ts`](../lib/export/gradient-text.ts) — sentinel-hex bridge for CSS gradient text.
7. [`patches/dom-to-pptx+1.1.8.patch`](../patches/dom-to-pptx+1.1.8.patch) — the 7 markers we apply on `postinstall`.
8. [`app/spike/page.tsx`](../app/spike/page.tsx) — BiDi regression harness. Re-run after any `dom-to-pptx` upgrade or post-processor change.

### Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop, brew (Mac)

git clone https://github.com/taqreerai/taqreer.git
cd taqreer
npm install                  # postinstall auto-applies the dom-to-pptx patch

# Get .env.local from the team. Required vars:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/taqreer
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL=...
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   INNGEST_EVENT_KEY=...
#   INNGEST_SIGNING_KEY=...

docker compose up -d         # starts postgres 16 + redis 7 detached
npx prisma migrate deploy    # only against local — DATABASE_URL must point at localhost / 127.0.0.1 / [::1] / host.docker.internal

# two long-running processes:
npm run dev                  # Next.js dev server on :3000
npx inngest-cli@latest dev   # Inngest dev server on :8288

# helpful scripts:
npx tsx scripts/wipe-decks.ts            # wipe all decks + storage (keeps users)
npx tsx scripts/dump-latest-slide-1.ts   # print latest deck's slide 1 JSON
npx tsx scripts/setup-storage.ts         # one-time Supabase bucket setup
```

### Memory pointers (Claude Code auto-memory)

The user's memory at `~/.claude/projects/-Users-osama-taqreer/memory/` has structured notes that inform every session:

- `project_taqreer.md` — product overview, RTL is the business reason for existence.
- `project_html_pivot.md` — HTML pivot status, 99% parity milestone.
- `project_bidi_fix.md` — the three OOXML layers + run-merge architecture.
- `project_dom_to_pptx_patch.md` — the 5 library patches with line numbers.
- `project_local_dev.md` — DATABASE_URL → docker compose, Supabase is auth+storage only.
- `feedback_discuss_before_coding.md` — for non-trivial changes, paraphrase + plan + wait for go.
- `feedback_push_rhythm.md` — don't auto-push.

### Where the prompts live

The system prompt is the `SYSTEM_PROMPT` const at the top of [`inngest/functions/deck-generate.ts`](../inngest/functions/deck-generate.ts). Per-request rules go through `buildUserMessage` in the same file. There is no separate prompt store, no DB table, no markdown file — edit the const directly. It's marked `cache_control: ephemeral`, so don't mutate per-request (kills the cache); use the user-message rules block for that.

### Anti-patterns to avoid

- **Don't reintroduce coordinate math.** The pivot deleted bbox arithmetic, RTL coordinate mirroring, logo coord locking. Don't add them back; the browser does layout.
- **Don't add features that bypass Claude.** No drag-to-edit, no manual element editor. Visual changes go through Claude (regenerate, area-redesign). That's the product.
- **Don't skip the spike.** Any change to `dom-to-pptx` patches or `bidi-postprocess.ts` must run through `/spike` first.
- **Don't tighten the schema.** The Zod schema validates SHAPE, not content. Tightening it with discriminated unions burns 10 minutes per generation in self-healing retries — we've been here before.

---

*Living document — updated each shipping milestone. See [`log.md`](./log.md) for the dated changelog.*
