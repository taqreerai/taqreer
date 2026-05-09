# Taqreer — Claude Code Project Brief

## Coding Rules

- **Always use Tailwind utility classes for styling.** Never write raw CSS properties (e.g. `backdrop-filter`, `background`, `border`) in custom CSS classes or inline styles when a Tailwind class exists. Tailwind v4 uses a CSS variable chain for composable utilities (e.g. `backdrop-blur-*`, `bg-*`, `border-*`) — using raw CSS overrides that chain and breaks the output.
- Use `globals.css` only for things Tailwind cannot express: complex animations (`@keyframes`), pseudo-element tricks, and semantic component classes (`.card-dark`, `.btn-gradient`) that combine many utilities into a reusable pattern.

---

You are building **Taqreer** (taqreer.ai), an AI-powered Arabic presentation platform. Claude generates PowerPoint presentations from user content and brand assets. Users edit the result in a native Taqreer web editor, then export as PPTX or PDF.

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
- **Supabase Auth & Storage (Phase 1–4 complete)** — see Progress section below

---

## Current Progress (last session: 2026-05-10)

### ✅ Step 1 — Supabase Auth & Storage (complete — all pushed to main)

**Auth files in place:**
- `lib/supabase/client.ts` — browser client
- `lib/supabase/server.ts` — server client (fixed TypeScript inference on `setAll`)
- `lib/supabase/middleware.ts` — middleware client for session refresh
- `middleware.ts` — protects `/dashboard`, `/projects`, `/editor`, `/create`, `/enhance`, `/settings`, `/brand-kits`, `/folders`. Rewrites `/` → `/preview` on localhost in development.
- `app/(auth)/layout.tsx` — RTL centered auth shell
- `app/(auth)/AuthAnimations.tsx` — Framer Motion `AnimatePresence` wrapper for auth pages
- `app/(auth)/auth/login/page.tsx` — email + Google OAuth, Arabic error messages, `?deleted=true` success banner
- `app/(auth)/auth/signup/page.tsx` — name + email + password + Google OAuth, handles session-returned-immediately (no email confirmation)
- `app/(auth)/auth/forgot-password/page.tsx` — password reset request
- `app/(auth)/auth/callback/route.ts` — OAuth code exchange + user sync → always redirects to `/auth/confirmed`
- `app/(auth)/auth/confirmed/page.tsx` — animated SVG checkmark, auto-redirects to `/dashboard` after 2500 ms
- `app/api/auth/user-sync/route.ts` — upserts Supabase user into PostgreSQL `users` table
- `app/api/auth/delete-account/route.ts` — deletes all user data in FK-safe order then calls `auth.admin.deleteUser()`
- `hooks/useUser.ts` — returns `avatarUrl`, `name`, `email` from Supabase user_metadata with auth-state subscription
- `scripts/setup-storage.ts` — creates 5 storage buckets (**NOT YET RUN**)

**All auth pages have:** Framer Motion staggered fade-up animations, Arabic error messages mapped from Supabase errors, RTL layout, consistent link styles.

### 🔜 Remaining for Step 1

1. **Configure Supabase Console** — register OAuth redirect URLs:
   - `http://localhost:3000/auth/callback` (local)
   - `https://taqreer.ai/auth/callback` (prod)
2. **Run storage setup script:**
   ```bash
   npx ts-node scripts/setup-storage.ts
   ```
3. **Password reset email delivery** via Resend — forgot-password calls Supabase but Supabase needs an SMTP provider configured.

### ✅ Dashboard & Settings UI Polish (complete — pushed to main)

**Sidebar (`components/app/Sidebar.tsx`):**
- Collapsible with saved state in `localStorage`
- Profile popup via `ReactDOM.createPortal` — always renders above trigger button using `getBoundingClientRect()`. Fixed positioning: `bottom: window.innerHeight - rect.top`. When collapsed → popup appears to the left; when expanded → popup appears above.
- No hover background on profile avatar button
- Usage section divider hidden when collapsed (transitions with `opacity-0 h-0`)
- Active nav item: solid `#370BF4` background, white icon — `nav-active` class, no `border-r-2`
- All nav item hovers unified: `hover:bg-white/5`
- Icons use `font-thin` (Material Symbols weight 100) throughout
- Collapsed sidebar tooltips via `.sidebar-tooltip` class

**QuickActions (`components/app/QuickActions.tsx`):**
- 4 cards using `plan-banner` class (gradient bg, purple border, blur)
- Icon right-aligned (`dir="rtl"` on card + `<div className="text-right">` wrapper)
- Heading `text-[20px] font-bold`, description in muted color
- `hover:scale-[1.02] transition-transform` — no color or border changes on hover
- Radial glow orb in top-right of each card

**Settings page (`app/(app)/settings/page.tsx`):**
- Wrapped in `.page-container` (no extra padding — DashboardShell owns outer spacing)
- Full-width `PlanUsage` banner at top
- 2-column grid: Profile | تغيير كلمة المرور / حذف الحساب | إعدادات إضافية (مقبلاً badge)
- Delete modal: Framer Motion scale+fade, `backdrop-blur-sm`, calls `/api/auth/delete-account`, redirects to `/auth/login?deleted=true`

**All app pages** use `<div className="page-container">` — consistent RTL direction, no extra padding.

**globals.css — removed dead classes:** `.btn-primary`, `.btn-ghost`, `.action-btn-{blue/magenta/lavender/violet}`, `.sidebar-action-{blue/magenta/lavender/violet}`, `.sidebar-logo`, `.avatar-ring`

**Active semantic classes in globals.css:**
`page-container`, `settings-card`, `settings-card-title`, `settings-divider`, `input-dark`, `btn-danger`, `btn-gradient`, `btn-outline-dark`, `sidebar-bg`, `nav-active`, `nav-item`, `header-bg`, `progress-track`, `progress-bar`, `badge-purple`, `plan-banner`, `divider-dark`, `dashboard-bg`, `nav-icon`, `card-dark`, `glass-card`, `glow-effect`, `feature-card-glow`, `glow-orb`, `glow-orb-blue`, `glow-orb-violet`, `glow-orb-magenta`, `sidebar-tooltip`, `sidebar-usage`, `template-thumbnail`, `template-overlay`, `hide-scrollbar`, `text-muted`, `btn-icon`, `input-search`

### 🔜 Next — Step 2: Inngest Background Jobs

### Required env vars (already in `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
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
Claude generates or rebuilds PPTX + Taqreer JSON manifest
        ↓
Taqreer opens the JSON in the editor
        ↓
User edits manually or adds AI comments
        ↓
Claude regenerates selected slides when needed
        ↓
Taqreer exports final PPTX / PDF
```

### Layer Ownership

| Layer | Owns |
|---|---|
| Claude | Initial deck creation, enhancement, redesign, slide regeneration |
| Taqreer | Projects, editor, templates, versions, comments, storage, quotas |
| Supabase | Auth (email + Google OAuth) and file storage |
| Inngest | Durable background jobs for AI and export pipelines |
| PostgreSQL | Core relational application data |
| Stripe | Plans, subscriptions, quotas, billing |

---

## Final Stack

| Area | Decision |
|---|---|
| Hosting | Hetzner CPX22 — already running |
| Frontend | Next.js 16, RTL-first — already running |
| Database | PostgreSQL + Prisma — already running |
| Cache | Redis — already running |
| Auth | Supabase Auth — email + Google OAuth |
| Storage | Supabase Storage buckets |
| Background jobs | Inngest (replaces BullMQ) |
| Error monitoring | Sentry |
| Analytics | PostHog |
| AI | Anthropic Claude API |
| Payments | Stripe |

---

## Build Order (What To Build Next)

### 1. Supabase Auth and Storage

**Auth scope:**
- Email signup and login
- Google OAuth
- Password reset
- Protected dashboard routes
- User session middleware
- User profile sync into PostgreSQL users table
- Plan and quota association

**Storage buckets to create:**

| Bucket | Purpose | Access |
|---|---|---|
| source-files | User-uploaded PDFs, PPTX, content | Private |
| brand-assets | Logos, brand guidelines, reference images | Private |
| generated-presentations | Claude-generated PPTX and exports | Private, signed URLs |
| slide-previews | Rendered slide thumbnails | Private, signed URLs |
| template-assets | Template thumbnails, preview decks | Public for official, private for user |

Keep all file access private by default. Always use signed URLs for downloads, previews, and Claude job inputs.

---

### 2. Inngest Background Jobs

Replace any BullMQ direction with Inngest functions.

| Function | Trigger | Output |
|---|---|---|
| project.create.started | User submits create flow | Project created, files attached, generation queued |
| brand.analyze.requested | Brand files uploaded | Brand kit JSON |
| deck.generate.requested | User approves create inputs | PPTX + Taqreer JSON |
| deck.enhance.requested | User uploads PPTX for enhancement | Rebuilt PPTX + JSON |
| deck.preview.requested | New PPTX or JSON version exists | Slide thumbnails |
| slide.regenerate.requested | User sends AI comment | Updated slide JSON |
| deck.export.requested | User clicks export | PPTX/PDF signed URL |

Job status lifecycle: `queued → running → needs_review → completed` or `queued → running → failed → retryable`

---

### 3. Sentry and PostHog

Add before the create flow is built. Track:

**Sentry:** server errors, client errors, failed uploads, failed generation jobs, export failures, API route issues.

**PostHog events to track:**
`signup_completed`, `login_completed`, `project_created`, `content_uploaded`, `brand_uploaded`, `template_browsed`, `template_previewed`, `template_selected`, `generation_started`, `generation_completed`, `editor_opened`, `comment_added`, `regeneration_started`, `export_clicked`, `payment_started`

---

### 4. Auth Pages

Build in Arabic RTL matching the existing design system:
- Login page
- Signup page
- Password reset page
- Google OAuth button
- Redirect to dashboard after auth
- Redirect unauthenticated users to login
- After login redirect to originally requested page (important for template → login → template flow)

---

### 5. Connect Dashboard to Real Data

Replace all static/mock data in the existing dashboard components with real database queries:
- RecentProjects — query projects table for current user
- MyTemplates — query templates table for current user
- PlanUsage — query subscriptions and usage_events for current user
- QuickActions — wire to real create/enhance flow routes

---

### 6. Create Flow

Steps:
1. User clicks إنشاء from dashboard
2. Add content — paste text or upload PDF, DOCX, TXT, images
3. Add brand — upload logo, guidelines, or choose existing brand kit
4. Set deck rules — language (AR/EN), RTL/LTR, slide count, tone, template choice, output purpose
5. Trigger Inngest `deck.generate.requested` job
6. Show job progress screen
7. On completion, open editor with generated JSON

---

### 7. Enhance Flow

Steps:
1. User uploads existing PPTX
2. Choose mode: mimic another PPT style or enhance with brand guidelines
3. Upload reference PPT or brand assets, or select brand kit
4. Trigger Inngest `deck.enhance.requested` job
5. Claude rebuilds deck into Taqreer-compatible PPTX + JSON
6. Editor opens with rebuilt result

---

### 8. Taqreer Editor

The editor renders Taqreer JSON as editable slides. It does not edit PPTX directly.

```
Claude-generated PPTX + JSON
        ↓
Taqreer renders editable JSON in the browser
        ↓
User edits text, images, shapes, layout
        ↓
Taqreer saves JSON versions
        ↓
Taqreer exports final PPTX / PDF
```

**MVP editor features:**
- Slide thumbnails panel
- Editable 16:9 canvas (1920×1080 coordinate system)
- Select, move, resize elements
- Edit text inline
- Change color and font size
- Replace images
- Add text and simple shapes
- Duplicate, delete, reorder slides
- Slide comments and region comments
- Regenerate selected slide via Claude
- Undo / redo
- Autosave
- Export button

**Delay from MVP:** animations, transitions, SmartArt, complex charts, video embeds, real-time collaboration, perfect PPTX import.

---

### 9. Templates Page

**Two surfaces:**
- Public browse page — no login required, anyone can browse
- Dashboard templates tab — saved, recently used, and user-created templates

**Filters:**
- Category: Business, Education, Pitch, Report, Marketing, Portfolio, Government
- Language: Arabic, English, Bilingual
- Industry: Finance, Healthcare, Tech, Real Estate, Retail, NGO, General
- Featured hero section at top (manually flagged by Taqreer team)

**How templates work — style contracts, not content clones:**

When a user clicks "Use Template", Claude receives the template's layout system and color palette as a style contract and generates a new deck around the user's content. The template's slides are not cloned.

```
User selects template
        ↓
Taqreer reads template JSON manifest
        ↓
Extracts: layout grid, color tokens, font rules, slide structure, RTL/LTR direction
        ↓
User adds their content (text, PDF, brand assets)
        ↓
Taqreer passes template style contract + content brief to Claude
        ↓
Claude generates new PPTX + Taqreer JSON using the template's visual system
        ↓
Editor opens with the branded result
```

**Template style contract schema:**
```json
{
  "templateId": "template_corporate_ar_01",
  "meta": {
    "title": "Corporate Arabic Deck",
    "language": "ar",
    "direction": "rtl",
    "category": "Business",
    "industry": "Finance",
    "featured": true
  },
  "styleContract": {
    "palette": {
      "primary": "#370BF4",
      "secondary": "#E036B8",
      "background": "#03030D",
      "surface": "#0F0B1E",
      "text": "#FFFFFF",
      "muted": "#9A94A8"
    },
    "typography": {
      "headingFont": "Cairo",
      "bodyFont": "Cairo",
      "headingSize": 48,
      "bodySize": 22,
      "lineHeight": 1.5
    },
    "layout": {
      "slideSize": { "width": 1920, "height": 1080 },
      "contentPadding": 80,
      "gridColumns": 12
    },
    "slideStructure": [
      { "role": "cover", "elements": ["headline", "subtitle", "logo", "bg_shape"] },
      { "role": "agenda", "elements": ["section_title", "list"] },
      { "role": "content", "elements": ["title", "body", "image"] },
      { "role": "stats", "elements": ["title", "stat_block_x3"] },
      { "role": "closing", "elements": ["headline", "cta", "logo"] }
    ]
  }
}
```

**Template card shows:** thumbnail, name, category badge, language badge, slide count, industry tag, Preview button, Use Template button.

**Preview modal:** all slide thumbnails, color palette, font names — before committing to a template.

**Login redirect:** if user clicks "Use Template" while unauthenticated, redirect to login with `?template=template_id` in the query param so they return to the correct template after auth.

**Plan gating:** free plan gets general templates only. Plus and Pro unlock industry-specific, bilingual, and premium templates. Premium templates show a lock badge on the public page.

**Dashboard templates tab sections:**
- My Templates — presentations saved as templates from the editor
- Recently Used — templates used as a base, sorted by last used

**Taqreer team workflow for creating templates:**
1. Build presentation inside Taqreer editor
2. Fill in style contract metadata
3. Trigger preview render job → stores thumbnails in template-assets bucket
4. Set category, industry, language, plan gating, featured flag
5. Publish to public page

---

### 10. Stripe Payments

Build after create flow, enhance flow, and editor are working.

| Plan | Limits | Features |
|---|---|---|
| Free | 10 slides, daily quota, limited exports | Create, basic editor, general templates |
| Plus | Up to 60 slides, larger uploads | Brand kits, PDF export, more templates |
| Pro | Up to 90 slides, priority jobs | Advanced regeneration, save templates, premium templates |

**Requirements:** Stripe customer creation, checkout session, billing portal, webhook handler, subscription sync, plan limits middleware, usage events, upgrade/downgrade anytime.

---

## Database Schema

| Table | Purpose | Key Fields |
|---|---|---|
| users | Synced from Supabase Auth | id, supabase_user_id, email, name, avatar_url, plan |
| projects | Project container | id, user_id, title, type, status, created_at |
| presentations | Current presentation record | id, project_id, current_version_id, title, language, direction |
| presentation_versions | Version history | id, presentation_id, version_number, pptx_url, json_data, preview_status |
| files | Uploaded and generated files | id, project_id, type, storage_url, mime_type, metadata |
| brand_kits | Reusable brand systems | id, user_id, name, json_data, asset_urls |
| comments | AI and user comments | id, version_id, slide_id, element_id, region_json, content, status |
| jobs | Inngest job tracking | id, inngest_run_id, type, status, input_json, output_json |
| templates | Premade and user templates | id, owner_id, title, category, industry, language, direction, featured, slide_count, style_contract, pptx_url, thumbnail_url, preview_urls, use_count, is_public, plan_required, created_at |
| subscriptions | Stripe state | id, user_id, stripe_customer_id, plan, status, current_period_end |
| usage_events | Quota tracking | id, user_id, event_type, amount, metadata, created_at |

---

## Claude Generation Pipeline

Claude must output two things every time:
1. `generated.pptx` — the actual PowerPoint file
2. `taqreer_manifest.json` — the editable JSON for the Taqreer editor

**Taqreer-compatible PPTX rules:**
- Use real text boxes for editable text
- Use simple shapes for design blocks
- Use image objects for visuals
- Standard 16:9 size (1920×1080)
- Do not flatten slides into images
- No SmartArt in MVP
- No animations in MVP
- Every editable element must have a stable ID
- Coordinates use 1920×1080 canvas system
- Respect Arabic RTL rules
- Use font fallbacks

**Generation prompt contract:**
```
Generate a PowerPoint presentation and a matching Taqreer editable JSON manifest.

Rules:
- Use simple editable PowerPoint objects.
- Do not flatten slides into full-slide images.
- Every editable object must have a stable ID.
- The JSON manifest must include slide IDs, element IDs, coordinates, dimensions, content, and style.
- Coordinates must use a 1920 × 1080 canvas system.
- For Arabic, use RTL direction and right alignment where appropriate.
- Return the PPTX file and the manifest JSON.
```

---

## Preview and Export

**Preview flow:**
```
PPTX or Taqreer JSON version → render slide previews → store thumbnails in Supabase Storage → show in dashboard and editor
```

**Export flow:**
```
Taqreer JSON current version → convert JSON to PPTX → generate optional PDF → store export file → return signed download URL
```

Even if Claude creates the first PPTX, Taqreer must export from the edited JSON after manual user edits. The final file must reflect the user's latest editor state, not the original Claude output.

---

## Key Risks

- **Claude output mismatch:** Claude may produce a PPTX that does not match the JSON manifest. Add validation and repair steps.
- **Uploaded PPTX import:** Do not attempt perfect PPTX import. Ask Claude to rebuild uploaded decks into a Taqreer-compatible PPTX + JSON.
- **Export fidelity:** The web editor, JSON model, preview renderer, and PPTX exporter must share one coordinate system (1920×1080).
- **Long AI jobs:** Use Inngest retries, job status tracking, partial progress, and recoverable failures.
- **Storage access:** Keep all buckets private and use signed URLs only.
- **RTL bugs:** Arabic direction, alignment, font fallback, and line-height must be in the schema from day one.
- **Critical rule:** Never let Claude output replace production editor data without validation. Validate schema, assets, slide bounds, RTL text, missing files, and version metadata first.

---

## Deploy Flow

**Local development:**
```bash
npm run dev          # runs on localhost:3000
docker compose up -d # PostgreSQL + Redis
```

**Deploy to production:**
```bash
# On Mac
git add .
git commit -m "your message"
git push

# SSH into server
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
3. Start create flow — add content and brand assets
4. Claude generates PPTX + editable JSON
5. Edit the result in the Taqreer editor
6. Add a comment → Claude regenerates that slide
7. Export final deck as PPTX and PDF
