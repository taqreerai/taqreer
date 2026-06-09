# Admin Panel — build plan & spec

Status: **planning** (2026-06-09). No app code yet. Owner-facing control center for
Taqreer: see and control users, generations, spend, revenue, and broadcasts.

## Decisions locked
- **Billing:** wire **real Stripe** (checkout + customer portal + webhooks). Revenue
  metrics are real, not modeled. `Subscription.stripeCustomerId` already exists.
- **Visitor/funnel analytics:** use a **tool — PostHog** (product analytics +
  funnels + web/visitor analytics + feature flags; cloud or self-host). Plausible
  is the lighter privacy-only alternative if PostHog feels heavy. First-party
  metrics (users, decks, revenue, cost) stay in **our Postgres** as the source of
  truth; PostHog owns anonymous traffic + cross-stage funnels.
- **Landing CMS:** **out of v1.** Landing stays code-edited. Revisit later.
- **Stack reality (what already exists):** `User.role` (RBAC ready), DB-backed
  `Notification` + server fan-out (`lib/notifications/server.ts`), generic
  `UsageEvent` event log, `Session` (auth), `Subscription` (stripe field
  scaffolded, no code), `Job` model, Supabase Realtime presence (used in the
  editor), and per-generation Anthropic token `usage` already captured in the
  Inngest functions (just not persisted to a cost table).

---

## Architecture

- **Location:** `app/admin/` route group, reusing the design system (`--tq-*`
  tokens, existing cards/primitives). Server components for data pages.
- **Access control (defense in depth):**
  1. Next middleware on `/admin/*` → resolve Supabase session → load Prisma user →
     require `role === "admin"` (404, not 403, to non-admins so the panel is
     invisible).
  2. **Re-check server-side in every admin route handler / server action.** Never
     trust the client. A shared `requireAdmin()` helper.
  3. Step-up confirm (re-auth or typed confirmation) for destructive/sensitive
     actions (delete user, impersonate, refund, broadcast-to-all).
  4. Rate-limit admin mutation routes.
- **Charts:** Tremor (admin-oriented, fast) or Recharts, themed to `--tq-*`.
- **Performance:** raw counts via Prisma `count`/`groupBy`/`aggregate`; time-series
  via a nightly **`DailyStat` rollup** populated by an Inngest cron, so dashboards
  load instantly instead of scanning event tables live. Live counts (online now,
  in-flight generations) come from presence / a cheap status query.
- **Auditing:** every admin write records an `AdminAuditLog` row (actor, action,
  target, before/after, ip, ts). Non-negotiable.
- **Security:** run `/security-review` on every new admin API route (high-value
  target). Treat the whole panel as privileged surface.

## New data model (Prisma)

```
model TokenUsage {            // P3 — API spend (data already captured in Inngest)
  id            String   @id @default(cuid())
  userId        String?           // null for system/warm jobs
  projectId     String?
  function      String            // "deck-generate" | "deck-regenerate-partial" | "image" | ...
  phase         String?           // outline | slides | enhance | mimic | image | ...
  model         String            // claude-opus-4-8, etc.
  inputTokens   Int      @default(0)
  outputTokens  Int      @default(0)
  cacheReadTokens     Int @default(0)
  cacheCreationTokens Int @default(0)
  thinkingTokens Int     @default(0)
  costUsd       Decimal  @db.Decimal(12,6)   // computed from a model-price map
  createdAt     DateTime @default(now())
  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([projectId])
}

model AdminAuditLog {         // P0
  id        String   @id @default(cuid())
  actorId   String                 // admin User.id
  action    String                 // "user.plan.change" | "user.impersonate" | "notif.broadcast" | ...
  targetType String?               // "user" | "project" | "subscription" | ...
  targetId  String?
  meta      Json?                  // before/after, params
  ip        String?
  createdAt DateTime @default(now())
  @@index([createdAt])
  @@index([actorId, createdAt])
}

model DailyStat {            // P2 — rollup for fast time-series
  id        String   @id @default(cuid())
  day       DateTime @db.Date
  metric    String                 // "signups" | "decks" | "decks.create" | "spend_usd" | "mrr" | "dau" | ...
  value     Decimal  @db.Decimal(16,4)
  @@unique([day, metric])
  @@index([metric, day])
}

model AppConfig {            // P7 — config-driven instead of hardcoded
  key       String   @id        // "plan.limits" | "status.banner" | "maintenance" | "feature.flags"
  value     Json
  updatedAt DateTime @updatedAt
  updatedBy String?
}

model Payment {             // P5 — Stripe ledger (mirror of webhook events)
  id              String   @id @default(cuid())
  userId          String
  stripeInvoiceId String?  @unique
  amountUsd       Decimal  @db.Decimal(12,2)
  status          String              // paid | failed | refunded
  periodStart     DateTime?
  periodEnd       DateTime?
  createdAt       DateTime @default(now())
  @@index([userId, createdAt])
}
```

Plus small additions to existing models:
- `User.lastSeenAt DateTime?` (cheap "online" if we don't use presence) +
  `User.suspendedAt DateTime?` (ban/suspend) — optional.
- `Template.featured Boolean @default(false)` and `Project.hiddenAt DateTime?` for
  moderation (P6).

---

## Phased build plan

Each phase is independently shippable. P0–P1 run almost entirely on existing data.

### P0 — Foundation
- `requireAdmin()` guard + middleware on `/admin/*`.
- `/admin` shell (nav, layout) in the design system.
- `AdminAuditLog` model + `recordAudit()` helper wired into a mutation wrapper.
- Promote the first admin (`role = "admin"` via a one-off script / direct DB).
- **Security review of the guard + first routes.**

### P1 — Overview + Users + Broadcasts (mostly existing data)
- **Overview KPIs:** total users, new (today/7d/30d) + growth %, DAU/WAU/MAU,
  decks created, active subs, generation success rate, queue depth. Queries:
  Prisma aggregates over `User`/`Project`/`UsageEvent`/`Job`.
- **Users directory:** search + filter (plan, role, language, provider via
  `Account.provider`, join date), sortable, paginated.
- **User detail:** profile, plan, subs, decks, usage timeline, notifications
  received; controls — change plan, grant/revoke admin, extend/credit quota,
  suspend, GDPR delete, **impersonate ("log in as")** (audited, step-up).
- **Logged-in / online:** active `Session` rows = logged in; **online now** via a
  global Supabase presence channel (preferred) or `lastSeenAt` heartbeat.
- **Send notification:** compose → one user / segment (e.g. all `pro`) / everyone.
  Reuse `Notification` + `lib/notifications/server.ts`; "everyone" fans out via an
  Inngest job; add an `admin.message` bell renderer + a global admin banner
  (admin-togglable, reuses the `ServerStatusBanner` slot).

### P2 — Generation & flow analytics
- Decks over time, **by flow** (create/enhance/mimic/datasheet), avg decks/user,
  time-to-first-deck, exports by format, templates saved, shares, comments.
- **Funnel** (visitor→signup→first deck→subscribe→retained) + retention cohorts →
  PostHog (which already has the anon side from P-analytics) joined with our data.
- **`DailyStat` rollup cron** (Inngest) feeding all time-series charts.

### P3 — API spend / cost (highest-value)
- `TokenUsage` table + **model-price map**; write rows in `deck-generate`,
  `deck-regenerate-partial`, image jobs (the `usage` object is already in hand —
  ~90% of this is persistence).
- Dashboards: $ spend over time, by model/phase, **cost per deck**, **cost per
  user**, **margin (revenue − cost)**, most expensive users/decks, image-gen spend,
  **cache-hit savings**.

### P4 — Presence / realtime
- "Online now" count + who, concurrent generations, live activity feed. Global
  presence channel (or heartbeat) surfaced on Overview + Users.

### P5 — Subscriptions & revenue (Stripe)
- Wire Stripe: checkout, customer portal, webhooks → `Subscription` + `Payment`.
- Dashboards: MRR/ARR, ARPU, LTV, active by plan, new/churned, trial→paid, failed
  payments, renewal calendar. Controls: comp/extend/cancel, refund (audited).

### P6 — Content moderation
- Browse all projects/templates; feature/unfeature public templates; hide/remove
  abusive content; Supabase **storage usage** per user; top templates.

### P7 — System config & flags
- Move hardcoded **plan limits (free 10 / plus 60 / pro 90)** and quality presets
  into `AppConfig`. **Maintenance mode**, manual status banner, **feature flags**
  (PostHog or `AppConfig`). Inngest job health, failures by reason, avg generation
  time, Anthropic upstream status, error rate.

---

## Integrations

### Stripe (P5)
- Products/prices for plus/pro; Checkout Session from the app; Customer Portal for
  self-serve management.
- **Webhooks** (`checkout.session.completed`, `customer.subscription.*`,
  `invoice.paid`, `invoice.payment_failed`, `charge.refunded`) → update
  `Subscription` (plan/status/currentPeriodEnd) + insert `Payment` rows. Idempotent
  handlers keyed on Stripe event id.
- Secrets in env; webhook signature verification; **/security-review** on the
  webhook route.

### PostHog (analytics tool)
- Client snippet on marketing + app for pageviews/visitors; `identify()` on login
  so anon→user funnels stitch; key server events (deck.created, subscribed) sent
  server-side for reliability.
- Admin "Acquisition/Funnel" section can embed PostHog or read its API; our own
  Postgres dashboards stay the source of truth for revenue/cost/control.
- Privacy: cookie-consent aware; can self-host for full data ownership.

## The full metric catalog (for reference)
- **Users:** total, new (d/w/m), growth, DAU/WAU/MAU, active vs dormant, by plan /
  language / provider, churn, retention cohorts, online now.
- **Engagement:** decks total + by flow + over time, avg decks/user,
  time-to-first-deck, edits, exports by format, templates saved, shares, comments.
- **Funnel:** visitor→signup→first deck→subscribe→retained.
- **Revenue:** MRR, ARR, ARPU, LTV, active subs by plan, new/churned, trial→paid,
  failed payments, renewals.
- **Cost:** total tokens, by model/phase, $ over time, cost/deck, cost/user,
  margin, most expensive users/decks, image spend, cache-hit savings.
- **Ops/quality:** success rate, failures by reason, avg generation time, queue
  depth, Inngest throughput/failures, upstream status, error rate.
- **Content:** projects/templates totals, public/premium templates, storage used,
  top templates.

## Controls catalog
User: plan change, grant/revoke admin, credit/extend quota, suspend/ban, GDPR
delete, impersonate. Subs: comp/extend/cancel/refund. Notifications: one/segment/
all, scheduled, global banner. Content: feature/hide/remove. System: maintenance,
status banner, feature flags, plan-limit & preset config. Everything audited.

## Open questions to confirm during build
- PostHog **cloud vs self-host**? (data ownership vs ops effort)
- Impersonation ("log in as") — include in v1? (high support value, sensitive)
- Stripe: plans/prices finalized? trial length? proration policy?
- Admin allowlist beyond `role` (e.g. require a specific email set) for extra safety?
