# Subscription & Credit System — Plan

> Planning doc — **NOT shipped**. Stripe wiring + credit-ledger code does
> not exist yet. Locked decisions are captured here so we don't re-litigate
> them when implementation starts. Cross-reference `context/pricing.md` for
> the measured Claude-API cost data + proposed point values; this doc is
> about the *billing/credit system architecture*, not the point math.
>
> Last updated: 2026-05-29 (Opus 4.8 migration + 3-preset collapse — see note below; Phase 1+ has not begun).

---

> **2026-05-29 — model + preset change (affects the point math, NOT the billing architecture below):** migrated Opus 4.7 → **4.8** and collapsed the menu **4 → 3 presets** — `sonnet-fast` / `opus-fast` / `opus-balanced` (the last now Opus 4.8 + `effort:low`); `opus-max` (effort:high) removed entirely. The "Spend granularity" decision below still holds (`base + slides × perSlide` per preset; every Claude call debits the ledger), but the **per-preset point values must be re-derived** from the new 4.8 cost data in `pricing.md` — notably `opus-balanced` dropped from ~$2.58 (4.7 · medium) to **$0.68** (4.8 · low) for a 5-slide deck, and there is no longer a high-effort tier to price. Pricing is otherwise unchanged ($5/$25, same as 4.7).

---

## Locked decisions (2026-05-27)

These were confirmed in-conversation and should not be re-asked when work
starts. Anything in the "Open questions" section is still TBD.

| Decision | Choice | Notes |
|----------|--------|-------|
| **Pricing model** | Subscriptions **+** top-up packs | Both rails ship together. Subs grant a monthly allotment; packs are one-time top-ups on top of that. |
| **What consumes credits** | Every Claude API call | Generation, partial/full regen, Haiku helpers (name-gen, etc.) — anything that prompts Claude debits the ledger. |
| **Spend granularity** | Per generation **+** per slide **+** per regen | Aligns with `pricing.md`'s `base + slides × perSlide` formula per preset. Each Claude entry point is its own ledger event. |
| **Monthly allotment** | **Reset to allotment** on cycle rollover (no rollover) | Standard SaaS pattern (Notion AI, Linear). Predictable forecasting + simple UX. |
| **Top-up expiry** | **12 months from purchase** | Caps long-tail liability without being aggressive. Each top-up grant tracks its own `expiresAt`. |
| **Balance UI placement** | Multiple surfaces (TBD) | Header, Sidebar, Settings → Billing — decide which when Phase 3 starts. Phase 1+2 don't render balance. |
| **Local dev** | Fully local until live launch | Stripe test mode + `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Deploy only when ready to take real money. |

---

## Phase plan

Each phase is shippable on its own. Stop the world after each one to verify
the contract before moving on.

### Phase 1 — Credit ledger foundation (no Stripe yet)

**Goal:** Have a working credit balance per user, debitable atomically from
server code, with an audit trail of every grant/consume/refund.

**Schema additions** (Prisma migration):

```prisma
model Credit {
  userId             String   @id
  // Live balance. Sum of all UsageEvent amounts (positive grants,
  // negative consumes/expiries). Maintained transactionally — never
  // derived on read.
  balance            Int      @default(0)
  // Monthly subscription allotment (free tier = 0). Reset on each
  // billing cycle by the webhook handler.
  monthlyAllotment   Int      @default(0)
  // Wall-clock at which the next monthly_reset event should fire.
  // Stripe drives this via `current_period_end`; we mirror it so a
  // missed webhook can be recovered by a backfill job.
  allotmentResetAt   DateTime?
  updatedAt          DateTime @updatedAt
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Extend existing Subscription model
model Subscription {
  // ... existing fields (stripeCustomerId, plan, status, currentPeriodEnd) ...
  stripeSubscriptionId String?  @unique  // ADD
  stripePriceId        String?           // ADD — which tier (Plus / Pro / Studio)
  cancelAtPeriodEnd    Boolean  @default(false)  // ADD — for portal-initiated cancels
}

// UsageEvent already exists. Repurpose for the audit trail:
//
//   eventType:
//     "grant_subscription"   — monthly allotment reset (positive)
//     "grant_topup"          — one-time pack purchase (positive)
//     "consume"              — Claude call debit (negative)
//     "refund"               — failed Claude call returned credits (positive)
//     "expire_topup"         — top-up credits expired after 12 months (negative)
//
//   amount: signed integer (positive = credits in, negative = credits out)
//
//   metadata: JSON
//     - For grants: { stripeEventId, stripePriceId, expiresAt? }
//     - For consumes: { jobId, slideCount, quality, model }
//     - For refunds: { originalUsageEventId, reason }
//     - For expiries: { originalGrantUsageEventId }
//
// Add @@unique([userId, stripeEventId]) for grant idempotency.
```

**Helper lib** (`lib/credits/server.ts`):

- `getBalance(userId): Promise<number>` — read-only.
- `tryConsume({ userId, amount, eventType, metadata }): Promise<{ ok: true, balance } | { ok: false, reason: "insufficient" }>`
  - Atomic via Postgres: `UPDATE "Credit" SET balance = balance - $amount WHERE userId = $u AND balance >= $amount RETURNING balance` inside a tx that also writes the UsageEvent. If the update affects 0 rows, return `{ ok: false }`.
- `grant({ userId, amount, eventType, idempotencyKey, expiresAt? }): Promise<{ granted: boolean }>`
  - Idempotent on `(userId, idempotencyKey)` via the UsageEvent unique constraint. Returns `{ granted: false }` if duplicate.
- `refund({ userId, originalUsageEventId, reason }): Promise<void>`
  - Reads original consume, writes a positive UsageEvent mirroring it, bumps balance. Idempotent on `originalUsageEventId`.
- `expireTopups(userId): Promise<void>` — sweeps grants past 12 months, debits balance, writes expire_topup events. Called from a daily Inngest cron once the system is live.

**Migration concerns:**
- Backfill: every existing user gets a `Credit` row with `balance = 0, monthlyAllotment = 0`. The free-tier allotment grant happens via Phase 4's Stripe → Free Price webhook (or a one-shot script on launch day).
- Index `UsageEvent(userId, createdAt DESC)` for the audit-trail UI later.

**No UI in this phase.** All Phase 1 deliverables are server-side primitives
+ migration. Verify via DB inspection and unit tests.

---

### Phase 2 — Wire consumption into every Claude entry point

**Goal:** Every Claude prompt the app fires debits the ledger before the
call; failures refund.

**Entry points to wire** (audit before starting — this list may grow):

| Entry point | File | Cost calc | Refund condition |
|-------------|------|-----------|-------------------|
| Deck generate (create/enhance/mimic/datasheet) | `inngest/functions/deck-generate.ts` | `pricing.md` formula: `base[preset] + slides × perSlide[preset]` | Job status → `failed` after retries exhausted, OR user cancels mid-stream before any slide HTML is emitted. |
| Partial regen (single slide) | `inngest/functions/deck-regenerate-partial.ts` (or wherever lives) | `perSlide[preset]` × N slides regenerated | Same as above. |
| Full regen | same module | full deck cost again | Same as above. |
| Template-name generation | `inngest/functions/generate-name.ts` | Haiku flat — propose **2 credits** | Failure → refund. Quiet failure is also acceptable (template-name is non-critical). |
| Color tagging / brand derivation | `lib/project/derive-color-tags.ts`, `lib/template/derive-brand.ts` | If these call Claude — TBD. Otherwise no charge. | N/A |
| Extraction (PPTX/PDF → manifest) | `inngest/functions/extract-source.ts` | TBD — does this prompt Claude? If yes, separate event type. | N/A |

**Implementation pattern** (consume-then-call):

```ts
// At the top of the Inngest deck-generate function:
const cost = computeCost({ preset, slideCount });
const ok = await tryConsume({
  userId,
  amount: cost,
  eventType: "consume",
  metadata: { jobId, slideCount, quality: preset, model: resolvedModel },
});
if (!ok.ok) {
  throw new NonRetriableError("INSUFFICIENT_CREDITS");
}
const consumeEventId = ok.usageEventId;

// ... Claude call ...

// In the onFailure hook:
await refund({ userId, originalUsageEventId: consumeEventId, reason: "claude_failed" });
```

**Cost-calc helper** (`lib/credits/cost.ts`):
- Imports from `lib/anthropic/quality-params.ts` to pin formula to actual preset taxonomy.
- Single source of truth for the `base + slides × perSlide` table — pricing.md is the source of truth in markdown, the table in this module is the runtime mirror.

**API-route guard** (`/api/projects` and friends):
- Before enqueueing the Inngest job, do a *non-debiting* balance check and return a 402 if insufficient. The actual debit happens in Inngest so it's transactionally aligned with the Claude call.
- This avoids the case where balance is 100, user kicks off a 200-credit job, frontend doesn't get a useful error until 30s later when Inngest picks it up.

**UI surface** for Phase 2:
- Just the failure path — "تحتاج N نقاط" toast on the generate button if the 402 check fails.
- Full balance display lands in Phase 4.

---

### Phase 3 — Stripe wiring (local with CLI + test keys)

**Goal:** Real charges in Stripe test mode → real grants in our DB via
webhook.

**Setup:**
- `npm i stripe`
- `.env.local`:
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_PUBLISHABLE_KEY=pk_test_...` (only needed if we ever use Elements; Checkout flow doesn't need it server-side)
  - `STRIPE_WEBHOOK_SECRET=whsec_...` (from `stripe listen` output)
- Stripe dashboard (test mode): create Products + Prices for each tier (Plus / Pro / Studio) + each top-up pack size. Save Price IDs into a config:
  ```ts
  // lib/billing/prices.ts
  export const PRICES = {
    plus_monthly:   "price_test_...",
    pro_monthly:    "price_test_...",
    studio_monthly: "price_test_...",
    topup_500:      "price_test_...",
    topup_2000:     "price_test_...",
    topup_5000:     "price_test_...",
  } as const;

  export const PRICE_TO_CREDITS: Record<string, number> = {
    [PRICES.plus_monthly]:   1000,
    [PRICES.pro_monthly]:    3000,
    [PRICES.studio_monthly]: 10000,
    [PRICES.topup_500]:      500,
    [PRICES.topup_2000]:     2000,
    [PRICES.topup_5000]:     5000,
  };
  ```
  (Numbers TBD — final values live in `pricing.md`.)

**Routes** (`app/api/stripe/`):

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stripe/checkout` | POST | Body: `{ priceId, mode: "subscription" \| "payment" }`. Server creates a Checkout Session, returns the URL. Frontend redirects. Includes `customer_email` + `client_reference_id = userId` so the webhook can resolve the user. |
| `/api/stripe/portal` | POST | Creates a Customer Portal session for cancel/upgrade/invoices. Requires `stripeCustomerId` on the user. |
| `/api/stripe/webhook` | POST | Receives events, verifies sig with `STRIPE_WEBHOOK_SECRET`, dispatches. |

**Webhook events to handle** (minimum viable):

- `checkout.session.completed`
  - Subscription mode → resolve userId from `client_reference_id`, upsert Subscription, set `stripeSubscriptionId`, grant `monthlyAllotment` credits, set `allotmentResetAt = current_period_end`.
  - Payment mode (top-up) → grant credits with `expiresAt = now + 12 months`, write `grant_topup` UsageEvent.
- `invoice.payment_succeeded`
  - Recurring subscription renewal → fire `monthly_reset`: set balance to allotment (no rollover per locked decision), update `allotmentResetAt`. **Edge case:** carry top-up credits across the reset — the reset only clears *subscription* credits. Implementation: track each grant separately in UsageEvent and the reset is `balance = sum(unexpired_topup_grants) + monthlyAllotment`. This requires either a recompute on reset OR a separate `topupBalance` column. Decide before implementing.
- `customer.subscription.updated`
  - Tier change → update `stripePriceId` + `monthlyAllotment` (don't re-grant on tier change — wait for next cycle; or pro-rate, TBD).
- `customer.subscription.deleted`
  - Plan downgraded to free; existing balance + top-ups still consumable until depleted/expired.
- `charge.refunded`
  - Top-up refund → debit the matching grant amount; if balance < refund, we eat the loss (don't go negative).

**Idempotency:** webhooks retry on 5xx. Dedup on `event.id`:

```prisma
model StripeWebhookEvent {
  id          String   @id  // Stripe event ID
  type        String
  processedAt DateTime @default(now())
  payload     Json
}
```

Webhook handler: `INSERT ... ON CONFLICT DO NOTHING` returning the row;
if no row inserted, the event was already processed — exit 200 immediately.

**Local dev loop:**
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# In another terminal:
stripe trigger checkout.session.completed
# Or just run the full flow: hit the checkout URL with a 4242 card
```

---

### Phase 4 — Pricing page + paywall + balance UI

**Goal:** End-to-end UX. User can see balance, hit a paywall, buy credits,
see balance increase, generate, see balance decrease.

**Surfaces** (placement still TBD — see open questions):

1. **`/pricing` page** — tier cards (Free / Plus / Pro / Studio) + top-up pack grid. Each card has a CTA → POST `/api/stripe/checkout`. Existing subscribers see "Manage subscription" → Portal.
2. **Balance pill** — somewhere persistent (Header bell-area? Sidebar bottom? Both?). Click → small popover with balance + "اشحن النقاط" CTA → `/pricing` or directly to top-up checkout.
3. **Settings → Billing tab** — current plan, balance breakdown (sub credits vs top-ups, with top-up expiry dates), recent UsageEvents (the audit trail), portal link.
4. **Generate-button gating** — disabled state + tooltip when balance < required cost; click → toast "ابدأ مع المزيد من النقاط" + link to /pricing.
5. **Generation-cost preview** — show estimated cost in the GenerateSplitButton dropdown alongside the existing ETA chip. Numbers come from `lib/credits/cost.ts`.

**Realtime balance updates:** when a generation completes (or fails and
refunds), the user's balance changes server-side. Pipe through the existing
Phase 16 Broadcast channel — emit a `credit.balance.changed` event from the
ledger helpers, subscribe in a `useCreditBalance()` hook.

---

### Phase 5 — Deploy + live keys

- Pick a host (Vercel / Fly / Railway — out of scope here).
- Migrate DB (or keep using a hosted Postgres).
- In Stripe dashboard (LIVE mode):
  - Re-create all Products + Prices, copy IDs into `lib/billing/prices.ts` behind an env-conditional (`process.env.STRIPE_MODE === "live"` picks the live IDs).
  - Register the production webhook endpoint, copy its `whsec_...` → `STRIPE_WEBHOOK_SECRET` in prod env.
- Smoke test with a $1 charge using your own card, then refund it via the dashboard.
- Cut over the marketing site's CTAs.

---

## Open questions (defer to implementation kickoff)

- [ ] **Free-tier allotment** — how many credits/month does a free user get? Or zero (Free = locked to demos/previews only)? Affects the `monthlyAllotment` on the free Subscription row.
- [ ] **Pro-rate on tier upgrade mid-cycle** — user upgrades Plus → Pro on day 10. Do they get the prorated difference immediately, or wait for next cycle? Stripe handles the *payment* side; we need to decide the *credits* side.
- [ ] **Insufficient-balance UX during streaming** — what if balance was sufficient at consume-time but balance goes negative due to a race? Today's locked atomic consume prevents this, but worth documenting that `tryConsume` is the only money-truth gate.
- [ ] **Cost-calc model for non-deck Claude calls** — template-name, color-tag, brand derivation. Per-call flat (cheap, ~2 credits)? Free (rounded into deck cost)? Need an audit of every `anthropic.messages.create` call before Phase 2.
- [ ] **Top-up balance separation** — keep top-ups in same `balance` column with metadata-tracked expiry, OR split into `subscriptionBalance` + `topupBalance` columns? Latter is simpler for the reset webhook but adds a column.
- [ ] **Refund policy on user-initiated cancel mid-generation** — user clicks "Cancel" 30s into a generate. Already-streamed slides are paid for; pending slides — refund? (Recommendation: refund the un-streamed slides; we already track `slidesGenerated` in the Job row.)
- [ ] **Volume discounts / annual billing** — Stripe supports both. Out of scope for v1; flag as Phase 5+ concern.
- [ ] **Tax / VAT** — Stripe Tax handles this automatically once enabled in the dashboard. Decide before live launch (KSA/UAE will need this).
- [ ] **Team / workspace billing** — today everything is per-user. When teams ship, do credits attach to the workspace or the user? Affects schema.

---

## Cross-references

- **Cost data & point values:** `context/pricing.md` — measured per-deck costs by preset, proposed `base + slides × perSlide` formula, retail markup math.
- **Auth + user model:** `prisma/schema.prisma` `model User`, `model Subscription` (already exists with `stripeCustomerId` placeholder).
- **Existing usage tracking:** `prisma/schema.prisma` `model UsageEvent` — repurpose for the audit trail.
- **Claude entry points to wire in Phase 2:** `inngest/functions/deck-generate.ts`, `inngest/functions/deck-regenerate-partial.ts` (or equivalent), `inngest/functions/extract-source.ts`, `inngest/functions/generate-name.ts`.
- **Realtime infrastructure:** `lib/realtime/*` (Phase 16) — reuse for `credit.balance.changed` broadcasts in Phase 4.
- **Notifications:** `lib/notifications/server.ts` — can fan out a notification when low balance / payment fails.

---

## When to start

Awaiting user signal. Phase 1 (schema + ledger primitives) is the natural
first chunk and lands in ~1 day of work. Stripe doesn't enter the picture
until Phase 3 — Phases 1 and 2 are pure local DB work and can ship even
before pricing is finalized.
