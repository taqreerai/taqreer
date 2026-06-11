# Taqreer — Status & Handover

Bilingual (Arabic + English) AI presentation platform. The user provides content
+ brand; **Claude designs each slide as HTML**; the browser renders it 1:1; a
patched `dom-to-pptx` + custom OOXML post-processor exports a high-fidelity PPTX.
Decks are generated **and** edited in a full in-canvas studio.

> **Structured map** (stack, routes, i18n, theming, design system, components,
> flows, backend): **[context/architecture.md](architecture.md)**. This file is
> the higher-level status + handover. Change history is the git log.

---

## Status at a glance

| Area | State |
|---|---|
| HTML-first generation (all 4 flows author `<section>` HTML) | ✅ |
| Flows: **Create / Enhance / Mimic / Datasheet** (+ use-template) | ✅ |
| **In-canvas studio editor** (`/project/[id]`, `DeckView`) — generate ⟶ edit | ✅ |
| Per-slide versioning, comments, AI partial-regen | ✅ |
| Export: **PPTX · PDF · PNG · HTML** | ✅ |
| Templates (library + use-template flow) | ✅ |
| **Bilingual** `[lang]` (ar/en, chrome dir vs canvas dir) | ✅ |
| **Light / dark themes** (`tq_theme` cookie, no flash) | ✅ |
| **Blue design system** (flat, one accent) + brand guidelines page | ✅ |
| Realtime (project/user channels, **private + HS256 mint**) + notifications | ✅ |
| **Credits + billing (Stripe, test mode)** — ledger, gating, /billing, Elements checkout | ✅ test mode |
| Admin panel | ⏳ planned (spec only) |

The product is functionally complete end-to-end, **including monetization in
Stripe test mode**. What separates it from launch is the live-mode pass (below)
and a few polish items.

---

## Billing & credits — BUILT (test mode, 2026-06-12)

Sources of truth: **[context/subscriptionmodel.md](subscriptionmodel.md)** (LOCKED
tiers Free $0 / Plus $15 / Pro $30 / Max $70 + the credit model) and
**[context/billing-plan.md](billing-plan.md)** (surfaces, journeys, build order).
What exists and is verified:

- **Credit ledger** (`lib/credits/`): CreditAccount + TopupGrant (FIFO, 12-mo
  expiry, survive resets) + CreditHold; hotel-style hold→settle (charge clamped
  to hold), per-user row lock, idempotent by jobKey/sourceKey. Sim-tested 30/30.
- **Wired into the pipeline**: preflight 402 in `POST /api/projects` (reduce-
  slides / cheaper-preset / top-up offers), hold/settle in `deck-generate` +
  `deck-regenerate-partial` (keeps-partial cancel), signup grant with
  anti-farming (gmail normalize + IP velocity), daily `credits-maintenance`
  cron (stuck holds, top-up expiry, monthly drip). Auto-upgrade is DISABLED in
  code (the margin-risk decision stands).
- **Stripe (test mode)**: products/prices by lookup_key with grant metadata,
  webhook → ledger grants (StripeWebhookEvent idempotency, sig-verified raw
  body, 5/5 harness), restricted Customer Portal (cancel / payment method /
  invoices only), Subscription mirror on our DB (webhooks only write it).
- **UI**: `/billing` page (plan summary + dunning, landing-size change-plan
  cards, top-up packs), **`/checkout` = our own Elements payment form**
  (Checkout Sessions `ui_mode: elements`, PaymentElement + currency selector,
  Appearance API themed from live tokens, dark/light reactive, full Arabic),
  `/checkout/return` auto-redirects to dashboard, CreditGateDialog in the 4
  flows, balance in avatar ring + popup + plan banner (one store, live nudge).

**Remaining before launch (the live-mode pass)**:
1. Real paid generation test (hold → real Claude stream → settle) — awaiting
   user go (small Opus spend).
2. Live keys + Stripe Tax (KSA/UAE) + dashboard branding (Background #FFFFFF,
   Button #0057FF — live mode only, sandbox can't set it) + $1 smoke test +
   refund-path check with a real card.
3. Premium-template gating (tiers promise it; nothing enforces it yet).
4. Production webhook endpoint + cron deploy config.

**Admin panel** is spec-only: **[context/admin-panel-plan.md](admin-panel-plan.md)**
(Stripe wiring, PostHog visitor analytics; `User.role` + Notification fan-out +
`UsageEvent` already exist as a head start).

---

## Small open polish items (not major builds)

- **i18n**: enable the `no-literal-string` lint, add hreflang / per-locale OG
  images. (`User.locale` persistence + the string/direction sweep are done.)
- **Realtime**: notifications fan-out is wired — give it an end-to-end cross-tab
  pass before relying on it in prod (local dev can't deliver broadcasts; the
  status poll is the fallback). Billing notification types (credited / payment
  failed / subscription ending) ride the same untested fan-out.
- **Pre-launch**: server-side HTML sanitization for generated decks (see the
  top-of-file TODO in `components/slides/SlideRenderer.tsx`); a couple of
  prompt-level fidelity tweaks (gradient text, contrast).

---

## How the studio works (it's a real editor now)

`/project/[id]` (`DeckView`) is one surface for **both** generation and editing —
the generating shell (disabled, streaming) transitions seamlessly into the editor
(enabled), no remount. In the editor:
- **Manual edits** happen in-canvas: text + style via `StylePill`/`MorePopover`/
  `FontControl`, layer reorder in `LayersPanel`, slide reorder in `SlideNavSidebar`.
  Edits are an **in-place content save** (no new version).
- **AI path**: full regenerate or per-slide partial regen (a comment flagged
  `forAi` drives partial regen); restore from per-slide history.
- Undo/redo is a client stack; history = checkpoints on Save + 10-min idle.
- Realtime events drive **in-place state updates, never `router.refresh`**.

---

## Conventions & non-negotiables

- **`dev` is the only branch.** Never `git checkout -b`. CodeRabbit reviews
  `dev → main` PRs. Push on request / milestone / >3 commits.
- **Design discipline**: never hardcode visuals — tokens / add a class to
  `app/globals.css` first; read the globals.css legend before any visual change;
  reuse existing primitives. The design system is flat + **one blue accent**.
- **Bilingual**: translate **and** mirror direction (logical CSS only);
  `stripLocale()` before any pathname check; `localizedHref`/`switchLocaleHref`
  for internal nav; **Latin numerals only**; **no em dash** in copy.
- **Both themes**: verify visuals in light *and* dark (flip and compare).
- **Realtime → in-place state**, never `router.refresh`.
- **Don't reintroduce coordinate math** — the HTML pivot deleted bbox arithmetic /
  RTL coordinate mirroring; the browser does layout.
- **`dom-to-pptx` / `bidi-postprocess` changes** run through the export spike
  first; the library is **patched via patch-package** (postinstall applies it).
- **Run `/security-review`** after new API routes, upload/auth/sanitize edits,
  schema changes, or Inngest prompt-pipeline edits.
- Stale-chunk gotcha: a globals.css edit sometimes needs a second real change to
  force a clean Turbopack recompile.

---

## Local dev — one-pager

```bash
# prerequisites: Node 20+, Docker Desktop
npm install                  # postinstall auto-applies the dom-to-pptx patch

# .env.local (from the team). Required:
#   DATABASE_URL=postgresql://taqreer_user:...@localhost:5432/taqreer   # docker, NOT supabase
#   ANTHROPIC_API_KEY=sk-ant-...
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY=...
#   INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY=...

docker compose up -d         # postgres 16 + redis 7
npx prisma migrate deploy    # local only — DATABASE_URL must be localhost

npm run dev                  # Next.js :3000
npx inngest-cli@latest dev   # Inngest dev server :8288

# helpful scripts (scripts/):
npx tsx scripts/wipe-decks.ts            # wipe decks + storage (keeps users)
npx tsx scripts/setup-storage.ts         # one-time Supabase bucket setup (idempotent)
```

---

## Reference docs

- **[context/architecture.md](architecture.md)** — the structured architecture +
  design-system map.
- **[context/subscriptionmodel.md](subscriptionmodel.md)** — pricing / credit /
  billing source of truth (numbers + ledger).
- **[context/billing-plan.md](billing-plan.md)** — billing architecture
  (surfaces, journeys, Stripe's role, build status).
- **[context/admin-panel-plan.md](admin-panel-plan.md)** — admin panel spec.
- **Memory** (`~/.claude/projects/-Users-osama-taqreer/memory/`, loaded each
  session via `MEMORY.md`) — workflow rules + project context; re-read when in
  doubt.

---

*Living document — current state, not a changelog. History is the git log.*
