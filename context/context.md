# Taqreer — Architecture & Handover

Arabic-first, RTL AI presentation platform. User provides content + brand, **Claude designs each slide as HTML**, the browser renders it 1:1, and a patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX. An in-canvas manual editor is the next major build ([`context/plan-editor.md`](./plan-editor.md)); today every visual change goes through Claude.

| | |
|---|---|
| **Stack** | Next.js 16 + Turbopack, React 19, TypeScript 5, Prisma 7 + Postgres, Inngest, Supabase (auth + storage), Anthropic SDK, Puppeteer |
| **Output** | PPTX · PDF · PNG · HTML — all shipped · Templates shipped |
| **Differentiator** | HTML-first generation; preview = export; ~99 % Arabic PPT parity via custom BiDi post-processor |
| **Active plan** | **In-canvas slide editor** → [`context/plan-editor.md`](./plan-editor.md). Generation is now 100 % HTML-first: the JSON manifest path was deleted 2026-06-05 and all four flows (create / enhance / mimic / datasheet) author `<section>` HTML. |
| **Branch strategy** | All work goes to `dev`. CodeRabbit reviews `dev → main` PRs. |

Change history is the **git log** (no separate changelog file). For the patch ledger, see §19.

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

Four flows. Create is shipped; Enhance / Mimic / Data are Phase 17 (planned).
Templates work as a **library**, not a separate flow — accessed via `/templates`
and the "Use this template" CTA on tiles + lightbox.

### Flow 1 — Create (إنشاء) ✅ Phase 17.D shipped (single-page rebuild)

Dashboard → `/create`. **Single-shot page** with 4 cards in a responsive grid
(4 → 2 → 1 cols at viewport breakpoints 1280 / 760 / below), Generate split-button
below. Replaces the previous `/create/{content,brand,summary}` 3-step wizard and
the entire `/create-from-template` route tree (template seeding now hydrates the
single page via `lib/create/seed-from-template.ts`).

**Card 1 — Content** (icon `subject`): textarea for typed content + horizontal
dropzone for PDF/PPTX/DOCX/TXT. Language SegmentedToggle (ar / en) inline with
the textarea header so direction flips RTL ↔ LTR on the input. The two are
mutually exclusive (textarea dims when a file is picked).

**Card 2 — Fonts + Colors** (icon `palette`): inline palette (h-7 swatches +
add tile, gap-1.5) on row 1, heading-font + body-font slots below each separated
by `border-t pt-3`, "Save as default brand" Toggle pinned to the card bottom.
Each font slot pairs a label-row (text-xs + SegmentedToggle ملف / Google) with
the slot below, `compact + alignStart + hideSample` — sample preview text
("أبجد هوز" / "النص الأساسي يُستخدم...") removed for vertical density.

**Card 3 — Logo** (icon `image`): `CompactUploadZone` accepting **SVG only**
(label "شعار SVG فقط" at `text-[11px]` in `text-white/40` when empty, swaps to
filename at full contrast when picked). Below: `border-t pt-3` then "موضع الشعار"
label + an `ExclusionDropdown` (استثناء الغلاف / الشكر in one pill) + a
`PositionDropdown` (6-corner picker collapsed into a glass popover). Same
"Save as default brand" Toggle as Card 2 (shared state).

**Card 4 — Output Settings** (icon `settings`): `SlideSizeFields` (16:9 / 9:16
side-by-side), then `border-t pt-3` separators between each section: slide-count
(SegmentedToggle تلقائي / مخصص with framer-motion `layout` + AnimatePresence
spring 500/35 wrapping the `InlineStepper` so the stepper grows/shrinks the
toggle's anchor smoothly), pagination Toggle, persistent overlay (text input +
ExclusionDropdown + PositionDropdown).

**Content extraction** (file path) — when the user picks a content file, the page
POSTs `/api/extract` (kind=`create`), polls `/api/extract/[jobId]` every 2.5 s
until completed (5 min cap), and stores the resulting `anthropicFileId`. On
Generate the brief carries `source: { kind: "scratch", anthropicFileId }` —
`deck-generate.ts`'s scratch branch attaches the PDF as a `document` block with
a "raw material for a fresh deck" directive (read content not design, edit
aggressively, structure for clarity). Text-only submits omit `source`
entirely and follow the legacy scratch path. Generate is gated on extraction
being `ready` so the file's bytes are always uploaded before the POST lands.

### Flow 2 — Enhance (تحسين) ✅ Phase 17.B shipped

Dashboard → `/enhance`. **Single-shot page** (no stepper, no summary route) —
2 equal-width glass cards under a brief header + a Generate split-button below.

**Card 1 — source + logo** (combined): PDF/PPTX dropzone on top (`min-h-160`,
swaps its content to `filename + size + stage caption` when a file is picked,
small remove-X overlays in the corner). Hairline divider, then a compact logo
dropzone underneath (SVG / PNG, optional).

**Card 2 — fonts** (optional): heading + body slots, each with an inline ملف /
Google pill toggle. Upload mode → `FontUploadSlot` (woff2 / woff / ttf / otf).
Google mode → `GoogleFontSlot` (searchable combobox over a 16-family catalog,
8 Arabic + 8 Latin). All three brand picks (logo, heading, body) are optional —
empty = Claude reads brand identity from the PDF document block, filled = user's
pick wins on the brief.

**Server pipeline**:
1. `POST /api/extract` — uploads the source file to `source-files/` bucket,
   fires `source.extract.requested` Inngest event.
2. `extract-source.ts` — downloads source, runs `lib/extract/` dispatcher:
   PPTX → LibreOffice → PDF (or passthrough for PDF), pulls fonts +
   colors from PPTX theme XML (best-effort, swallowed on error), reads
   pageCount + first-page aspect ratio via pdf-lib.
3. PDF bytes uploaded to **Anthropic Files API** (beta `files-api-2025-04-14`)
   → `file_id`. The job's `outputJson` is the `SourceMeta` blob:
   `{ anthropicFileId, fonts, colors, pageCount, format }`.
4. `/enhance/content` polls `GET /api/extract/[jobId]` every 2.5 s. On
   `completed`, the Generate button activates.
5. User click → upload logo + font files to `brand-assets/` (parallel) →
   resolve font slots → `POST /api/projects` with brief carrying
   `source.kind === "enhance"` + `source.anthropicFileId`.
6. `deck-generate.ts` branches on `source.kind`: builds a `document` block
   from the file_id, sets `anthropic-beta: files-api-2025-04-14` header on
   the Claude call, runs the enhance directive (STRICT VERBATIM CONTENT +
   ENHANCE THE DESIGN + VISUAL REUSE: redraw logos / icons / illustrations
   from the PDF as inline SVG, placeholder blocks for photos).

**Deliberate non-features (dropped per user testing 2026-05-25)**:
- No PPTX zip asset extraction (logos, photos, separators). Extracted raster
  / SVG assets clashed visually with Claude's clean inline-SVG output style;
  Claude now reads visuals directly from the PDF and re-draws.
- No per-slide PNG rasterization. Claude reads the PDF natively (Anthropic
  Files API document block) — fewer moving parts, better fidelity.
- No multi-step wizard. The single-shot page hits the typical AI-app pattern
  (Claude.ai, ChatGPT, v0.dev) — fewer steps, faster path to result.

**SYSTEM_PROMPT discipline for this flow** (covers both /enhance + /mimic):
draft / critique / refine happens in Claude's THINKING channel (where the
adaptive thinking budget from `output_config.effort` lives). Text channel
emits ONE polished manifest, no preamble, no markdown fences, no draft.
Defensive parser hardening in `StreamingSlideParser.didReset()` handles
the rare case Claude still emits draft + final in text (top-level `}` close
on a tracked manifest → resets locks + signals caller to clear preview).

File cap: **100 MB**. State machine: `idle → extracting → ready → submitting`.

**Quality preset menu — 3 configs** (2026-05-29 — Opus 4.8, supersedes the 4-preset / Opus 4.7 matrix):
- **Sonnet 4.6 · سريع** (`sonnet-fast`) — Sonnet 4.6, thinking disabled. Auto-upgrades to `opus-fast` on source-document flows (JSON saturates Sonnet without thinking).
- **Opus 4.8 · سريع** (`opus-fast`) — Opus 4.8, thinking disabled.
- **Opus 4.8 · تفكير** (`opus-balanced`, **default**) — Opus 4.8, adaptive + `effort:low`. ~$0.68 / 3.4 min per 5-slide deck (measured). Green thinking chip.

Labels are intent-based Arabic (سريع = no thinking, تفكير = light thinking) rather than raw effort-tier names. **`opus-max` (effort:high) removed entirely 2026-05-29** — on Opus 4.8 it over-thought this structured-deck task (16 min / $1.69 for 5 slides) with no quality gain over `low`; legacy `opus-max` rows now fall to the `low` default. (Earlier `effort:max`/`xhigh` were already dropped on 4.7 — max stalls on Files API enhance, xhigh marginal at 1.17× cost.) See `context/pricing.md` for the migration data, `lib/anthropic/quality-params.ts` for the case statements.

**Streaming-side features (enhance/mimic/data flows)**:
- **Language detection** — `lib/extract/language-pptx.ts` samples first 3 slides' `<a:t>` text-run XML, counts Arabic vs Latin chars, returns `"ar" | "en" | null`. Threaded into the brief so the preview SlideNavSidebar opens in the source language from the first paint instead of defaulting to Arabic.
- **`max_tokens: 64000`** — set per Anthropic's published guidance for higher-effort Opus runs ("set a large max output token budget ... starting at 64k tokens"). Harmless headroom at the current `effort:low` default (real runs use a fraction). Cross-refs the docs URL in code comment.
- **`onFailure` hook on deck-generate** — fires once after Inngest exhausts retries; marks Project/Version/Job rows as `failed` so the existing "حاول مرة أخرى" retry button in DeckView surfaces. Pre-fix, failed enhance runs left rows stuck in `queued`/`generating` indefinitely.

**Visual handling rule (logos)** — single non-negotiable: "anything that LOOKS like a logo, brand mark, monogram, or stylized identifier — do NOT attempt to draw it in SVG" (regardless of whether Claude "recognizes" it). Two fallbacks: brand name readable → styled text, otherwise → placeholder div with short label. The previous wordmark/iconographic classification step is gone (it let Claude mis-categorize and proceed to redraw).

### Flow 3 — Mimic (محاكاة) ✅ Phase 17.C shipped (new flow this session)

Dashboard → `/mimic`. **Single-shot page** with a 3-card row (RTL flow: content
right, branding middle conditional, what-to-mimic left), Generate split-button
below. Each card pins at `min-h-[387px]` matching /create + /enhance.

**Card 1 — Content** (icon `subject`): textarea OR file dropzone (mutually
exclusive). Direction follows live `detectStringLanguage(text)` heuristic so
typing English flips LTR mid-stream, Arabic stays RTL. Bottom row (under
`border-t pt-3`) splits the card in half: logo on the visual right
(`CompactUploadZone` SVG-only, same "شعار SVG فقط" empty label + filename swap
on pick), `SlideSizeFields stacked` on the left.

**Card 2 — Branding** (icon `palette`, CONDITIONAL): only rendered when the
"مُحاكاة الهوية البصرية" Toggle in card 3 is OFF. Mounts/unmounts via
AnimatePresence with width: 0 ↔ 360 spring (350ms cubic easing). Inline palette
(h-7 swatches like /create) + heading font + body font slots, each with the same
SegmentedToggle ملف/Google + compact + alignStart + hideSample shape /create
uses. Overflow toggling: `overflow: hidden` during the AnimatePresence
transition, `overflow: visible` after `onAnimationComplete` so the
ColorPickerPopover and GoogleFontSlot dropdowns can escape the card edge.

**Card 3 — What to mimic** (icon `auto_awesome`): wrapped in
`.canvas-gradient-border data-active="true"` for the animated mesh halo (visual
cue: "this is the file whose design we're copying"). Toggle "مُحاكاة الهوية
البصرية" at top (ON by default = use design's brand identity; OFF reveals
card 2). `border-t pt-3` → slide-count row (SegmentedToggle + InlineStepper +
identical spring 500/35 to /create's). `border-t pt-3` → design-reference
dropzone (`compact + h-full` to fill the remaining card height).

**Server pipeline** (mirrors /enhance for both content + design):
1. On file pick, POST `/api/extract` (kind=`mimic`) + poll until completed.
2. Both files get an `anthropicFileId` from the Anthropic Files API.
3. On Generate the brief carries `source.kind === "mimic"` with
   `designAnthropicFileId` (always) + EITHER `uglyAnthropicFileId` (file path)
   OR `userContent` (text path — sentinel-safe escaped before injection).
4. `deck-generate.ts`'s mimic branch attaches both files as `document` blocks
   with the directive: "DESIGN REFERENCE = visual language source, mimic its
   typography/palette/spacing/layout, do not copy its content. UGLY/CONTENT
   = render verbatim in the reference's style."

File cap: **100 MB per file**. State machine: `idle → extracting → ready →
submitting`. Stale-extraction guard on both effects: the abort handler only
resets stage to `idle` for own-effect aborts, never clobbers a newer
extraction's `extracting` state.

### Flow 4 — Data (من بيانات) ⏳ Phase 17.D

Dashboard → `/from-data`. User uploads an XLSX (or CSV). Server uploads the
file directly to **Anthropic's Files API**, gets back a `file_id`, returns
it to the client. Optional context textarea ("what's the story?").
Brand page → summary. Submit fires `deck.generate.requested` with
`source.kind === "data"` + `source.dataFileId` so `deck-generate.ts` references
the file via `{type: "document", source: {type: "file", file_id}}`.
Anthropic file deleted via their API once the deck completes.

File cap: **25 MB** (XLSX rarely exceeds; Anthropic Files API enforces its own cap too).

### Convergence

All four flows funnel into the same downstream pipeline from POST `/api/projects`
onward → Inngest `deck.generate.requested` → `deck-generate.ts` (prompt branches
on `source.kind`) → `/preview/[projectId]`. The project page, toolbox, canvas,
slide-nav sidebar, BiDi patches, realtime broadcasting, and presence avatars
are all shared infrastructure — none of that work is duplicated per flow.

### Shared design system (2026-05-26 unification) ✅

The three landing flows (`/create`, `/enhance`, `/mimic`) now read as one
labelled-cluster family — every card carries the same chrome contract, the same
input primitives, the same animation springs. Per user direction "everything
should be unified as create, everything, even the font text area alignment."

**Card chrome** — every card wraps a `CardHeader` (icon + h3 title + bottom
hairline `border-b border-white/[0.08] pb-2`) followed by sections separated by
`border-t border-[var(--tq-border-glass)] pt-3`. Each card sits in a
`glass-card` with `gap-4 + p-4 + rounded-2xl` and pins at `min-h-[387px]` so
every flow's hero row reads as the same vertical band (measured live from
/enhance's first empty-state card, then locked).

**Shared primitives** (all in `components/create/controls.tsx` unless noted):

| Primitive | Used by | Visual contract |
|---|---|---|
| `CardHeader` | every card on /create + /enhance + /mimic | icon + title, border-b separator below |
| `SegmentedToggle` | font mode (ملف / Google), slide count (تلقائي / مخصص), language (ar / en) | sliding indicator via framer-motion `layoutId`, spring 500/35 |
| `Toggle` | "Save as default brand", pagination, "مُحاكاة الهوية البصرية" | violet active track + white knob, knob spring 500/35 |
| `PositionDropdown` | logo position, persistent overlay position | h-8 glass pill → glass popover with 6-corner grid |
| `Pill` | residual chooser sites (legacy) | glass surface, white-on-active stroke |
| `InlineStepper` (in `OutputCards.tsx`) | slide-count "مخصص" mode on /create + /mimic | single rounded pill, h-22, − / number / +, w-66 |
| `CompactUploadZone` (in `components/brand/`) | logo upload (all flows) + screenshot extractor | `compact + hideFilename`, **SVG-only** logo accept, `muted` prop swaps label to text-[11px] white/40 |
| `FontUploadSlot` / `GoogleFontSlot` (in `components/brand/`) | every font picker | `compact + alignStart + hideSample` for the in-card variant |
| `ColorPickerPopover` (in `components/create/`) | palette swatches (all flows) | 140 × ~180 px, opens below swatch (`top-full mt-2`) |

**Animation language** — every motion uses the same spring everywhere:
`{ type: "spring", stiffness: 500, damping: 35 }`. SegmentedToggle's active
indicator, Toggle's knob travel, slide-count `motion.div(layout)` parent +
`AnimatePresence`-wrapped stepper (width 0 ↔ 66 + opacity + marginInlineStart
to absorb the gap). Mimic's branding card uses a longer 350 ms cubic easing
for the larger card-width grow.

**Responsive layout** — /create uses an explicit-breakpoint grid (1 → 2 → 4
cols at `min-[760px]` / `min-[1280px]`) to skip the awkward 3-col intermediate;
/enhance + /mimic use `flex-wrap items-stretch` so cards wrap to a new row when
the container can't fit them side-by-side, with `min-w-[320px]` (enhance) or
`w-[360px]` (mimic) preventing infinite shrink.

**Card-level micro-rules** (consistent across all 3 flows):
- All Arabic copy uses **Latin numerals only** (0-9, never ٠-٩) — BiDi handles
  embedding correctly in RTL contexts.
- Section labels are `text-xs font-semibold text-white/70` (never an h3 inside
  a card — h3 is reserved for the CardHeader at the top).
- Inline pill toggles + inputs share the same 30-px compact height with
  `padding: "0 12px"` so toggling between dropzone / combobox / input never
  reflows the card.
- `page-container` class on the outermost `<div>` wrapper of every app page
  for the shared app-page chrome contract.

**Locked**: with the design system in place, /create + /enhance + /mimic are
considered done. Future visual changes go through the shared primitives so
all three flows update together; no flow-specific forks.

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
| AI | Anthropic SDK 0.95 (Claude Opus 4.8, streaming, adaptive thinking, prompt caching, self-healing Zod retry) |
| Export | `dom-to-pptx` 1.1.8 (patched), PptxGenJS 4 (under the hood), JSZip, **Puppeteer 24** (thumbnails + planned PNG/PDF export), **sharp** (image resize), **jsdom** (server-side sanitiser) |
| Validation + Sanitization | Zod 4, DOMPurify 3.4 (browser) + JSDOM-backed mirror (server) |
| Email | Resend — wired in `lib/email/send-share-invite.ts` for share invitation emails (Phase 15) |
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
 |-- deck-generate.ts              Claude Opus 4.8 → SlideManifest with HTML strings
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

  projects/[id]/favorite/route.ts                    ✅  PATCH isFavorite toggle
  projects/[id]/route.ts                             ✅  PATCH (rename) + DELETE (hard delete + storage cleanup)
  projects/[id]/share/route.ts                       ✅  Owner-only: manage publicAccessLevel + ProjectShare rows (Phase 15)
  projects/[id]/export/png/route.ts                  ✅  Server-side PNG via Puppeteer
  projects/[id]/export/pdf/route.ts                  ✅  Server-side PDF via Puppeteer (Range params honoured)
  projects/[id]/manifest/route.ts                    ✅  Lazy manifest fetch for ShareDialog export tab
  projects/[id]/realtime-token/route.ts              ✅  Project channel pre-flight gate (Phase 16.A)
  invitations/[token]/accept/route.ts                ✅  Invite acceptance — auth bounce + share-row link + first-time-accept notification fan-out (Phase 15.E)
  notifications/route.ts                             ✅  GET (last 50 bell rows, server-formatted)
  notifications/read-all/route.ts                    ✅  POST mark-all-read on bell open (Phase 16.E)
  me/route.ts                                        ✅  {supabaseUserId, prismaUserId} for user-channel topic

  // Planned (Phase 17)
  upload/route.ts                                    ⏳  Generic multipart upload (used by all extract routes)
  extract/route.ts                                   ✅  POST: stages source upload → Inngest source.extract.requested. GET /[jobId]: poll. Phase 17.B shipped (single canonical route for Enhance + future Mimic/Data).
  mimic/extract/route.ts                             ⏳  Ugly extract + good rasterize → StandardBrief + referenceImages (Phase 17.C)
  data/extract/route.ts                              ⏳  Anthropic Files API upload → StandardBrief + dataFileId (Phase 17.D)
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

### Generate Deck — ALL flows (HTML-first) ✅

All four flows (create / enhance / mimic / datasheet) fan into ONE Inngest
`deck-generate` function and author `<section>` HTML. (The JSON manifest path was
deleted 2026-06-05.)

1. **Brief assembly** — `POST /api/projects` persists Project + v1 PresentationVersion (status `queued`), fires `deck.generate.requested`. (Source flows pre-step: `POST /api/extract` for enhance/mimic, `POST /api/datasheet/parse` for datasheet.)
2. **Inngest `deck-generate`** — `isHtmlAuthoringFlow` is true for every flow. System = `SYSTEM_PROMPT_CREATE_HTML` + a per-flow addendum (`IMG_ADDENDUM` images / `MIMIC_HTML_ADDENDUM` / `ENHANCE_HTML_ADDENDUM`), `cache_control: ephemeral`. User msg = per-flow source directive (`buildSourceTextDirective`) + `buildUserMessage` + the "emit the `<section>` slides" closer. File-based source blocks (enhance images / mimic PDF / create upload) carry the `anthropic-beta: files-api-2025-04-14` header.
3. **Claude Opus 4.8 stream** — adaptive thinking + prompt caching. `stream.on("text")` feeds `StreamingHtmlSplitter`; each closed `<section>` → `scopeDeckCss(extractLeadingStyleCss())` (once) + `buildSlideHtml` → a live-preview slide pushed into `slideJson.streamingPreview` (throttled DB writes).
4. **Assemble + validate** — NO JSON parse (the slides ARE HTML). Build `{ version:"2.0", theme, slides }`; `SlideManifestSchema.safeParse` is shape-only. Top-level `language`/`direction` come from the brief for create/datasheet, and from the produced slides (dominant script) for enhance/mimic.
5. **Persist + promote title + filter cols** — update v1 row to `completed`. Promote `manifest.title` to `Project.title`. **Freeze `slideCount` + `dominantColor` on first generation** (conditional spread). `seedSlideVersionsForInitialGeneration` seeds v1 of every slide into `SlideState` + `SlideVersion`. Images-mode dispatches `deck.images.requested`; enhance flushes its transient image uploads.

### Partial Regen ✅

Per-slide regen — comment authoring + apply, OR per-slide pill's regen button.

1. **Author** (CommentsPanel) — drag-box on the hero canvas → comment editor → save as draft (`Comment.status = "draft"`).
2. **Arm** (regen button morphs to AI sparkles when drafts exist + commentMode off).
3. **Fire** — `POST /api/projects/[id]/regenerate-partial` allocates a queued v_n+1, promotes drafts→applied INSIDE the version-allocation transaction, fires `deck.regenerate.partial.requested`.
4. **Inngest `deck-regenerate-partial`** — Parallel Claude calls via `step.run("regen-slide-${id}")` per target slide. Splices new HTML into a manifest copy. `currentVersionId` flips to v_n+1 ONLY on the post-write atomic transaction (`prisma.$transaction([version.update, presentation.update, project.update])`) — deck stays visible during regen.
5. **History** — Each regenerated slide gets a new `SlideVersion` row + `SlideState.currentVersionNumber` bump. History capped at 5 (oldest pruned). `cachedComments` cleared on clean regen; replaced on comment-payload regen.

### Enhance / Mimic / Datasheet (Flows 2–4) ✅

All shipped, all on the SAME HTML path as Flow 1 — they differ only in INPUT + the
system addendum (see step 2):
- **Enhance** — upload PDF/PPTX → `extract-source` rasterizes per-slide PNGs at gen time → interleaved {image + verbatim-text} blocks; "redesign, preserve identity, lock chrome" addendum.
- **Mimic** — upload a design reference (PDF document block) + optional content (file or typed text); "reproduce the reference, recolour to brand vars" addendum.
- **Datasheet** — parsed-spreadsheet markdown inlined in the directive (NO document block); chart-deck directive (inline `<svg>`, strict data fidelity).

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

Shipped end-to-end — comment authoring, partial regen pipeline, per-slide pill (regen / history / lock), 5-version capped history, marker preview popup, live comments via realtime (Phase 16.C).

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

> **Status: shipped.** Templates carry a real deck PDF + real-slide thumbnails. Created from a project (save-as-template), browsed on `/templates` (own + community) and the public landing `#templates` section, and used via a forked Mimic flow at `/use-template/[id]`.

A `Template` stores a `BrandSnapshot` (`brand` JSON), the source deck's `thumbnailUrls` (cover + 2 showcase slides [typography, palette] + rest, capped at `MAX_TEMPLATE_SLIDES` = 10), a rendered deck `pdfUrl`, plus `isPublic` and `isPremium`.

- **Save as template** — `POST /api/projects/[id]/save-as-template` copies the project's thumbnails + fires `template.render` (Inngest), which renders the typography/palette showcase slides and the deck PDF.
- **Use a template** — `POST /api/templates/[id]/use` re-mints a fresh Anthropic Files `file_id` from the stored PDF (ids expire), returns the brand + design reference, and the forked Mimic flow (`components/mimic/MimicFlow.tsx` template mode) generates with the **same `source.kind: "mimic"` prompt** as `/mimic`.
- **Use a project directly** — `POST /api/projects/[id]/use-as-template` renders the project deck on the fly + mints a reference without persisting a Template.

**Surfaces** (all sourced from the curator account's public templates — `MARQUEE_OWNER_EMAIL` — with the synthetic showcase slides excluded): dashboard "قوالبي" widget + `/templates` page (`TemplateTile` → `TemplateLightbox`), the public landing `#templates` section (`LandingTemplatesGrid` hover-scrub grid + `TemplatesCard` marquee), and the auth-page marquee.

**Premium (T4):** `isPremium` templates require the `pro` plan — enforced server-side in the use route (402; owner exempt; fails closed via `lib/plan.ts` `isProPlan`). The UI shows a "مميز" badge and routes blocked users to pricing. See §15.

**Recommended categories:** Business Proposal · Investor Report · Pitch Deck · Company Profile · Training Deck · Financial Report · Strategy Deck · Marketing Plan · Event Proposal · Arabic RTL · Government Style · Minimal Corporate.

### Pending / later
- **Premium marking UI** — `isPremium` is **DB-only** today; the free/premium toggle lands on the **admin console** when that's built.
- **Premium eligibility** — currently `pro`-only (`isProPlan`); widen to include `plus` if desired (single helper in `lib/plan.ts`).
- **Checkout / subscription wiring** — `User.plan` is set in the DB only; no Stripe/upgrade flow yet, so nobody is `pro` in practice until that's wired (premium templates are then un-usable except by owners — expected).
- **Standalone public templates gallery** — the landing `#templates` section covers discovery for now; graduate to a dedicated indexable gallery page (SEO: "قوالب عروض عربية") once the public library grows. `TemplateTile`/`TemplateLightbox` port directly. (`/templates` is taken by the in-app library, so a public gallery needs a new URL.)
- **Orphaned template storage sweep** — clearing templates left showcase/PDF files in Supabase storage; a cleanup pass (or storage cleanup in the delete route) is pending.
- **Mimic branding default** — standalone `/mimic` no longer auto-lifts the reference deck's palette/fonts (branding card is always-on now). Revisit if "auto-lift when the card is untouched" is wanted back.
- **`planLimits` constant** — still duplicated in `dashboard/page.tsx` + `/api/usage/plan`; fold into `lib/plan.ts` if either is touched again.

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

Authoritative project board — the high-level "what's in / what's next." Granular
change history is the git log. All shipped phases live permanently here as the
audit trail.

| # | Phase | Status |
|---|---|---|
| 1 | **Foundation** — Next 16 Turbopack, Tailwind 4, Supabase, Postgres via Docker, Prisma 7.8, dashboard, project creation | ✅ |
| 2 | **Slide Manifest Engine** — v2 schema, SlideRenderer at canvas dimensions, manifest persisted to `PresentationVersion.slideJson` | ✅ |
| 3 | **AI Deck Generation** — Anthropic SDK, Opus 4.8 (+ Sonnet 4.6 fast tier), streaming + adaptive thinking + prompt caching + 1M context beta, self-healing Zod retry | ✅ |
| 4 | **Preview Window** — SlideRenderer, toolbar, generating placeholders, cascade-in, slide-nav sidebar, hero comment overlay | ✅ |
| 5 | **PPTX Export** — patched `dom-to-pptx` + 4-pass BiDi post-processor; ~99 % Arabic parity | ✅ |
| 6 | **Comments + Partial Regen** — comment authoring, draft → applied lifecycle, partial regen Inngest flow, per-slide pill, 5-version capped history | ✅ |
| 7 | **Save Project + Thumbnails** — `savedVersionId` + per-slide snapshot + Puppeteer/sharp WebP pipeline + restore-aware indicator | ✅ |
| 8 | **Dashboard Tile Rework** — full-bleed thumbnail + scrub + click-to-lightbox + lightbox slider | ✅ |
| 8b | **Filter-column freeze** — `slideCount` + `dominantColor` + `colorTags` frozen on FIRST `deck-generate` completion (race-safe `updateMany WHERE column = null`); `/save` no longer touches them | ✅ |
| 9 | **3-dots Menu + Project Actions** — Favorites toggle, Copy link, Inline rename, Send to trash (hard delete + storage cleanup) | ✅ |
| 9.5 | **Content language picker** — AR/EN pick on /create/content drives `Project.language` + `Presentation.direction` + `buildUserMessage` LANGUAGE block. Phase C (BiDi gating on `language === "en"`) deferred until production accuracy data | ✅ Phases A+B / ⏳ Phase C deferred |
| 10 | **PNG + PDF Export** — Puppeteer-driven Range params + "Made with Taqreer" badge | ✅ |
| 11 | **/projects page** — 5-per-row grid + sort + filters (language, color buckets via shade-range matching). Slide-count filter dropped (no real value) | ✅ |
| 12 | **/favorites rename + isFavorite toggle wiring** | ✅ |
| 13 | **`/create/from/[projectId]`** content-only "use as template" entry — **dropped**: regen on an open project covers the variation use case | 🚫 |
| 14 | **Templates feature** — `/templates` page (own + community tabs), Save copy as template (Phase A–B), Use as template flow (Phase D, dedicated `/create-from-template` route tree) | ✅ |
| 15 | **Sharing + Roles** — Owner/edit/comment/view ladder via `lib/api/project-access.ts`. `ProjectShare` schema, ShareDialog with Share+Export tabs, Resend invite emails, accept route, public-access toggle, LinkedIn share button | ✅ |
| 16.A | **Realtime channel foundation** — `project-channel.ts` + `server-broadcast.ts` + `realtime-token` REST gate. Broadcast + Presence only (no Postgres Changes — DB lives in docker, not Supabase) | ✅ |
| 16.B | **Presence avatars** — shared Avatar atom, deterministic OKLCH gradient for password signups, slide-thumbnail chips with tab-out dim | ✅ |
| 16.C | **Live comments** — `comment.created` / `comment.deleted` broadcasts; DeckView merges into local state without router.refresh | ✅ |
| 16.D | **Live regen status** — `slide.regen.started`/`.finished` + `deck.regen.started`/`.finished`; peer-side spinner overlays match the actor's; full-deck started broadcasts re-added 2026-05-24 after user accepted the friction trade-off | ✅ |
| 16.D.5 | **Lock-state as realtime** — `slide.lock.changed` + `slides.locks.bulk-changed`; lock pills flip in lockstep | ✅ |
| 16.E | **Bell notifications** — `Notification` table, `fanOutNotification` helper, per-user `user:{prismaUserId}` channel, formatted bell rows (slide numbers + gender-neutral verbs), mark-all-read on bell open, 8 emission sites (comment / slide.regen.started / slide.regen.finished / deck.regen.started / deck.regen.finished / deck.generate.finished / share.invited / share.accepted). Grouping disabled per direction "things need to be accurate." | ✅ |
| **17.A** | **Shared upload + extraction infra (Phase 17 foundation)** — `lib/types/source.ts` discriminated-union schema w/ scratch / enhance / mimic / data variants; `lib/extract/{pptx,pdf}.ts` extraction modules; `lib/create/seed-from-extraction.ts` sessionStorage seeder; `deck-generate.ts` prompt branching on `source.kind` | ✅ shipped 2026-05-25 |
| **17.B** | **Enhance flow** — single-shot `/enhance` (2 cards: source-only + الهوية البصرية with logo under fonts), `POST /api/extract` (Supabase staging + Inngest extract-source: LibreOffice PPTX→PDF, Anthropic Files API upload, PPTX theme fonts/colors), `deck-generate.ts` branches on `source.kind === "enhance"` with VISUAL REUSE directive (Claude reads PDF document block, redraws assets as inline SVG). Asset extraction tried + reverted (clashed visually with Claude's SVG style). Streaming preview hardened: `StreamingSlideParser.didReset()` handles draft→polished pattern; SYSTEM_PROMPT routes iteration to thinking channel. | ✅ shipped 2026-05-25 |
| **17.C** | **Mimic flow (NEW this session)** — `/mimic` single-shot 3-card layout (content + branding-conditional + what-to-mimic), shared `/api/extract` pipeline (kind=`mimic`) for both files, `source.kind === "mimic"` with `designAnthropicFileId` + (`uglyAnthropicFileId` OR `userContent`), `deck-generate.ts` mimic branch with sentinel-escaped user content + "match design language only, render content verbatim" directive | ✅ shipped 2026-05-26 |
| **17.D** | **/create single-page rebuild + design-system unification** — collapsed `/create/{content,brand,summary}` 3-step wizard + `/create-from-template` route tree into single 4-card page (content / fonts+colors / logo / output settings). Wired `/api/extract` (kind=`create`) for file content path; extended `SourceScratchSchema` with optional `anthropicFileId` + scratch-with-file branch in `deck-generate.ts`. Promoted CardHeader / SegmentedToggle / InlineStepper / ColorPickerPopover / muted-CompactUploadZone to shared primitives; rolled out to /enhance + /mimic so all three flows share one design system. Logo upload restricted to SVG. | ✅ shipped 2026-05-26 |
| **17.E** | **Data flow** — `/from-data` upload UI, `POST /api/extract` (uploads XLSX to Anthropic Files API, returns `file_id` into `source.dataFileId`), Data prompt branch, post-generation Anthropic file cleanup | ⏳ |
| 18 | **Admin panel** — internal-only `/admin` route tree gated by `User.role = "admin"`. User list + filters (plan, country, regens, tokens). Aggregate stats (totals, active-online via Presence, decks/slides generated). Compose-bell-notification UI calling existing `fanOutNotification`. Email blast UI via Resend. Landing-page CMS (Page/Section/PricingPlan schema; landing reads from DB). UX bias: function-over-form, internal tool. **Same Next.js stack — no Laravel.** Reuses Prisma, Supabase auth, fanOutNotification, Resend. | ⏳ after Phase 17 |
| 19 | **Billing + Stripe + discount codes** — Stripe SDK (already in `package.json`), subscription products + checkout + customer portal, webhook → quota enforcement at job creation, meter UI in dashboard. Discount-code schema + apply-at-checkout (admin-issued via Phase 18 UI). | ⏳ after Phase 18 |
| 20 | **Server-side HTML sanitization** — DOMPurify in `deck-generate.ts` before persisting manifest; pre-launch security ask (today: browser sanitises on render, JSDOM mirror used in thumbnail pipeline only) | ⏳ pre-launch blocker |

---

## 17. Implementation Status & Lessons

### Working end-to-end today (as of 2026-05-26 — Phase 17.C + 17.D closed)

- **Auth + dashboard.** Supabase email + Google OAuth → real DB-backed dashboard (RecentProjects, MyTemplates, PlanUsage, QuickActions); navigation-back refresh wired so `/enhance → /dashboard` shows fresh project list without manual reload.
- **Three landing flows — UNIFIED (`/create`, `/enhance`, `/mimic`).** Phase 17.D shipped the /create single-page rebuild + design-system unification 2026-05-26. All three flows now share one CardHeader pattern, one SegmentedToggle, one InlineStepper, one SVG-only logo upload, one set of font-slot props (compact + alignStart + hideSample), one `min-h-[387px]` card baseline, and one animation spring (stiffness 500, damping 35). See §02 "Shared design system" for the full primitive ledger. **Files**: `app/{create,enhance,mimic}/page.tsx`, `components/create/controls.tsx`, `components/create/OutputCards.tsx`, `components/brand/{CompactUploadZone,FontUploadSlot,GoogleFontSlot}.tsx`.
- **Create flow (Flow 1) — Phase 17.D shipped 2026-05-26.** Single-page 4-card layout replacing the previous 3-step wizard + entire `/create-from-template` route tree. Template seeds hydrate the single page via `lib/create/seed-from-template.ts`. File-upload content path wired through `/api/extract` → polling → `source.kind === "scratch"` with `anthropicFileId` (extends `SourceScratchSchema` with optional file_id; scratch branch in `deck-generate.ts` attaches the document block + "raw material for a fresh deck" directive). Generate gated on extraction completing.
- **Enhance flow (Flow 2) — Phase 17.B shipped 2026-05-25.** Single-shot page (`/enhance`) with 2 cards (source-only + الهوية البصرية with logo under fonts), Anthropic Files API document-block pipeline, language detection from PPTX, `onFailure` hook surfaces retry button, `max_tokens: 64000`. Card chrome unified to /create pattern in Phase 17.D. _(Superseded 2026-05-29: preset menu collapsed 4 → 3 + migrated to Opus 4.8, and the opus-max draft chip was removed — see the preset menu section above.)_
- **Mimic flow (Flow 3) — Phase 17.C shipped 2026-05-26 (new flow).** Single-shot 3-card page (content + branding-conditional + what-to-mimic with animated mesh halo) with shared `/api/extract` pipeline for BOTH design reference + content file. Content card accepts text OR file. Branding card mounts only when "مُحاكاة الهوية البصرية" toggle is OFF (AnimatePresence width spring with overflow-toggle so popovers escape the card edge after settling). Sentinel-safe user-content escape in `deck-generate.ts` mimic branch.
- **Claude pipeline.** Opus 4.8 adaptive thinking at `effort:low` on `opus-balanced` (default); Opus 4.8 disabled-thinking on `opus-fast`; Sonnet 4.6 disabled-thinking on `sonnet-fast` only, with auto-upgrade to opus-fast on source-document flows. + prompt caching + self-healing Zod retry. Streams text deltas; throttled progress writes; partial-regen `redesign` mode prompt diversifies output when no comments are pinned. **Dropped after measured testing**: `effort:high` (opus-max — over-thinks on 4.8, 16 min/$1.69 for 5 slides), and earlier on 4.7 `effort:max` (stalls on Files API enhance) / `effort:xhigh` (marginal benefit at 1.17× cost).
- **Preview window.** Cascade-in, slide-nav, comment authoring with marker preview popup, per-slide pill (regen / history / lock), Save Project, thumbnail pipeline. Hero comment overlay + CommentsPanel both consume live broadcasts.
- **Partial regen + apply-comments.** Comment-driven slide regen with parallel Claude calls; deck stays visible during regen; atomic version promotion; apply-poller fetches manifest + slideStates + history in one round-trip so the History popover updates live.
- **PPTX / PDF / PNG / HTML export.** ~99 % Arabic preview ↔ PPT parity. PNG/PDF go through Puppeteer with the same renderer; PDF Range params honoured. "Made with Taqreer" badge on PNG output for view-only sharers.
- **Templates feature.** /templates page (own + community tabs) + a public landing `#templates` section. "Save copy as template" from a project tile; "Use this template" CTA on tile + lightbox → a forked Mimic flow at `/use-template/[id]` (the template's deck PDF is the design reference; same generation prompt as `/mimic`). Premium templates (`isPremium`) are Pro-gated server-side (402 → pricing). See §13.
- **Sharing + roles.** Owner / edit / comment / view ladder. ShareDialog with Share + Export tabs (tile launcher); editor-toolbox launcher is share-only (Export tab hidden — toolbar has dedicated buttons). Avatar on the visual-right of each PersonRow under RTL. Resend invite emails, accept route, public-access toggle.
- **Realtime collab (Phase 16).** Project channel (`project:{id}`) carries `comment.*`, `slide.regen.*`, `deck.regen.*`, `slide.lock.*` broadcasts. User channel (`user:{prismaUserId}`) delivers `notification.created` for bell rows. Presence avatars on slide thumbnails; peer-regen spinner overlay matches actor's view. Safari throttling backstop: 8 s catch-up poll while `peerRegenInProgress` is non-empty. Grouping disabled — every event gets its own accurate row.
- **Bell notifications.** 8 emission sites (comment, slide regen started/finished, deck regen started/finished, deck generate finished, share invited, share accepted). Bell + toast use `.in-slide-popover` tint so they read on bright slide backgrounds. Slide numbers + gender-neutral verbs in titles ("علّق على الشريحة 4 في …"). Mark-all-read on bell open.

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

1. **This file (`context.md`)** — architecture + how the pieces fit + active working plan. **Source of truth for "what's next"** (see §16 build phases + §21 Phase 17 detail).
2. [`context/plan-editor.md`](./plan-editor.md) — the active plan (in-canvas slide editor).
4. [`app/globals.css`](../app/globals.css) header — design system non-negotiables.
5. [`inngest/functions/deck-generate.ts`](../inngest/functions/deck-generate.ts) — system prompt + Claude call.
6. [`lib/schema/slide.ts`](../lib/schema/slide.ts) — v2 SlideManifest schema.
7. [`components/preview/DeckView.tsx`](../components/preview/DeckView.tsx) — preview state machine, comment + regen + save flows.
8. [`lib/export/html-export.ts`](../lib/export/html-export.ts) + [`bidi-postprocess.ts`](../lib/export/bidi-postprocess.ts) — export entry + BiDi post-processor.
9. [`app/spike/page.tsx`](../app/spike/page.tsx) — BiDi regression harness.

### Branch + PR strategy (locked 2026-05-21)

**`dev` is the only working branch. Two branches total. No feature branches, no hotfix branches, no test branches. EVER.**

| Branch | Purpose |
|---|---|
| `dev` | The ONE working branch. All commits land here. |
| `main` | Released. Updated via `dev → main` PR (CR-reviewed). |
| `dev-backup-YYYY-MM-DD`, `main-backup-YYYY-MM-DD` | Dated snapshots, only created before an unavoidable destructive remote write. Keep ~30 days. |

**Why no feature branches:** the previous `hotfix/thinking-config-adaptive` branch produced an 82-commit / 51-commit divergence with `dev` (same files edited on both sides). Recovery required a destructive force-replace of `dev` + safety backups on 2026-05-21. Solo developer doesn't need a second branch layer.

**The workflow:**
1. Local checkout: `dev`. ALWAYS. `git branch --show-current` should always print `dev`.
2. Edit, commit, push to `origin/dev`. That's it.
3. When the user says "open PR" → `gh pr create --base main --head dev` → CodeRabbit reviews.
4. CR findings → fix on `dev` → push → CR re-reviews.
5. Merge PR → `main = dev`.

**Hard rules (memory: `feedback_no_new_branches.md`):**
- **Never `git checkout -b <anything>`.** No experiments, no "let me try something on a side branch", nothing.
- **Self-check before every commit:** `git branch --show-current` must return `dev`. If it returns anything else, stop, switch to `dev`, ask the user how that branch ended up checked out.
- **Don't auto-push.** Commit freely; push only on user request or a meaningful milestone (>3 commits is the usual threshold).

**The destructive escape hatch (almost never needed):**

If a force-push to `dev` is ever truly unavoidable, create the safety nets FIRST:
```bash
git push origin refs/remotes/origin/dev:refs/heads/dev-backup-YYYY-MM-DD
git tag stable-YYYY-MM-DD && git push origin stable-YYYY-MM-DD
# only THEN: git push origin dev --force-with-lease
```

Restoring from backup if it goes wrong:
```bash
git push origin dev-backup-YYYY-MM-DD:dev --force
```

### Memory pointers

The Claude Code auto-memory at `~/.claude/projects/-Users-osama-taqreer/memory/` is loaded into every session via `MEMORY.md`. Re-read when in doubt:

**Project context:**
- `project_taqreer.md` — Arabic-first deck gen; RTL/BiDi quality is the differentiator.
- `project_html_pivot.md` — HTML pivot status, ~99 % parity milestone.
- `project_bidi_fix.md` — the three OOXML layers + run-merge architecture.
- `project_dom_to_pptx_patch.md` — the 5 library patches with line numbers.
- `project_local_dev.md` — DATABASE_URL → docker compose, Supabase is auth+storage only.

**Workflow rules (treat as non-negotiable):**
- `feedback_no_new_branches.md` — **‼️ hard rule.** `dev` is the only working branch. Never `git checkout -b`. Self-check before any commit. User flagged this after the hotfix-branch divergence incident.
- `feedback_design_system_discipline.md` — never hardcode, always read globals.css header, never guess. The full design system lives in `app/globals.css` (token catalog + class patterns); CodeRabbit flags violations. User has flagged this 3+ times.
- `feedback_discuss_before_coding.md` — paraphrase, propose, wait for go.
- `feedback_never_guess.md` — context/log is source of truth.
- `feedback_delete_failed_fixes.md` — revert before trying the next; never accumulate dead paths.
- `feedback_push_rhythm.md` — don't auto-push; batch commits before pushing.
- `feedback_verify_api_features.md` — WebFetch Anthropic docs before claiming behaviour.

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

## 21. Phase 17 — Upload-driven flows ✅ (shipped)

This phase shipped the remaining three flows (Enhance / Mimic / Data). They
share an **upstream pattern** — file ingestion → server-side extraction →
seed sessionStorage in the StandardBrief shape → user lands on `/create/brand`
(pre-filled) → `/create/summary` → POST `/api/projects`. From that POST
onward, all four flows funnel through the same Inngest `deck-generate.ts`
function. The only per-flow divergence inside `deck-generate.ts` is a prompt
branch keyed by `source.kind`.

This means **nothing new is built for the project page, toolbox, canvas,
slide-nav sidebar, BiDi patches, realtime broadcasts, presence, or bell
notifications** — all of that is shared infrastructure that's already
shipped (Phase 16 closed out 2026-05-24).

### 21.1 PNG-first extraction strategy (the architectural pivot)

We do NOT parse structured text out of PPT/PDF. Instead each slide is
**rasterized to a high-fidelity PNG** that Claude reads with its native
vision capability. This sidesteps the entire "parsed text loses layout
context" problem (data tables, captions tied to images, infographics, mixed
RTL/LTR runs, charts) and matches the way the Mimic flow was always going
to work anyway. Decision locked 2026-05-24.

What we DO extract programmatically alongside the PNGs:
- **Embedded images** (team-member photos, separators, decorative SVGs,
  logo marks) from the PPTX zip's `ppt/media/` or the PDF's embedded image
  streams. These persist to Supabase under `project-assets/{projectId}/`
  so Claude's generated HTML can reuse them via `<img src="…">`.
- **Font family names** from the PPTX theme XML (`<a:majorFont>` /
  `<a:minorFont>`) or PDF font dictionary. Listed in the brief; if a
  recognised Google Font, Claude includes the `<link>` automatically.
- **Brand palette** via a two-tier strategy:
  - **Tier 1 (PPTX)**: parse `ppt/theme/theme1.xml` `<a:clrScheme>` →
    `accent1` through `accent6`. The accent colors are almost always the
    brand palette — the deck designer picked them deliberately. Skip
    `bg1/bg2` (background defaults) and `tx1/tx2` (text defaults). Cost
    ~10 ms, zero AI.
  - **Tier 2 (PDF, or PPTX with a degenerate theme)**: run `colorthief`
    over each rasterized slide PNG, aggregate frequencies across slides,
    filter out neutrals (pure black/white, grays with HSL saturation
    < 10%, near-blacks with L < 8%, near-whites with L > 92%), cluster
    similar colors via HSL distance threshold, return top 5 by
    frequency. `colorthief` is already in `package.json` (used by the
    dashboard color filter). Cost ~50-100 ms per slide.
  - **Dispatcher**: try Tier 1 first for PPTX; fall through to Tier 2
    when Tier 1 returns fewer than 3 non-neutral accents (the "user used
    a blank template" case). PDF always uses Tier 2.

**Why no text extraction**: Claude sees the slide PNG and reads the text
itself, in context — exactly as a human collaborator would. Hint
engineering on extracted assets is also skipped: Claude correlates each
asset URL to where it appeared on the rasterized slide visually.

### 21.2 Shared contracts

`lib/types/brief.ts`:

```ts
export type ExtractedAsset = {
  url: string;             // Supabase public URL — persists for project lifetime
  originalSlide: number;   // 1-based slide index where it was used in the source
  // No semantic hint — Claude sees the slide PNGs and figures out where
  // each asset belongs from visual context.
};

export type SourceMeta =
  | { kind: "scratch" }
  | {
      kind: "enhance";
      slideImages: string[];           // base64 data URLs, PNG, 1920×1080 (16:9) or 1080×1920 (9:16)
      extractedAssets: ExtractedAsset[];
      fonts: string[];                  // ["Cairo", "IBM Plex Sans Arabic", …]
    }
  | {
      kind: "mimic";
      uglySlideImages: string[];       // content-source rasterized
      extractedAssets: ExtractedAsset[]; // FROM the ugly file (the good design file's assets aren't ours)
      fonts: string[];
      designReferenceImages: string[]; // good-file rasterized (Claude mimics this visual language)
    }
  | { kind: "data"; dataFileId: string; userContext?: string }; // Anthropic Files API file_id

export type StandardBrief = {
  title: string;
  description: string;
  language: "ar" | "en";
  slideCount: number;
  brand: {
    format: "16:9" | "9:16";
    colors: string[];
    fonts: { heading: FontSlot; body: FontSlot };
    logo: LogoInput | null;
  };
  source?: SourceMeta;  // omitted = scratch; deck-generate defaults to existing prompt
};
```

All `/api/[flow]/extract` routes produce a `StandardBrief` that gets seeded
into sessionStorage by `lib/create/seed-from-extraction.ts`. The
`/create/brand` and `/create/summary` pages already read from sessionStorage,
so no changes there.

**Color extraction populates `brand.colors[]` directly** (not `source.*`).
The user lands on `/create/brand` with the palette already filled in, and
can override before continuing. Fonts work the same way —
`source.fonts` carries the extracted typeface names so `deck-generate`
can render with the original fonts, but the user can still override on
`/create/brand`.

`deck-generate.ts` reads `brief.source.kind` and routes to a different
multipart Claude user message per flow. The system prompt also branches:
- `scratch` — existing prompt
- `enhance` — "You are redesigning a presentation. Each slide is provided as an image. Use the content verbatim; redesign the layout. The embedded assets listed are available to reuse via `<img>`."
- `mimic` — same as enhance + "These additional reference images show the design language to mimic. Match this aesthetic while using the content from the slides above."
- `data` — references the Anthropic Files file_id via `{type: "document", source: {type: "file", file_id}}`, prompt: "Build a narrative deck from this dataset."

### 21.3 Extraction modules (`lib/extract/`)

| Module | Input | Output |
|---|---|---|
| `rasterize.ts` | PPTX/PDF buffer | Array of PNG buffers (one per slide), 1920×1080 for 16:9 / 1080×1920 for 9:16. PPTX is converted to PDF via LibreOffice headless inside an Inngest extraction job (production needs LibreOffice on the host); then `pdfjs-dist` + `canvas` rasterizes each page. |
| `assets-pptx.ts` | PPTX buffer | Enumerate `ppt/media/*` entries via JSZip. Parse each slide's XML to record which slide each image was used on. Upload each image to Supabase `project-assets/{projectId}/{assetId}.{ext}` and return URL + originalSlide. |
| `assets-pdf.ts` | PDF buffer | Per-page image extraction via `pdfjs-dist` (`page.objs.get(...)` for image refs). Upload + return same shape as `assets-pptx`. |
| `fonts-pptx.ts` | PPTX buffer | Read `ppt/theme/theme1.xml` `<a:majorFont>` + `<a:minorFont>` typeface names. |
| `fonts-pdf.ts` | PDF buffer | Read PDF font dictionary via `pdfjs-dist` — typically returns PostScript font names that we normalise to family names. |
| `colors-pptx.ts` | PPTX buffer | Parse `<a:clrScheme>` in `ppt/theme/theme1.xml` — return `accent1`–`accent6` hex array. Filter out the bg/tx slots. Returns `null` when the theme is degenerate (e.g. all black/white) so the caller can fall through to colorthief. |
| `colors-rasterized.ts` | PNG buffer[] | Run `colorthief.getPalette(buffer, N=6)` per slide → aggregate into a frequency map → filter neutrals (`Math.abs(R-G)+Math.abs(G-B)<15` for grays; L<8 or >92 for near-blacks/whites) → cluster via HSL distance threshold (merge entries within ΔH<15° + ΔS<0.1 + ΔL<0.1) → return top 5 hex strings by aggregated frequency. |
| `index.ts` | File buffer + mime type | Dispatch by mime; orchestrates rasterize → assets → fonts → colors (Tier 1 then Tier 2 fallback). Returns the unified `{ slideImages, extractedAssets, fonts, colors }` quad. |

**Deployment dep**: LibreOffice headless on the server hosting the Inngest
worker. Local dev: `brew install libreoffice` (Mac). Production: Docker
image with LibreOffice or a separate conversion service. PPT → PDF
conversion is the single non-trivial install; everything else is pure JS.

### 21.4 Storage / retention

| Asset | Retention |
|---|---|
| Uploaded raw file (PPT/PDF/XLSX) | In-memory only. Freed at end of extraction request. |
| Slide PNGs | Base64-embedded in Claude's user message during generation. Not persisted — they're a snapshot of "what the original looked like," only useful during the generation pass. |
| Extracted embedded images | Persisted to Supabase `project-assets/{projectId}/{assetId}.{ext}` for the project's lifetime. Claude's generated HTML references them by URL. Deleted by the existing project-delete storage cleanup pipeline. |
| Data flow XLSX upload | Goes to Anthropic Files API only — never touches our storage. Deleted via Anthropic's API once `deck-generate` completes. |

### 21.5 Per-flow routes + pages

| Flow | UI page | API route | Prompt branch |
|---|---|---|---|
| Enhance | `/enhance` (drag-drop, file picker, extraction progress) | `POST /api/enhance/extract` (multipart in → fires Inngest extraction job → returns jobId → client polls → StandardBrief out) | `source.kind === "enhance"` |
| Mimic | `/mimic` (two drop zones: ugly content source + good design reference) | `POST /api/mimic/extract` (multipart in → Inngest extraction job → StandardBrief w/ uglySlideImages + extractedAssets + designReferenceImages out) | `source.kind === "mimic"` |
| Data | `/from-data` (drag-drop + optional context textarea) | `POST /api/data/extract` (multipart in → upload to Anthropic Files → StandardBrief w/ dataFileId out — no Inngest, fast path) | `source.kind === "data"` |

### 21.6 File-size caps

| Flow | Cap |
|---|---|
| Enhance | 100 MB |
| Mimic | 100 MB **per file** |
| Data | 25 MB |

### 21.7 Implementation order

17.A first (the shared infra) so each subsequent sub-phase only adds a route
+ page + prompt branch. Each of 17.B / C / D is independent of the others
once 17.A lands — they can ship sequentially or in parallel.

**17.A sub-steps:**
1. `lib/types/brief.ts` — StandardBrief + SourceMeta + ExtractedAsset types
2. `lib/extract/rasterize.ts` — PDF → PNG via pdfjs-dist + canvas; PPT → PDF via LibreOffice headless wrapper
3. `lib/extract/assets-{pptx,pdf}.ts` — embedded image extraction + Supabase upload
4. `lib/extract/fonts-{pptx,pdf}.ts` — font family extraction
5. `lib/extract/colors-pptx.ts` — `<a:clrScheme>` parser (Tier 1)
6. `lib/extract/colors-rasterized.ts` — colorthief aggregation + neutral filter + HSL clustering (Tier 2)
7. `lib/extract/index.ts` — dispatcher (Tier 1 → Tier 2 fallback for colors; orchestrates rasterize + assets + fonts + colors). Returns the unified `{ slideImages, extractedAssets, fonts, colors }` shape.
8. `lib/storage/project-assets.ts` — wraps Supabase upload + signed URL signing for `project-assets/{projectId}/` bucket path
9. `lib/create/seed-from-extraction.ts` — writes StandardBrief (including `brand.colors[]` and `source.fonts`) to sessionStorage
10. `inngest/functions/extract-source.ts` — Inngest function that calls the unified extractor and persists the StandardBrief for the client to poll
11. `inngest/functions/deck-generate.ts` — branch on `source.kind`; multipart Claude user message with image blocks for slideImages, asset URLs listed in prose, fonts + colors listed in brief block.

---

## 22. Bilingual, theming & the blue design system ✅ (2026-06, on PR #57 → main)

A large milestone across i18n, theming, and a full visual-language change. See
[context/architecture.md](context/architecture.md) for the current structured map.

### 22.1 Bilingual `[lang]` migration
- Every route moved under `app/[lang]/` (`ar` | `en`). `proxy.ts` redirects bare
  URLs to a locale prefix, then refreshes the Supabase session (skips `/api` +
  static files). `<html dir lang>` set per-locale by the `[lang]` layout.
- ~895 dictionary keys in `dictionaries/{ar,en}.json` (en = the reference shape;
  ar must stay key-identical). Server: `getDictionary`. Client: `LocaleProvider`
  (`useDict`/`useLocale`). Strings + **logical-properties** sweep across ~90
  files (0 hardcoded Arabic / physical `left`/`right` left).
- **Two independent direction axes**: chrome dir = UI locale; canvas dir =
  `manifest.direction`. `stripLocale()` before any pathname check;
  `localizedHref` / `switchLocaleHref` for nav. `User.locale` persists the choice.
- Exceptions that stay Arabic-aware: the BiDi demo + the AR font specimen.

### 22.2 Light / dark theming
- `tq_theme` cookie, SSR-applied (`themeClass` on `<html>`) → no flash.
  `ThemeToggle` flips a `.light` class + the cookie.
- `:root.light` overrides ONLY the neutral scale (shadcn light defaults) + the
  accent. Theme-aware overlay tokens (`--tq-overlay-*`, `--tq-dot`,
  `--logo-invert`) + `@theme inline` mapping (`--color-foreground/-border/…`) so
  `text-foreground` / `bg-surface` / `border-border` flip automatically.
- Light flips the dashboard **gutter (white) ↔ content panel (gray)** vs dark.
- `ThemeLogo` swaps `/logo-light.svg` (white) ↔ `/logo-blue.svg` (solid
  `#0057FF`) by theme via CSS, no JS.

### 22.3 ONE BLUE accent — purple removed
- The brand collapsed to a single **blue** accent (`#0057FF` main). Token still
  *named* `--tq-purple` for back-compat but resolves to blue: **dark `#3380FF`**
  (brighter) / **light `#0057FF`**; aliases (`--tq-blue/-violet/-magenta/
  -lavender` + `-rgb`) all follow. Blue ramp: `#0042E0 / #1E6BFF / #0057FF /
  #3380FF / #66A3FF`.
- The AI mesh gradient, aurora glow, hero `.text-gradient`, all `--tq-gradient-*`,
  the `--color-brand-purple-*` scale (selection highlight), the wordmark SVG, and
  the editor marquee → all blue. **No purple/magenta** except the `--tq-export-
  html/-png` file-type icon tints (deliberate categorical set).
- **Flat, locked**: the glass system was already gone; this locked the palette.
  Typography capped at Cairo **400–700** (no Black/900). Brand voice: **no em dash**.

### 22.4 Chrome
- **No Header** (deleted §20). `TopUtilityBar` (search + theme + lang) pinned to
  the content panel top. **Sidebar** = always-collapsed 60px icon rail (`start-2`),
  icons 18px, tooltips portaled. Profile menu gained a **theme toggle** + a
  **Language ›** drilldown (instant swap). Active nav fill is theme-aware.
- Content wrapped in `.tq-content-panel` (rounded). Home aurora kept; **flow-page
  background glow removed** (flat dot texture only).

### 22.5 Brand guidelines
- `public/brand-guidelines.html` — a self-contained, downloadable spec for
  designers (logo, blue palette, Cairo type, live components, glow usage) with a
  dark/light toggle. Live at `/brand-guidelines.html`.

### 22.6 CodeRabbit pass
- PR #57 review addressed: open-redirect guard on login `?next=`, proxy skips
  session refresh for static files, locale-aware internal links, dir-aware
  pagination chevrons, a11y `role="menu"`, lint `set-state-in-effect` fix, etc.

---

*Living document — updated each shipping milestone. Change history is the git log.*
