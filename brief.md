# Taqreer — Claude Code Project Brief

## Coding Rules

- **Always use Tailwind utility classes for styling.** Never write raw CSS properties (e.g. `backdrop-filter`, `background`, `border`) in custom CSS classes or inline styles when a Tailwind class exists. Tailwind v4 uses a CSS variable chain for composable utilities (e.g. `backdrop-blur-*`, `bg-*`, `border-*`) — using raw CSS overrides that chain and breaks the output.
- Use `globals.css` only for things Tailwind cannot express: complex animations (`@keyframes`), pseudo-element tricks, and semantic component classes (`.card-dark`, `.btn-gradient`) that combine many utilities into a reusable pattern.

---

You are building **Taqreer** (taqreer.ai), an AI-powered Arabic presentation platform. The core value is simple: turn ugly content into beautiful presentations. Claude handles all design. Users review, comment, and export.

**There is no manual editor.** The user never drags, resizes, or types on a slide. Claude does all the design work. The user's job is to review and give feedback.

**Everything is JSON.** Slides live as structured JSON in the database. They render as HTML/CSS in the browser. PPTX and PDF are only generated on export. This is a deliberate architecture choice that keeps the platform fast, lightweight, and font-friendly.

---

## Overall Progress: 42% complete

| Phase | Description | Status | % |
|---|---|---|---|
| Phase 1 | Foundation | ✅ Complete | 100% |
| Phase 2 | Core Loop (Create → Preview → Export) | 🔄 In progress | 0% |
| Phase 3 | Expand Flows (Enhance, Mimic, Custom) | ⏳ Not started | 0% |
| Phase 4 | Business Layer (Stripe, Brand Kits, Admin) | ⏳ Not started | 0% |
| Phase 5 | Ecosystem (Templates, Community, Public) | ⏳ Not started | 0% |

---

## Current Infrastructure (Already Done — Do Not Rebuild)

| Item | Detail |
|---|---|
| Server | Hetzner CPX22, IP 178.105.88.35, Ubuntu 24.04, root user |
| Domain | taqreer.ai with SSL active |
| Runtime | Node.js 20, Nginx, Redis, PostgreSQL, PM2 |
| Project path | /root/taqreer |
| Database | PostgreSQL, db: taqreer, user: taqreer_user |
| App | Next.js 16, TypeScript, Tailwind CSS, live on taqreer.ai |
| Repo | https://github.com/taqreerai/taqreer.git |
| Local dev | Mac, running on localhost:3000, PostgreSQL + Redis via Docker |

## What Is Already Built

- Arabic RTL homepage with animations, LogoMarquee, TemplatesScroll
- Dashboard shell: collapsible RTL sidebar, glass header, QuickActions, RecentProjects, MyTemplates, PlanUsage
- Full CSS design system in globals.css
- Prisma schema with migrations
- Coming soon page
- **Supabase Auth & Storage — fully complete**
- **5 Supabase Storage buckets created** — source-files, brand-assets, generated-presentations, slide-previews, template-assets
- **Resend configured** for password reset emails
- **Git workflow** — main/dev branches, CodeRabbit auto-review on PRs
- **Zod schema** for slide JSON — `lib/schema/slide.ts` complete
- **Inngest** — 5 background job functions registered and connected (dot-format event names)
- **Sentry** — error monitoring configured (sentry.client/server/edge.config.ts, global-error.tsx)
- **Prisma schema** — fully migrated with all models: User, Project, Presentation, PresentationVersion, File, Comment, Job, Template, BrandKit, Folder, Subscription, UsageEvent
- **Dashboard connected to real data** — RecentProjects, MyTemplates, PlanUsage all query DB with empty states
- **proxy.ts** — middleware renamed and updated for Next.js 16
- **date-fns** installed for relative time formatting
- **5 Supabase Storage buckets created:** source-files, brand-assets, generated-presentations, slide-previews, template-assets
- **Resend configured in Supabase** for password reset emails
- **Git workflow set up:** main + dev branches, CodeRabbit auto-review on PRs to main
- **Pipeline validation test — PASSED:** Zod schema, HTML/CSS Arabic rendering, PPTX export, thumbnails all proven
- **Zod schema for slide JSON:** `lib/schema/slide.ts` — complete, validated, gatekeeper in place
- **Sample manifest:** `lib/test/sample-manifest.ts` — Arabic test slides with Cairo font
- **Test page:** `app/test-pipeline/page.tsx` — live at localhost:3000/test-pipeline
- **Inngest background jobs — set up and connected:**
  - `deck/generate.requested` → deck-generate.ts
  - `brand/analyze.requested` → brand-analyze.ts
  - `area/redesign.requested` → area-redesign.ts
  - `deck/export.requested` → deck-export.ts
  - `template/save.requested` → template-save.ts
- **Prisma client** updated to v7.8.0, `lib/prisma.ts` created
- **tsx** installed for running TypeScript scripts
- **CodeRabbit** configured with `.coderabbit.yaml`

---

## Git Workflow

Two branches only: `main` (production) and `dev` (all active development).

- **Never push directly to `main`.**
- All work happens on `dev`. Open a PR from `dev` → `main` when ready to deploy. CodeRabbit will auto-review the PR.
- `.gitignore` includes `.DS_Store` and `.claude/` — already added.

```bash
# Daily workflow — always on dev
git checkout dev
git add .
git commit -m "feat: description"
git push origin dev

# Deploy — open PR dev → main on GitHub, merge after CodeRabbit review
# Then on server:
ssh root@178.105.88.35
cd /root/taqreer && git pull && pm2 restart taqreer
```

---

## Local Dev — How to Start

Always run two terminals:

**Terminal 1 — Next.js:**
```bash
cd ~/taqreer
npm run dev
```

**Terminal 2 — Inngest:**
```bash
cd ~/taqreer
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

---

## The Core Philosophy

Taqreer does one thing: **turns content into beautiful presentations.**

Claude handles all design decisions. The user provides content and brand — Claude does the rest. The user's only interaction after generation is:

- **Review** — browse slides in the preview window
- **Comment** — mark areas and leave feedback
- **Regenerate** — Claude redesigns based on comments
- **Export** — download as PPTX or PDF
- **Save as template** — store the style for future use

**There is no manual slide editor.** This is deliberate. The value is in Claude's design quality, not in giving users tools to break things.

---

## The JSON-First Architecture

This is the most important architectural decision in Taqreer. Read it carefully.

**Every slide is JSON.** The JSON describes layout, text, colors, fonts, images, shapes, and positions on a 1920×1080 canvas. The JSON is the single source of truth.

**Slides render as HTML/CSS in the browser.** A Next.js component takes slide JSON and renders it as a `<div>` styled to 1920×1080, with absolutely-positioned children for text, images, and shapes. The user's browser handles all rendering — no server-side conversion, no LibreOffice, no PNG generation for preview.

**Custom fonts load via @font-face from Supabase URLs.** When a user uploads a brand font, it goes to Supabase Storage. The slide renderer references it via `@font-face { src: url('https://supabase...font.woff2') }`. The browser fetches the font on demand. Zero fonts installed on the server.

**PPTX and PDF are generated only on export.** PptxGenJS converts JSON → .pptx in Node.js (or the browser). PDF export uses headless Chrome (Puppeteer) to print the HTML slides to PDF. Both happen only when the user clicks export, not during preview.

**Comments operate on JSON elements, not pixels.** When a user draws a selection box on a slide, Taqreer figures out which JSON elements (or area) that box covers. The comment is attached to elements + a screenshot for visual context. Claude updates the JSON for those elements. The slide re-renders instantly.

**Storage stays tiny.** Each project stores only JSON. PPTX, PDF, and thumbnails are generated on demand. Even thousands of projects cost almost nothing in Supabase Storage.

---

## Design Vocabulary (Constrain Claude's Output)

The biggest risk in a JSON-first architecture is **visual parity** — the slide looks perfect in the browser but renders broken in PowerPoint after PPTX export. PptxGenJS does not support 100% of CSS, so Claude must be constrained to use only properties that work in **both** the browser preview and the exported PPTX.

This is enforced two ways: (1) the system prompt restricts what Claude can produce, (2) the Zod schema rejects invalid output.

**✅ Allowed in slide JSON (supported by both HTML and PptxGenJS):**
- Solid background colors
- Linear gradients with 2 stops
- Basic drop shadows
- Standard font families (with @font-face URL for custom fonts)
- Font weight (100–900)
- Font size in points
- Text color, alignment, line height
- Text direction (rtl/ltr)
- Bold, italic, underline
- Element rotation in degrees
- Solid borders with width and color
- Border radius (basic — no per-corner radii)
- Standard shapes: rectangle, circle, ellipse, line, triangle
- Image positioning, scaling, basic cropping
- Bullet and numbered lists
- Basic tables (rows, columns, cell colors)

**❌ Forbidden in slide JSON (browser-only, breaks in PPTX):**
- CSS filters (blur, brightness, hue-rotate)
- `backdrop-filter` / `backdrop-blur`
- Multi-stop gradients (>2 stops)
- Conic gradients, radial gradients
- CSS transforms beyond rotation (no skew, no perspective)
- `mix-blend-mode` and `background-blend-mode`
- Per-corner border radius
- CSS variables in element values
- Pseudo-elements (`::before`, `::after`)
- Complex SVG paths embedded as background
- CSS animations or transitions (presentations are static)
- `clip-path` (use shapes directly instead)
- Text strokes / text shadows beyond simple drop shadow

**Enforcement:**
- The Claude system prompt explicitly lists allowed properties and forbids the rest
- The Zod schema for slide JSON uses enums for properties like `gradient.type`, `shape.kind`, `border.style`
- Anything outside the allowed set fails validation → Inngest retries with the error message

---

## Zod Schema Validation (The Gatekeeper)

Claude's JSON output is **never trusted directly**. Every response is validated through a strict Zod schema before being written to the database.

```
Claude returns JSON
        ↓
Zod schema validates
        ↓
   ┌────┴────┐
 Pass     Fail
   ↓        ↓
Save     Retry Claude call with the
to DB    validation error in the prompt
```

**Self-healing pattern:**
If validation fails, the Inngest job appends the Zod error message to the original prompt and retries. After 3 retries, the job is marked as failed and surfaced in Sentry. This pattern means most LLM glitches self-heal without user impact.

The Zod schema lives in `lib/schema/slide.ts` and is the single source of truth for slide structure.

---

## Thumbnail Scaling (RTL Gotcha)

Slides render at 1920×1080 internally and scale down to fit thumbnails and the main preview.

1. **Use `transform: scale()` on the wrapper, not on individual elements.**
2. **Set `transform-origin: top right` for RTL slides.** The default is `top left` — for Arabic content, scaling from the wrong corner pushes content out of the visible area.

```css
.slide-wrapper {
  width: 1920px;
  height: 1080px;
  transform-origin: top right; /* top left for LTR */
  transform: scale(var(--scale));
}
```

---

## The 4 Core Flows

All 4 flows end in the same preview window with the same actions.

| Flow | Arabic | Input | What Claude does |
|---|---|---|---|
| Create | إنشاء | Content + brand brief | Designs everything from scratch |
| Enhance | تحسين | Existing PPTX | Converts PPTX → JSON, improves design and flow, keeps content |
| Mimic | محاكاة | Content + style reference PPTX | Extracts style from reference, rebuilds user content in that style |
| Custom | مخصص | Content + template style contract | Generates within the chosen template's visual system |

---

## The User Journey (end to end)

```
User picks a flow (إنشاء / تحسين / محاكاة / مخصص)
        ↓
Provides input (content, brand, reference PPTX, or template)
        ↓
Claude generates slide JSON (the manifest)
        ↓
Browser renders JSON as HTML/CSS slides
        ↓
Preview window opens — user browses slides
        ↓
User can:
  ├── Comment on a specific area → Claude updates JSON → preview re-renders
  ├── Regenerate entire deck → Claude returns new JSON
  ├── Export as PPTX (PptxGenJS converts JSON → .pptx)
  ├── Export as PDF (Puppeteer prints HTML → .pdf)
  └── Save as template → JSON stored, thumbnails captured, PPTX generated
```

---

## The Preview Window

The preview window is the heart of the product. It is **not** an editor — it is a review interface.

**Layout:**
```
┌─────────────────────────────────────────┐
│  Action bar (top)                        │
├──────────────────────┬──────────────────┤
│                      │  Slide 1         │
│   Main slide view    │  Slide 2         │
│   (HTML/CSS, scaled) │  Slide 3 ←panel  │
│                      │  ...             │
└──────────────────────┴──────────────────┘
```

**Action bar:**
- `أعد التصميم` — Regenerate entire deck with same inputs
- `تصدير PPTX` — Export as PowerPoint
- `تصدير PDF` — Export as PDF
- `حفظ كقالب` — Save as template

---

## The Commenting System

```
User draws selection box on slide area
        ↓
Taqreer captures:
  - JSON element IDs that fall inside the box
  - Bounding box coordinates (x, y, width, height) on 1920×1080 canvas
  - Slide ID
  - Screenshot of the area (html2canvas → PNG, vision context for Claude)
  - User's comment text
        ↓
Payload sent to Claude:
{
  "slideId": "slide_03",
  "areas": [
    {
      "areaId": "area_01",
      "elementIds": ["el_42", "el_43"],
      "bounds": { "x": 0, "y": 0, "width": 960, "height": 200 },
      "screenshot": "https://supabase.../area.png",
      "comment": "اجعل هذا العنوان أكبر وأكثر جرأة"
    }
  ]
}
        ↓
Claude returns updated JSON for the affected elements
        ↓
Preview re-renders that slide instantly
```

**Important:** the screenshot is for **visual context only**. Claude edits the JSON, not the pixels.

---

## Template Storage

| Asset | Format | Stored in | Generated when |
|---|---|---|---|
| Style contract / slide JSON | JSON | PostgreSQL `templates.style_contract` | At save (already exists) |
| Slide thumbnails | PNG | Supabase Storage `template-assets` | At save (html2canvas) |
| PPTX file | .pptx | Supabase Storage `template-assets` | At save (PptxGenJS) |

---

## The Ecosystem — How Everything Links

```
User runs any flow (إنشاء / تحسين / محاكاة / مخصص)
        ↓
Claude generates slide JSON → Preview window opens
        ↓
Project auto-saved → appears in Projects + dashboard Recent Projects
        ↓
User can save as Template → appears in My Templates + مخصص picker
        ↓
User can make template Public → appears on community Templates page
        ↓
Community uses template → use_count increments
        ↓
High use_count → Taqreer team can feature it on Templates hero section
```

---

## Branding & Design System

- Background: `#03030D`
- Blue: `#370BF4`, Magenta: `#E036B8`, Lavender: `#9326C9`, Violet: `#7D2DFF`
- Muted: `#9A94A8`, Border: `rgba(42,36,59,0.8)`
- Fonts: Cairo (Arabic), Poppins (English)
- Dark theme, RTL-first
- Key globals.css semantic classes: `plan-banner`, `settings-card`, `card-dark`, `glass-card`, `btn-gradient`, `btn-outline-dark`, `btn-danger`, `btn-icon`, `nav-active` (solid `#370BF4` bg, white text), `nav-item`, `sidebar-bg`, `page-container`, `divider-dark`, `dashboard-bg`, `badge-purple`, `progress-track`, `progress-bar`, `input-dark`, `input-search`
- Sidebar: 4 action buttons (إنشاء `#370BF4`, تحسين `#E036B8`, محاكاة `#9326C9`, مخصص `#7D2DFF`) — active state uses solid brand color bg; nav links active state uses solid `#370BF4`

---

## Product Architecture

```
User input / uploaded PPTX / selected template
        ↓
Taqreer prepares a structured brief
        ↓
Claude generates slide JSON
        ↓
JSON saved to PostgreSQL
        ↓
Browser renders JSON as HTML/CSS slides
        ↓
User reviews in preview window
        ↓
User comments on areas (DOM-based selection + screenshot context)
        ↓
Claude updates JSON for affected elements
        ↓
Browser re-renders affected slides instantly
        ↓
On export: PptxGenJS (PPTX) or Puppeteer (PDF) generates files
```

### Layer Ownership

| Layer | Owns |
|---|---|
| Claude | All design — initial generation, area redesign, full regeneration |
| Browser | Slide rendering (HTML/CSS), comment selection, thumbnails (html2canvas) |
| Taqreer server | Flows, API routes, brief construction, file generation on export |
| Supabase | Auth (email + Google OAuth) + storage (uploads, fonts, exports) |
| Inngest | Durable background jobs for AI generation, area redesign, exports |
| PostgreSQL | Slide JSON, projects, templates, comments, all relational data |
| Stripe | Plans, subscriptions, quotas, billing |

---

## Final Stack

| Area | Decision |
|---|---|
| Hosting | Hetzner CPX22 — already running |
| Frontend | Next.js 16, RTL-first — already running |
| Database | PostgreSQL + Prisma v7.8.0 — already running |
| Cache | Redis — already running |
| Auth | Supabase Auth — email + Google OAuth ✅ |
| Storage | Supabase Storage buckets ✅ (5 buckets created) |
| Background jobs | Inngest v4.3.0 ✅ (5 functions connected) |
| Real-time updates | Supabase Realtime — listens to `presentation_versions` |
| Error monitoring | Sentry ✅ — configured |
| Analytics | Not configured |
| AI | Anthropic Claude API |
| Payments | Stripe — Phase 4 |
| Slide rendering (preview + thumbnails) | HTML/CSS in the browser — no server-side rendering |
| Custom fonts | @font-face from Supabase URLs — no server installs |
| Thumbnail capture | html2canvas — only when saving as template |
| PPTX export | PptxGenJS — converts JSON → .pptx (only on export) |
| PDF export | Puppeteer — prints HTML slides to PDF (only on export) |
| No browser editor | Deliberate — Claude handles all design |
| No LibreOffice | Removed — HTML/CSS rendering replaces it entirely |

---

## Build Order & Progress

### PHASE 1 — Foundation · 85% done

#### ✅ 1.1 Infrastructure & Auth (complete)
#### ✅ 1.2 Dashboard UI (complete)
#### ✅ 1.3 Storage Buckets (complete — 5 buckets created)
#### ✅ 1.4 Resend Email (complete — configured in Supabase)
#### ✅ 1.5 Dev Branch (complete — main/dev structure, CodeRabbit configured)
#### ✅ 1.6 Pipeline Validation Test (complete — all 5 steps passed)
- Zod schema validates correctly ✅
- HTML/CSS Arabic rendering works ✅
- PPTX export with Arabic text works ✅
- Thumbnails scale correctly with `transform-origin: top right` ✅
- PDF via Puppeteer works ✅

#### ✅ 1.7 Inngest Background Jobs (complete — 5 functions registered)
- `deck/generate.requested` — calls Claude API, validates with Zod, saves to DB
- `brand/analyze.requested` — Claude vision extracts colors/fonts from screenshot
- `area/redesign.requested` — Claude redesigns commented areas, saves new version
- `deck/export.requested` — PptxGenJS or Puppeteer, uploads to Supabase, returns signed URL
- `template/save.requested` — saves JSON + generates PPTX artifact

#### ✅ 1.8 Sentry (integrated)

**Sentry:** server errors, client errors, failed uploads, failed generation jobs, export failures.

#### 🔜 1.9 Connect Dashboard to Real Data
- RecentProjects — query projects table for current user
- MyTemplates — query templates table for current user
- PlanUsage — query subscriptions and usage_events for current user
- QuickActions — wire to real flow routes

---

### PHASE 2 — Core Loop · 0% done

**Goal:** User can create a presentation, review it, comment on it, and export it. This is the MVP.

#### 2.1 Create Flow (إنشاء)

**Step 1 — Content Input (`/create/content`)**
- Upload file: PPTX, PDF, DOCX, TXT, images (drag & drop zone)
- OR paste text manually (large textarea)
- Click التالي →

On Next → inline progress:
- "جارٍ قراءة المحتوى..."
- "جارٍ تحليل الهيكل..."

**Step 2 — Brand & Settings (`/create/brand`)**
- Upload brand palette screenshot → Claude vision extracts colors on Next click
- OR pick colors manually via color picker (primary, secondary, background, text)
- Upload heading font + body font files → stored in Supabase, served via @font-face URLs
- Upload logo (SVG preferred)
- Slide size: `16:9` or `9:16`
- Slide count:
  - ○ طابق عدد صفحات الملف المرفوع *(only if file uploaded in Step 1)*
  - ○ اتركها لنا — سنقرر بناءً على المحتوى
  - ○ حدد عدداً — number input, capped by plan (Free: 10, Plus: 60, Pro: 90)
- Click التالي →

On Next → Claude vision call. Show progress:
- "جارٍ استخراج الألوان..."
- "جارٍ فهم هوية العلامة التجارية..."
- "جارٍ تحليل الخطوط..."

**Step 3 — Editable AI Summary (`/create/summary`)**
- Color palette swatches — click any to edit
- Font preview — heading and body, editable, rendered with the actual uploaded fonts
- Logo preview — replaceable
- Slide count confirmed
- Content outline — bullet list of planned slides, editable

Two CTAs:
- `إنشاء` — generate only
- `إنشاء وحفظ كهوية بصرية` — generate + save as brand kit

On approval → build brief → trigger Inngest `deck/generate.requested` → generation screen.

**Generation Screen (`/create/generating`)**
- All slide placeholders appear immediately as shimmer cards
- **Supabase Realtime** subscribes to `presentation_versions` for this project
- As Claude finishes each slide and writes it to the DB, Realtime pushes the update
- Frontend renders the new slide HTML/CSS instantly — no PNG fetch, no polling
- Progress: "جارٍ تصميم الشريحة 3 من 10..."
- On full completion → auto-redirect to `/preview/[projectId]`

#### 2.2 Slide Renderer Component

The single most important component in Taqreer. A React component that takes slide JSON and renders it as HTML/CSS.

**Responsibilities:**
- Render a 1920×1080 `<div>` scaled to fit its container via CSS transform
- Render each element (text, image, shape) with absolute positioning
- Apply colors, fonts, sizes from JSON
- Load custom fonts via `@font-face` from Supabase URLs
- Handle Arabic RTL natively (browser does it for free)
- Used in: preview window, thumbnail panel, generation shimmer cards, template library cards
- Used by: html2canvas to capture thumbnails when saving as template

**Note:** A basic version of this already exists at `app/test-pipeline/page.tsx` — use it as the starting point.

#### 2.3 Preview Window (`/preview/[projectId]`)

- Slide panel on right (smaller versions of the same renderer)
- Main slide view in center (renderer at full scale)
- Action bar with redesign / export PPTX / export PDF / save as template
- Click-and-drag area selection on the main view
- Comment box appears with selected area highlighted
- Submit → triggers `area/redesign.requested` → Realtime push when done

#### 2.4 Area Redesign Job — already built in Inngest

#### 2.5 Export — already built in Inngest

---

### PHASE 3 — Expand Flows · 0% done

#### 3.1 Enhance Flow (تحسين)
#### 3.2 Mimic Flow (محاكاة)
#### 3.3 Templates Page
#### 3.4 Custom Flow (مخصص)

---

### PHASE 4 — Business Layer · 0% done

#### 4.1 Stripe Payments
#### 4.2 Brand Kits (standalone)
#### 4.3 Admin Panel (next-admin + custom pages)

---

### PHASE 5 — Ecosystem · 0% done

#### 5.1 Save as Template (from preview window)
#### 5.2 Community Templates
#### 5.3 Template Creation (Taqreer team)

---

## Database Schema

| Table | Purpose | Key Fields |
|---|---|---|
| users | Synced from Supabase Auth | id, supabase_user_id, email, name, avatar_url, plan, role |
| projects | Project container | id, user_id, title, type, status, created_at |
| presentations | Current presentation record | id, project_id, current_version_id, title, language, direction |
| presentation_versions | Version history with slide JSON | id, presentation_id, version_number, slide_json, status |
| files | Uploaded user assets (fonts, logos, content) | id, project_id, type, storage_url, mime_type, metadata |
| brand_kits | Reusable brand systems | id, user_id, name, json_data (colors, fonts, logo URLs) |
| comments | Area comments per slide | id, version_id, slide_id, area_id, element_ids, bounds_json, screenshot_url, content, status |
| jobs | Inngest job tracking | id, inngest_run_id, type, status, input_json, output_json |
| templates | Premade and user templates | id, owner_id, title, category, industry, language, direction, featured, slide_count, style_contract (JSON), pptx_url, thumbnail_urls, use_count, is_public, plan_required, created_at |
| subscriptions | Stripe state | id, user_id, stripe_customer_id, plan, status, current_period_end |
| usage_events | Quota tracking | id, user_id, event_type, amount, metadata, created_at |

**Note:** `presentation_versions.slide_json` is the canonical source of truth for a deck. PPTX and PDF files are not stored persistently — they're regenerated on demand at export time.

---

## Slide JSON Schema

The full Zod schema lives in `lib/schema/slide.ts`. Here is a sample manifest:

```json
{
  "version": "1.0",
  "presentationId": "pres_abc",
  "language": "ar",
  "direction": "rtl",
  "canvas": { "width": 1920, "height": 1080 },
  "fonts": {
    "heading": { "name": "BrandHeading", "url": "https://supabase.../heading.woff2" },
    "body": { "name": "BrandBody", "url": "https://supabase.../body.woff2" }
  },
  "palette": {
    "primary": "#370BF4",
    "secondary": "#E036B8",
    "background": "#03030D",
    "text": "#FFFFFF",
    "muted": "#9A94A8"
  },
  "slides": [
    {
      "slideId": "slide_01",
      "role": "cover",
      "background": { "type": "color", "value": "#03030D" },
      "elements": [
        {
          "id": "el_01",
          "type": "text",
          "role": "headline",
          "x": 80, "y": 200, "width": 1760, "height": 200,
          "content": "العنوان الرئيسي",
          "fontFamily": "BrandHeading",
          "fontSize": 72,
          "color": "#FFFFFF",
          "textAlign": "right",
          "direction": "rtl"
        }
      ]
    }
  ]
}
```

---

## Claude Generation Pipeline

Claude outputs **slide JSON only**. PPTX is never generated by Claude — Taqreer generates it from JSON when the user exports.

**Initial generation prompt contract:**
```
Generate a slide JSON manifest for a presentation.

Rules:
- Use a 1920 × 1080 canvas coordinate system.
- Every element must have a stable ID.
- Provide x, y, width, height, content, and style for each element.
- Reference fonts by their declared name in the fonts object.
- For Arabic, set direction: "rtl" and textAlign: "right".
- Return only valid JSON matching the Taqreer schema.
- Only use properties from the Taqreer design vocabulary (no CSS filters, no backdrop-blur, no radial gradients).
```

**Area redesign prompt contract:**
```
You are redesigning specific elements of a presentation slide.
For each area, you receive:
- The slide's full JSON
- The element IDs inside the comment area
- A screenshot of the area (for visual context only)
- The user's comment describing what to change
- The bounding box of the area

Rules:
- Only modify the specified element IDs
- Keep all other elements unchanged
- Maintain the slide's overall style and palette
- Return only the updated elements with their IDs
- For Arabic, maintain RTL and right alignment
```

---

## Real-Time Updates

Supabase Realtime listens to `presentation_versions` changes for the current project.

```
Frontend subscribes:
  supabase
    .channel('presentation:' + projectId)
    .on('postgres_changes', { event: '*', table: 'presentation_versions' }, handleUpdate)
    .subscribe()
        ↓
Inngest writes new slide JSON to DB → Realtime pushes to frontend
        ↓
Frontend re-renders affected slides instantly via the slide renderer component
```

---

## Export Pipeline

**PPTX export:**
```
Slide JSON → PptxGenJS → .pptx file → Supabase Storage → signed URL
```

**PDF export:**
```
Slide JSON → render HTML pages → Puppeteer prints to PDF → Supabase Storage → signed URL
```

Both run as Inngest jobs (`deck/export.requested`).

---

## Key Risks

- **Visual parity (PPTX vs HTML):** Mitigated by strict Design Vocabulary constraining Claude's output.
- **JSON schema drift:** Mitigated by Zod validation as a hard gatekeeper, with self-healing retries.
- **Thumbnail scaling on RTL:** Always use `transform-origin: top right` for RTL slides.
- **Area redesign accuracy:** Claude must update only targeted element IDs. Heavy prompt engineering required.
- **Custom font loading edge cases:** Validate uploads (only .woff2, .woff, .ttf, .otf). CORS must be configured on Supabase Storage.
- **html2canvas fidelity:** Thumbnails may differ slightly from live preview for complex CSS.
- **Long AI jobs:** Inngest retries, partial progress, recoverable failures — already configured with retries: 3.
- **Storage access:** All buckets private, signed URLs only.
- **RTL bugs:** Arabic direction, alignment, font fallback must be in JSON schema from day one.

---

## Deploy Flow

**Local development:**
```bash
# Terminal 1
npm run dev

# Terminal 2
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

**Deploy to production:**
```bash
git checkout dev
git add .
git commit -m "feat: description"
git push origin dev
# Open PR dev → main on GitHub → CodeRabbit reviews → merge

ssh root@178.105.88.35
cd /root/taqreer
git pull
pm2 restart taqreer
```

---

## MVP Success Criteria

The MVP is complete when a user can:
1. Sign up with email or Google OAuth
2. Open dashboard with real data
3. Start create flow — upload content, set brand (with custom fonts), review AI summary
4. Claude generates slide JSON — slides appear one by one via Supabase Realtime
5. Preview window opens — user browses slides rendered as HTML/CSS with Arabic + custom fonts
6. User marks an area, adds a comment → Claude updates JSON → preview re-renders
7. User exports as PPTX (PptxGenJS) or PDF (Puppeteer)
8. User saves the deck as a template — JSON saved, thumbnails captured, PPTX generated
