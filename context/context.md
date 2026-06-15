# Taqreer — Status & Handover

Bilingual (Arabic + English) AI presentation platform. The user provides content
+ brand; **Claude designs each slide as HTML**; the browser renders it 1:1; a
patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX.
Decks are generated **and** edited in a full in-canvas studio.

> The 4 living docs: this file (status + handover) ·
> **[architecture.md](architecture.md)** (structured map) ·
> **[deploy.md](deploy.md)** (production runbook) ·
> **[launch-progress.md](launch-progress.md)** (active launch tracker —
> updated as work lands). Change history is the git log.

---

## Status at a glance

| Area | State |
|---|---|
| **LIVE on https://taqreer.ai** (Hetzner, coming-soon gate OFF / public) | ✅ 2026-06-13 |
| HTML-first generation (all 4 flows author `<section>` HTML) | ✅ |
| Flows: **Create / Enhance / Mimic / Datasheet** (+ use-template) | ✅ |
| **In-canvas studio editor** (`/project/[id]`, `DeckView`) — generate ⟶ edit | ✅ |
| Per-slide versioning, comments, AI partial-regen, image align/opacity | ✅ |
| Export: **PPTX · PDF · PNG · HTML** | ✅ |
| Templates · multi-select bulk delete on all library pages | ✅ |
| **Bilingual** `[lang]` (ar/en) · **light/dark** · **blue design system** | ✅ |
| Realtime (private channels, HS256 mint) + notifications | ✅ |
| **Credits + billing (Stripe LIVE)** — ledger, gating, embedded checkout, in-place upgrade modal | ✅ live 2026-06-14 |
| Design-style picker (9 styles, CSS mini-previews) on all 4 flows | ✅ |
| Admin panel | ⏳ read-only v1 planned (Phase C) |

Functionally complete end-to-end including monetization in test mode and a
verified production pipeline (first prod deck generated, thumbnailed, billed
2026-06-13). What separates it from public launch is tracked PHASE BY PHASE in
**[launch-progress.md](launch-progress.md)** — that file is the active
worklist; this one is the stable overview.

---

## Production (summary — full runbook in deploy.md)

- Hetzner CPX22 (`ssh taqreer`), nginx + TLS → pm2 `taqreer-prod` :3100,
  prod app DB on Supabase Pro Postgres (eu-central-1, 2026-06-16), Supabase = auth/storage/realtime
  (same project as dev). Nightly backups. Inngest self-hosted interim.
- **Coming-soon gate**: every page shows coming-soon until
  `/preview?key=taqreer2025` sets the `tq_preview` cookie. Flag lives in the
  server env (`COMING_SOON=1`); launch = remove it + reload.
- **Deploy = `./deploy.sh`**: GIT PUSH-TO-DEPLOY (since 2026-06-14): pushes
  `dev`+`main` to GitHub, then `git push prod dev:main` to the box's bare repo;
  the tracked post-receive hook checks `main` out, runs npm ci + prisma migrate,
  builds into `.next-build`, atomic-swaps to `.next-deploy`, pm2 reload,
  health-checks `/ar`. The pushed `main` SHA is exactly what prod runs.
- **Review policy by size** (user direction 2026-06-13): small fixes deploy
  straight from `dev` (auto-merged to main); big changes go through a
  `dev → main` PR for CodeRabbit BEFORE deploying.

---

## Pricing & credits — locked numbers (code = lib/credits/cost.ts)

Tiers (renamed 2026-06-11; monthly reset, no rollover; Free = one-time grant):

| | **Free $0** | **Plus $15** | **Pro $30** | **Max $70** |
|---|---|---|---|---|
| Credits | 400 once | 2,000/mo | 5,000/mo | 12,000/mo |
| Slide cap | 10 | 30 | 60 | 75 (system cap) |
| Presets | opus-fast | + opus-balanced | + fable-low | all |
| Flows | create only | all 4 | all | all |
| Premium templates | ✗ | ✗ | ✓ | ✓ |
| Processing priority | ✗ | ✗ | ✗ | ✓ |

- Presets (2026-06-12 lineup): **opus-fast** (default, 100+10/slide, ~$0.10
  COGS) · **opus-balanced** (400+22, ~$1.30 measured) · **fable-low**
  (500+28, ~$3.23 measured - PARKED 2026-06-14: Fable is disabled at Anthropic
  upstream, so this preset is non-shippable; keep it out of the live picker
  until/unless re-enabled, and the pricing question is moot for now).
- Ledger: hotel-style hold→settle clamped to hold, FIFO top-up grants (12-mo
  expiry), per-user row lock, idempotent, pointer-only balance broadcasts.
  Sim 30/30 + real-money verified. **Auto-upgrade DISABLED in code.**
- Top-ups are subscriber-only refills (free users see subscribe CTAs).
- **Processing priority** (Max perk, built 2026-06-14): Inngest `priority.run`
  gives `tier == 'max'` generations + regens a +120s scheduling boost under
  queue contention (effective on Inngest Cloud / under load). `tier` is stamped
  on the event at enqueue from the project OWNER's plan (`tierForUser`,
  lib/inngest-helpers). Image quality is identical across tiers (gpt-image-2),
  and the tier feature copy reflects the actual presets.
- Stripe: Checkout Sessions `ui_mode: elements` — our own themed form on
  `/checkout` AND inside the gated-preset **UpgradeModal**
  (`redirect:'if_required'`, payment completes in-modal). Webhook → ledger
  grants. Embedded money admin: `/plans` (change plan + packs), `/billing`
  (cancel/resume + payment methods), `/invoices`. The Stripe-hosted portal is
  deleted.

Launch blockers for billing (Phase B): live keys + products + prod webhook DONE
(2026-06-14, Stripe LIVE); remaining: mada + Apple Pay, real-card smoke,
premium-template gating. VAT decision (2026-06-14, revised): STAY
ON STRIPE. DEFER VAT while there are no real sales (zero exposure); when revenue is
real, enable Stripe Tax (auto calc/collect/file) and register where required
(non-resident KSA/UAE/EU/US states) as the seller of record, keeping our own
Elements checkout. A Merchant of Record (Paddle / Stripe Managed Payments / Lemon
Squeezy) was considered and shelved as a fallback only if direct VAT compliance
later proves too burdensome (an MoR shifts the liability off us but replaces the
checkout surface + costs ~5%+ vs 2.9%). Not a launch blocker.

---

## Admin panel (deferred to Phase C — read-only v1)

Decisions (2026-06-09/13): read-only first (users, subscriptions/tier, revenue,
generations + failures, signups), server-side role gating (`User.role` exists),
actions stay psql + Stripe dashboard for the first weeks, no presence ("online
now") — PostHog live view covers it. Head start already in code: `User.role`,
Notification fan-out, `UsageEvent`, token telemetry on Job.

---

## How the studio works

`/project/[id]` (`DeckView`) is one surface for **both** generation and editing —
the generating shell (disabled, streaming) transitions seamlessly into the
editor (enabled), no remount. In the editor:
- **Manual edits** in-canvas: text + style via `StylePill`/`MorePopover`/
  `FontControl` (incl. 6-way image align + opacity), layer reorder in
  `LayersPanel`, slide reorder in `SlideNavSidebar`. Edits are an **in-place
  content save** (no new version); the toolbox save icon reflects dirty state.
- **AI path**: full regenerate or per-slide partial regen (a comment flagged
  `forAi`); restore from per-slide history.
- Undo/redo is a client stack (toolbar order forced back-left/forward-right);
  ⌘Z / ⌘⇧Z work from inside the editor iframe (`SlideEditor` forwards them to the
  local stack). History = checkpoints on Save + 10-min idle.
- Both floating rails (Slides right, Layers left) are **collapsible** (bare
  edge-arrow toggles, auto-collapse <1280px), fixed to one page band
  `[RAIL_TOP, vh-RAIL_BOTTOM]` so they're equal-height + centered; the canvas is
  width-capped (`CANVAS_MAX_WIDTH` 1280px) so it can't balloon into the header.
- Realtime events drive **in-place state updates, never `router.refresh`**
  (deletes call `router.refresh` to invalidate the stale-RSC Router Cache).
- Header strip = full-width `TopUtilityBar` with avatar (dashboard replica),
  tier pill, bell, export/share opening downward.

---

## Conventions & non-negotiables

- **`dev` is the only working branch.** Never `git checkout -b`. Review by
  size: small fixes deploy directly; big changes PR `dev → main` for
  CodeRabbit first. `deploy.sh` refuses a dirty tree.
- **Design discipline**: never hardcode visuals — tokens / add a class to
  `app/globals.css` first; read the globals.css legend before any visual change;
  reuse existing primitives. Flat system, **one blue accent**.
- **Bilingual**: translate **and** mirror direction (logical CSS only);
  `stripLocale()` before any pathname check; `localizedHref`/`switchLocaleHref`
  for internal nav; **Latin numerals only**; **no em dash** in copy.
- **Both themes**: verify visuals in light *and* dark.
- **Realtime → in-place state**, never `router.refresh`.
- **Don't reintroduce coordinate math** — the browser does layout.
- **`dom-to-pptx` / `bidi-postprocess`** are patched via patch-package; changes
  run through the export spike first.
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits,
  schema changes, or Inngest prompt-pipeline edits.
- Deck HTML lives in TWO stores (PresentationVersion = viewer; SlideVersion =
  per-slide history) — manual repairs must patch both.

---

## Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop
npm install                  # postinstall auto-applies the dom-to-pptx patch

# .env.local (from the team). Required:
#   DATABASE_URL=postgresql://taqreer_user:...@localhost:5432/taqreer   # docker, NOT supabase
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY=...
#   INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY=...   (+ INNGEST_DEV=1)
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY=...            (Cloudflare Turnstile; secret lives in the Supabase Auth dashboard, NEXT_PUBLIC_ so inlined at build)

docker compose up -d         # postgres 16 + redis 7
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost
npm run dev                  # Next.js :3000
npx inngest-cli@latest dev   # Inngest dev server :8288
```

---

*Living document — current state, not a changelog. History is the git log.
Superseded docs (subscriptionmodel, billing-plan, admin-panel-plan) were folded
into this file + launch-progress.md on 2026-06-13; recover full text from git
history if ever needed.*
