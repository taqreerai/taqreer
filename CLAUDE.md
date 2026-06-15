# Taqreer — Session Init

Bilingual (Arabic + English) AI presentation platform. The user provides content
+ brand; **Claude designs each slide as HTML**; the browser renders it 1:1; a
patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX.
Decks are generated **and** edited in a full in-canvas studio. **RTL/BiDi quality
is the product differentiator.**

**LIVE on https://taqreer.ai** (Hetzner) since 2026-06-13. As of 2026-06-14: the
coming-soon gate is **OFF** (site public, new registrations disabled as the
interim guard), **Stripe billing is LIVE**, and the live prod work-tree is
**`/root/taqreer`** (renamed from `/root/taqreer-app`). This file is the merged
session-init brief; the four living docs hold the depth and are kept current:
- **[context/context.md](context/context.md)** — status + handover + pricing
- **[context/architecture.md](context/architecture.md)** — full structured map
- **[context/deploy.md](context/deploy.md)** — production runbook + gotcha log
- **[context/launch-progress.md](context/launch-progress.md)** — active launch tracker

> ⚠️ **Next.js 16 + Turbopack** — APIs/conventions differ from older Next.js.
> When unsure, read `node_modules/next/dist/docs/` before writing code.

---

## ‼️ Non-negotiable conventions (read first)

- **`dev` is the ONLY working branch.** Never `git checkout -b`. **Review by
  size**: small fixes deploy straight from `dev` (`./deploy.sh` auto-pushes
  `dev`+`main`); big changes (schema, webhooks, features) get a `dev → main` PR
  for CodeRabbit BEFORE deploying. `deploy.sh` refuses a dirty tree.
- **Ask before any edit that wasn't explicitly requested.** Exploratory
  questions ("do we have X?") are NOT edit requests. Diagnose → propose → wait
  for the go. Discuss before coding non-trivial work.
- **No em dash** anywhere (copy, comments, commits, PRs, generated HTML) —
  comma / colon / middot / hyphen instead. Avoid the en dash too.
- **Latin numerals only (0-9)** in user-facing copy, even inside Arabic strings.
- **Bilingual = translate AND mirror direction** in the same pass. Logical CSS
  only (`start`/`end`, `ms`/`me`, `text-start`, `inset-inline-*`) — never
  physical `left`/`right`/`ml`. `stripLocale(pathname)` before ANY pathname
  check (live path is `/ar/dashboard`). Internal links via `localizedHref`;
  locale switches via `switchLocaleHref`.
- **Design discipline** (user has flagged 3+ times): never hardcode visuals —
  use tokens / add a class to [app/globals.css](app/globals.css) first; read the
  globals.css legend before any visual change; reuse existing primitives (survey
  before building any new modal/pattern). Flat system, **one blue accent**.
- **Verify visuals in BOTH light and dark** (flip and compare).
- **Realtime → in-place state updates, never `router.refresh`** (router.refresh
  only on user-initiated actions like Retry).
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits,
  schema changes, or Inngest prompt-pipeline edits. Skip for pure CSS / comments.
- **Deck HTML lives in TWO stores** — `PresentationVersion.slideJson` (what the
  viewer reads) and `SlideVersion.slideJson` (per-slide history). Manual DB
  repairs must patch BOTH.
- **Don't reintroduce coordinate math** — the HTML pivot deleted bbox/RTL
  coordinate mirroring; the browser does layout.
- **`dom-to-pptx` / `bidi-postprocess`** are patched via patch-package; changes
  run through the export spike first.
- Use **playwright / code-simplifier / security-guidance / frontend-design**
  plugins by default (browser-verify, simplify-pass, security warnings, design
  thinking) — but stay inside Taqreer's existing tokens + primitives.

---

## Production & deploy

- **Box**: Hetzner CPX22, Ubuntu 24.04, `ssh taqreer` (root@178.105.88.35, key
  `~/.ssh/taqreer_hetzner`, password login OFF). macOS ssh REQUIRES
  `IPQoS none` in `~/.ssh/config` (the network drops DSCP-marked packets).
- **Stack on the box**: nginx 443 + Let's Encrypt → pm2 `taqreer-prod` (`next
  start` :3100, serves `.next-deploy` via `NEXT_DIST_DIR`) + pm2
  `taqreer-inngest` (self-hosted inngest dev server :8288, INTERIM until Inngest
  Cloud). **App DB = Supabase Pro Postgres** (eu-central-1, session pooler)
  since 2026-06-16; RLS on every public table (app bypasses it as table owner).
  Old server-local Postgres 16 kept STOPPED as a cold rollback standby.
- **Supabase** = auth + storage + realtime + **the prod app DB** (Postgres,
  2026-06-16). The SAME Supabase project serves dev and prod (logins + image
  URLs shared); dev's app DB stays local docker, only prod moved to Supabase.
- **Secrets** live ONLY in `/root/taqreer/.env` (chmod 600) — gitignored +
  untracked, so `git checkout` on the box never touches them. Includes prod
  `DATABASE_URL`, `COMING_SOON=1`, `COMING_SOON_KEY`, `NEXT_DIST_DIR`,
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public site key, inlined at build; the
  Turnstile SECRET lives in the Supabase Auth dashboard, NOT here), Stripe/Sentry/etc.
- **Deploy = `./deploy.sh`** (GIT PUSH-TO-DEPLOY since 2026-06-14, replaced
  rsync): pushes `dev`+`main` to GitHub, then `git push prod dev:main` to the
  box's bare repo (`taqreer:/root/taqreer-app.git`). The tracked `post-receive`
  hook (`scripts/post-receive.sh`) checks main out into the live work-tree,
  `npm ci` + `prisma migrate deploy`, builds into `.next-build`, ATOMIC-swaps to
  `.next-deploy`, pm2 reloads, health-checks `/ar` (expect 200). Build runs ON
  the server (6GB swap); the pushed `main` SHA is exactly what prod runs.
  `--force` skips the dirty-tree guard; `--rebuild` re-runs the hook on current
  main with no new commit (e.g. after an `.env` change).
- **Coming-soon gate** (proxy.ts): `COMING_SOON=1` rewrites every page to
  `/{lang}/coming-soon` unless the `tq_preview` cookie is set;
  `https://taqreer.ai/preview?key=taqreer2025` sets it (30 days). API routes
  never gated. **CURRENTLY OFF** (`COMING_SOON=0`, 2026-06-14): site is public,
  new registrations disabled as the interim guard (verify the Supabase signups
  toggle is OFF). Re-enable: `COMING_SOON=1` + `./deploy.sh --rebuild`.
- **Monitoring**: Sentry wired (org `taqreerai-66`, project `taqreer`), v10
  layout (`instrumentation.ts` + `instrumentation-client.ts`), env-tagged,
  replay masked. `SENTRY_AUTH_TOKEN` in the server .env → source maps upload on
  every deploy (readable stack traces). sendDefaultPii + Replay ON (revisit in
  Phase B legal).

---

## Stack & architecture (full map: context/architecture.md)

- **Next.js 16 App Router** (Turbopack), React 18/19, TS `strict`. **Tailwind v4
  CSS-first** — theme in `@theme` blocks inside globals.css (no tailwind.config).
- **Data**: Prisma → Postgres (dev docker `localhost:5432`, prod **Supabase Pro**, eu-central-1 session pooler).
  **Generation**: Anthropic Claude (Opus 4.8 default) streams `<section>` HTML
  via **Inngest** jobs; gpt-image-2 for images.
- **Edge gate**: [proxy.ts](proxy.ts) — locale-prefix redirect → coming-soon
  gate → Supabase session refresh. Skips `/api` + static files.
- **Routes** (`app/[lang]/`, lang ∈ {ar,en}): `/` landing · `(auth)/{login,
  signup,forgot-password,reset-password}` · `(app)/{dashboard,projects,
  favorites,templates,library,brand-kits,settings}` · billing surfaces
  `/plans` (change plan + packs) · `/billing` (cancel/resume + payment methods)
  · `/invoices` · `/checkout` (our Elements form) · 4 flows `/create /enhance
  /mimic /datasheet` (+ `/use-template/[id]`) · **`/project/[id]` = unified
  studio (generate AND edit, `DeckView`)** · `/coming-soon` · **`/brand`** (live
  design-system reference, replaces the deleted static brand-guidelines.html).
  **Auth** = 2-phase signup (email ⟶ name+password + live password checklist) +
  Cloudflare Turnstile captcha on signup/login/forgot; wordmark at page bottom.
- **i18n** = TWO independent direction axes: **chrome dir** (UI locale,
  `<html dir>`) vs **canvas dir** (deck `manifest.direction` — an Arabic user
  can edit an English deck). Dictionaries `dictionaries/{ar,en}.json` (~895
  keys, en is the reference shape; must stay key-parity). `useDict()` +
  `useLocale()` client-side.
- **Theming**: `.light` class on `<html>` flips tokens; `tq_theme` cookie read
  SSR (no flash). Dark is primary; light is shadcn-neutral.
- **Design system** (flat, blue): single source = globals.css header legend.
  **One blue accent** — token named `--tq-purple` (legacy name) resolves to blue
  (dark `#3380FF` / light `#0057FF`); all aliases point at it. No purple/magenta
  except file-type export icon tints. Surfaces opaque + hairline borders, no
  blur/shadow. Typeface **Cairo only, weights 400-700**. Utilities: `.btn-pill`,
  `.btn-gradient` (solid blue CTA), `.btn-gradient-anim` (AI mesh),
  `.surface-card/-popover/-menu/-modal`, `.badge-purple`, `.bg-overlay-*`,
  `.tq-content-panel`. Brand spec: **`/ar/brand`** (live design-system route,
  `app/[lang]/brand/page.tsx` - imports globals.css so it is a true replica).
- **Studio** (`DeckView`): generating shell (disabled, streaming) ⟶ seamless ⟶
  editor (enabled), no remount. Manual edits = in-place content save (no new
  version); AI path = full regen or per-slide partial regen (comment flagged
  `forAi`); undo/redo = client stack; history = Save + 10-min checkpoints.
- **Backend**: `User → Project → Presentation (1:1) → PresentationVersion
  (slideJson=manifest) / SlideState → SlideVersion`. Inngest: `deck-generate`
  (hold → stream → `lib/deck/scaffold` scopes CSS under `.tq-canvas` + mirrors
  `data-role` into the section class → settle → thumbnails),
  `deck-regenerate-partial`, `credits-maintenance` (daily), `thumbnail-render`
  (Puppeteer→WebP — needs Chrome system libs, see deploy.md gotcha), etc.
  Access: Supabase JWT → Prisma User, `resolveProjectAccess` owner>edit>comment
  >view. Realtime: private `project:{id}` + `user:{uid}` channels, HS256-minted
  token with `topics` claim.

---

## Pricing & credits (locked — code = lib/credits/cost.ts)

| | Free $0 | Plus $15 | Pro $30 | Max $70 |
|---|---|---|---|---|
| Credits | 400 once | 2,000/mo | 5,000/mo | 12,000/mo |
| Slide cap | 10 | 30 | 60 | 75 (system cap) |
| Presets | opus-fast | +opus-balanced | +fable-low | all |
| Flows | create only | all 4 | all | all |

- Presets: **opus-fast** (default, 100+10/slide, ~$0.10) · **opus-balanced**
  (400+22, ~$1.30) · **fable-low** (500+28, ~$3.23 - PARKED: Fable is disabled at
  Anthropic upstream, so fable-low is non-shippable; keep it out of the live
  picker until/unless re-enabled).
- Ledger: hotel-style hold→settle clamped to hold, FIFO 12-mo top-ups, per-user
  row lock, idempotent. **Auto-upgrade DISABLED in code.** Sim 30/30 + real-money
  verified. Top-ups are subscriber-only.
- Stripe: Checkout Sessions `ui_mode: elements` (our themed form on `/checkout`
  AND inside the gated-preset `UpgradeModal`, `redirect:'if_required'`). Webhook
  → ledger grants. Subscription cadence (monthly/yearly) persisted + shown on the
  shared `PlanUsage` plan card. **LIVE mode (2026-06-14)** - live keys + products
  + prod webhook ("Taqreer prod", 6 events) done; remaining: mada/Apple Pay,
  real-card smoke test, premium-template gating.

---

## Current launch status (live tracker: context/launch-progress.md)

**Phase A (foundation) — essentially done**: site live + coming-soon gate, dev
data migrated to prod, nightly backups, prod generation verified, Sentry wired,
Supabase redirect URLs set, nginx 502 fixed (proxy buffer for big Supabase
cookies). 2026-06-14: prod app dir renamed to `/root/taqreer`, prod DB cleaned +
wiped to `dev@taqreer.ai` only, Stripe went live (see launch-progress Latest
session). **Remaining**: uptime ping.
(Inngest Cloud DEFERRED until there's traffic - the self-hosted dev server is
fine at zero volume.)

**Phase B (money + law)**: Stripe LIVE keys + products + prod webhook DONE
(2026-06-14); remaining = mada/Apple Pay + real-card smoke + premium-template
gating (the upsell modal is now in-place, PR #62). VAT = STAY ON STRIPE
(decision 2026-06-14, revised) - DEFER while no real sales, then enable Stripe Tax
(calc/collect/file) + register where required as the seller of record, keeping our
own checkout. MoR (Paddle / Stripe Managed Payments) shelved as a fallback only if
direct VAT compliance later proves too burdensome; not a blocker;
legal pages (ToS/Privacy/Refund, bilingual + cookie banner — none exist yet);
email deliverability (SPF/DKIM/DMARC + branded bilingual Supabase auth
templates). **Phase C (hardening)**: rate limiting (NONE exists — share-invite
email is a spam vector), Inngest concurrency caps, admin panel v1 (read-only,
role-gated). **Phase D (cheap polish)**: SEO correctness (stale sitemap/robots,
hreflang, OG), mobile audit of the 5 public surfaces, PostHog, support mailbox.

**Open user actions**: mada/Apple Pay config + a real-card smoke test +
premium-template gating (Stripe live keys + products + webhook DONE 2026-06-14);
verify Supabase signups are OFF; accounts under dev@taqreer.ai (BetterStack,
PostHog); optional Sentry auth token for source maps. (Fable pricing PARKED -
disabled at Anthropic upstream. Legal counsel review DONE.)

---

## Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop
npm install                  # postinstall auto-applies the dom-to-pptx patch
docker compose up -d         # postgres 16 + redis 7
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost
npm run dev                  # Next.js :3000
npx inngest-cli@latest dev   # Inngest dev server :8288
```
`.env.local` (from the team) needs: `DATABASE_URL` (docker localhost, NOT
supabase), `ANTHROPIC_API_KEY`, the `NEXT_PUBLIC_SUPABASE_*` + service-role keys,
`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` (+ `INNGEST_DEV=1`), Stripe + Sentry.

**Everyday commands** (there is NO test runner — don't hunt for one):
- `npm run dev` → `next dev` :3000 via scripts/dev.mjs, which deletes an empty
  shell `ANTHROPIC_API_KEY` so .env.local wins. `npm run build` · `npm start`.
- `npm run lint` → `eslint .` (flat config eslint.config.mjs; `set-state-in-effect`
  is enforced as an error).
- Prisma: `npx prisma generate` after schema edits · `npx prisma migrate dev
  --name x` to author a local migration (`migrate deploy` only applies existing
  ones) · `npx prisma studio`. Restart the dev server after any schema change
  (stale in-memory client).
- One-off ops run via `tsx scripts/*.ts` against the current `DATABASE_URL`:
  `credit-sim.ts` (ledger sim) · `stripe-setup-products.ts` (`--live` opts into
  live mode) · `wipe-decks.ts` · `rerender-thumbnails.ts` ·
  `cleanup-stale-projects.ts` · `setup-storage.ts` · `build-supabase-emails.ts`.

---

## Gotchas

- Turbopack sometimes serves a stale globals.css chunk after an edit — make a
  second real content change to force a clean recompile.
- `set-state-in-effect` is a lint error here — derive initial state in the
  `useState` initializer, not a mount effect.
- Page scroll is on `<body>` (RTL scrollbar sits left); `scrollbar-gutter:
  stable` required (modals lock `overflow:hidden`).
- Editor iframe reload needs `reloadKey` baked into `srcDoc` (SlideEditor.tsx).
- Prisma CLI: `prisma.config.ts` loads `dotenv/config` so `DATABASE_URL` wins;
  after a schema change restart the dev server (in-memory Prisma client is stale).
