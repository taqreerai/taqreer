# Subscription & Credit Model — Taqreer

> **Single source of truth** for pricing, credits, tier capabilities, and the
> billing architecture. Supersedes and replaces the old `context/pricing.md`
> + `context/subscription.md` (merged into this file 2026-05-30).
>
> **Status:** tier prices, credit grants, slide caps, model/flow gates are
> **LOCKED** (decided with the user 2026-05-30). The credit *formula values*,
> COGS estimates, and top-up pack sizes are **PROPOSED** — tune once we have
> 100+ production runs per preset. No billing code is shipped yet; the
> architecture in §7 is the build plan.

---

## 1. The locked numbers

| | **Free** | **Starter** | **Plus** | **Pro** |
|---|---|---|---|---|
| **Price (USD/mo)** | $0 | **$15** | **$30** | **$70** |
| **Credits** | 400 once (signup) | 2,000 / mo | 5,000 / mo | 12,000 / mo |
| **Slides per generation** | 10 | 30 | 60 | 75 |
| **Models (menu)** | Sonnet only | + Opus سريع (opus-fast) | + Opus تفكير (opus-balanced) | all 3 presets |
| **Flows** | create only | create · enhance · mimic · datasheet | all | all |
| **Premium templates** | ✗ | ✗ | ✓ | ✓ |
| **Custom brand kit** (colors/fonts/logo) | ✗ *(proposed)* | ✓ | ✓ | ✓ |
| **Import** (PDF, PPTX) | ✓ | ✓ | ✓ | ✓ |
| **Export** (PDF, PPTX, PNG, HTML) | ✓ | ✓ | ✓ | ✓ |

- **Credit reset:** monthly allotment resets to the tier amount on each billing
  cycle — **no rollover** (standard SaaS; Notion AI / Linear pattern). Free's
  400 is a **one-time signup grant**, not a monthly refill.
- **Hard system cap:** 75 slides (= Pro's cap). Above ~80 slides we hit the
  128k output-token ceiling, so nothing higher is ever exposed.
- **Margins at these numbers:** ~55–59% gross at *full* credit burn on the
  priciest allowed model, after Anthropic COGS + Stripe + the ~$1.50/user
  fixed-infra share (see §4). Typical utilization is much fatter.

### Why the ladder gates the way it does
- **Free = create-only + Sonnet** is the *only* genuinely cheap config. Source
  flows (enhance/mimic/datasheet) **auto-upgrade Sonnet → opus-fast** (Sonnet
  can't hold JSON discipline on long structured decks — see §8), so allowing
  them on Free would silently pull in Opus cost. Keeping Free on create+Sonnet
  caps its COGS at ~$0.90 one-time.
- **Starter** unlocks Opus (سريع) + all source flows + 30 slides.
- **Plus** adds the thinking tier (تفكير / opus-balanced) + premium templates + 60 slides.
- **Pro** is max-everything: 75 slides + the largest grant. (Same model menu as
  Plus — Pro's differentiation is cap + volume, not new models.)

### Top-up packs (proposed)
One-time purchases, **stack on top** of the subscription balance, **expire 12
months** from purchase, and **survive the monthly reset** (the reset only clears
*subscription* credits). Priced above the per-credit subscription rate
(subscriptions reward commitment):

| Pack | Credits | Price | $/credit |
|---|---|---|---|
| Small | 1,000 | $12 | $0.012 |
| Medium | 3,000 | $32 | $0.0107 |
| Large | 8,000 | $75 | $0.0094 |

---

## 2. What each tier can and can't do

**Everyone (incl. Free) can:**
- Generate via the **create** flow, up to their slide cap.
- Import source decks (PDF / PPTX) and export (PDF / PPTX / PNG / HTML).
- View, edit (text/layout), favorite, rename, duplicate, and re-export any
  existing deck — **all free** (no Claude call → no credit charge).

**Gated:**

| Capability | Free | Starter | Plus | Pro |
|---|---|---|---|---|
| Opus سريع (opus-fast) | ✗ | ✓ | ✓ | ✓ |
| Opus تفكير (opus-balanced) | ✗ | ✗ | ✓ | ✓ |
| enhance / mimic / datasheet | ✗ | ✓ | ✓ | ✓ |
| Premium templates | ✗ | ✗ | ✓ | ✓ |
| Custom brand kit *(proposed)* | ✗ | ✓ | ✓ | ✓ |
| Max slides / generation | 10 | 30 | 60 | 75 |

---

## 3. How credits are spent

**Every Claude API call debits the ledger.** Viewing/editing/exporting do not.

### Formula
```
credits = base[preset] + (slides × perSlide[preset])
```

### Per-preset values (PROPOSED — sized to track real COGS, see §4)

| Preset | base | + per slide |
|---|---|---|
| `sonnet-fast` | 100 | 10 |
| `opus-fast` | 350 | 16 |
| `opus-balanced` | 400 | 22 |
| **regen** (partial/full) | 0 | `perSlide[preset]` × slides regenerated |
| **name-gen** (Haiku) | 5 flat | — |

### What a deck costs (credits)

| Deck | 10 sl | 30 sl | 60 sl | 75 sl |
|---|---|---|---|---|
| Sonnet | 200 | 400 | — | — |
| opus-fast | 510 | 830 | 1,310 | 1,550 |
| opus-balanced | 620 | 1,060 | 1,720 | 2,050 |

### What that buys per tier (the number that matters to a customer)

| Tier | ≈ decks / month |
|---|---|
| Free (400 once) | ~2 Sonnet decks (trial) |
| Starter (2,000) | ~10 Sonnet · or ~2–4 opus-fast source decks |
| Plus (5,000) | ~4–5 opus-balanced 30-slide · or ~6 opus-fast |
| Pro (12,000) | ~11 opus-balanced 30-slide · or ~6 full 75-slide |

### Charging rule (requested vs actual slides)
- **Fixed slide count** (user set the stepper): debit the requested count.
- **Auto mode** (Claude decides the count): **pre-authorize (hold)** credits for
  the tier's slide cap, generate, then **debit the actual saved-manifest slide
  count and release the remainder** — a hotel-style pre-auth. The UI may show a
  rough estimate from text length (~1 slide / ~100 words), but the authoritative
  charge is always the **actual manifest count**. This also makes failure
  refunds trivial (release the full hold).

---

## 4. Cost basis (why the numbers cover everything)

The user constraint: pricing must cover **all** costs — Anthropic, hosting,
domain, Resend, Supabase, Inngest, Stripe.

### Anthropic API rates (verified 2026-05-30, [docs](https://platform.claude.com/docs/en/about-claude/pricing))

| Model | Input /MTok | Output /MTok | 5m cache-write | cache-read |
|---|---|---|---|---|
| Opus 4.8 | $5 | $25 | $6.25 | $0.50 |
| Sonnet 4.6 | $3 | $15 | $3.75 | $0.30 |
| Haiku 4.5 | $1 | $5 | $1.25 | $0.10 |

Batch API is 50% off but async/no-streaming — **unusable** for our live-preview
flow, so we pay standard rates. 1M context at standard pricing. Opus 4.7/4.8
tokenizer may use up to 35% more tokens than older models.

### Measured per-deck COGS (conservative, rounded up)

| Slides | sonnet-fast | opus-fast | opus-balanced |
|---|---|---|---|
| 10 | ~$0.40 | ~$1.20 | ~$1.40 |
| 30 | ~$0.70 | ~$2.00 | ~$2.40 |
| 60 | ~$1.20 | ~$3.20 | ~$4.00 |
| 75 | ~$1.50 | ~$3.80 | ~$4.80 |

Approx cost model: `sonnet ≈ $0.20 + $0.020/slide`, `opus-fast ≈ $0.75 +
$0.034/slide`, `opus-balanced ≈ $0.85 + $0.050/slide`. The credit formula (§3)
is these costs **× ~450–500**, so **COGS is a flat ≈ $0.0022 / credit at any
deck size** — there's no "small Opus deck" hole where a cheap-looking deck
quietly loses money.

### Fixed infrastructure (~$50–90/mo, amortizes fast)

| Item | ~Monthly |
|---|---|
| Supabase Pro (DB + auth + storage) | $25 |
| Hosting (Vercel Pro / Fly) | $20 |
| Inngest | $0 → $20 |
| Resend | $0 → $20 |
| Domain | ~$3 |

At 50 paying users that's ~$1.50/user; it shrinks as we scale. **Generation is
the only per-user variable cost** — storage/egress for stored decks is
negligible.

### Payment processing
Stripe ≈ **2.9% + $0.30** per charge. VAT (KSA/UAE) handled by Stripe Tax before
live launch.

### Margin check (worst case = entire allotment on the priciest allowed model)

| Tier | Credits | Worst-case COGS¹ | Net after Stripe | Margin² |
|---|---|---|---|---|
| Starter $15 | 2,000 | $4.40 | ~$14.25 | ~59% |
| Plus $30 | 5,000 | $11.00 | ~$28.80 | ~57% |
| Pro $70 | 12,000 | $26.40 | ~$67.60 | ~59% |

¹ 2,000 × $0.0022, etc. ² After also subtracting the ~$1.50/user fixed share.
Premium positioning vs Gamma ($18 Pro) is justified by Opus-everywhere quality,
Arabic-first RTL/BiDi, the enhance/mimic/datasheet flows Gamma lacks, and a
buyer base that pays. Compare by **decks delivered**, not credit count — Gamma
credits buy cheaper ops on cheaper models.

---

## 5. Edge-case behavior (the rules)

- **Source deck exceeds the tier's slide cap** (e.g. Starter cap 30, user uploads
  a 60-slide PPTX): **block at extraction with an upgrade CTA**, never silently
  truncate. We know the source page count up front (pdf-lib). enhance is verbatim
  1:1, so a 60-slide source genuinely needs the 60-slide cap (Plus). Message:
  *"خطتك تنشئ حتى 30 شريحة لكل عرض — هذا الملف يحتوي 60. رقِّ إلى Plus."*
- **Not enough credits for the requested deck** (balance covers ~45 of a
  75-slide deck's cost): **hard-block before generation** (API returns 402) —
  never produce a partial deck. Show the gap (*needs N, you have M, top up N−M*)
  **and** a cheaper path (switch to Sonnet / fewer slides) that fits.
- **Credits depleted before renewal:** the wall only blocks **new generation /
  regen**. Every existing deck stays fully viewable/editable/exportable (free).
  The empty state shows (1) the renewal date and (2) a **top-up** CTA (top-ups
  stack and survive the reset).
- **Generation fails after retries / user cancels before any slide is emitted:**
  **refund** the consumed credits (or release the pre-auth hold). User-initiated
  cancel mid-stream: refund the un-streamed slides (`Job.slidesGenerated` is
  tracked).
- **Atomic consume is the only money-truth gate** — `tryConsume` (§7) is a single
  conditional UPDATE, so a job can never overspend a balance even under races.

---

## 6. Models & presets (reference)

Source of truth in code: `lib/anthropic/quality-params.ts` + `lib/types/quality.ts`.
**3 presets, intent-based Arabic labels** (سريع = no thinking, تفكير = light thinking):

| Preset key | Label | Model | Thinking | Effort |
|---|---|---|---|---|
| `sonnet-fast` | Sonnet 4.6 · سريع | claude-sonnet-4-6 | disabled | — |
| `opus-fast` | Opus 4.8 · سريع | claude-opus-4-8 | disabled | — |
| `opus-balanced` (default) | Opus 4.8 · تفكير | claude-opus-4-8 | adaptive | low |

- **Auto-upgrade:** a `sonnet-fast` request on a **source-document flow**
  (`enhance` / `mimic` / `data`) silently upgrades to `opus-fast` at the API
  layer (Sonnet loses JSON-structure discipline deep into 30+ KB structured
  outputs — observed `JSON.parse` failures at ~31k chars). `Job.quality` keeps
  the user's pick for analytics. `lib/extract/json-repair.ts` is the
  string-aware safety net before `JSON.parse`. → This is exactly why **Free
  (create-only Sonnet) avoids the upgrade cost**, and why source flows start at
  Starter (which includes opus-fast).
- `opus-balanced` runs `effort: low` deliberately — on 4.8, `medium` over-thinks
  this structured-output task (16 min / $1.69 / ~60k output for a 5-slide deck
  with no quality gain). `low` = 3.4 min / $0.68 / ~23.6k. The old high-effort
  tier (`opus-max`) was removed.
- `thinking: { type: "enabled", budget_tokens }` is **rejected at runtime** on
  4.x models — use `adaptive` + `output_config.effort` only.

---

## 7. Billing architecture (build plan — not shipped)

Each phase ships on its own; verify the contract before moving on. Locked
decisions: subscriptions **+** top-up packs both ship; every Claude call debits;
spend is per-generation **+** per-slide **+** per-regen; monthly allotment
resets (no rollover); top-ups expire 12 months from purchase; fully local dev
(Stripe test mode) until live launch.

### Phase 1 — Credit ledger (no Stripe)
Atomic, audited credit balance per user.

```prisma
model Credit {
  userId           String    @id
  balance          Int       @default(0)   // maintained transactionally, never derived on read
  monthlyAllotment Int       @default(0)   // 0 for Free; reset by the renewal webhook
  allotmentResetAt DateTime?               // mirrors Stripe current_period_end (backfill-recoverable)
  updatedAt        DateTime  @updatedAt
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Subscription: add stripeSubscriptionId @unique, stripePriceId, cancelAtPeriodEnd
// UsageEvent: audit trail — eventType ∈
//   grant_subscription | grant_topup | consume | refund | expire_topup
//   amount: signed int (+ in / − out)
//   metadata: { jobId, slideCount, preset, model } | { stripeEventId, stripePriceId, expiresAt? } | ...
//   add @@unique([userId, stripeEventId]) for grant idempotency
```

Helpers (`lib/credits/server.ts`):
- `getBalance(userId)` — read-only.
- `tryConsume({ userId, amount, eventType, metadata })` — atomic:
  `UPDATE "Credit" SET balance = balance - $amt WHERE userId = $u AND balance >= $amt RETURNING balance`
  inside a tx that also writes the UsageEvent; 0 rows affected → `{ ok:false, reason:"insufficient" }`.
- `grant({ userId, amount, eventType, idempotencyKey, expiresAt? })` — idempotent on the UsageEvent unique key.
- `refund({ userId, originalUsageEventId, reason })` — mirrors the consume positively; idempotent.
- `expireTopups(userId)` — sweeps grants past 12 months (daily Inngest cron once live).

### Phase 2 — Wire consumption into every Claude entry point
Consume-then-call; refund on failure. Cost from `lib/credits/cost.ts` (runtime
mirror of §3, pinned to `lib/anthropic/quality-params.ts`).

| Entry point | File | Cost |
|---|---|---|
| Deck generate (create/enhance/mimic/datasheet) | `inngest/functions/deck-generate.ts` | `base + slides × perSlide` |
| Partial / full regen | regen Inngest fn | `perSlide × N` (full = whole deck) |
| Template-name | `inngest/functions/generate-name.ts` | 5 (Haiku); quiet failure ok |
| Extraction / color-tag / brand-derive | resp. modules | only if they call Claude (audit first) |

`/api/projects` does a **non-debiting** balance pre-check → 402 if insufficient,
before enqueuing; the real debit happens inside Inngest (transactionally aligned
with the Claude call). Phase-2 UI = just the failure toast (*"تحتاج N نقطة"*).

### Phase 3 — Stripe (local: CLI + test keys)
`stripe listen --forward-to localhost:3000/api/stripe/webhook`. Products/Prices
per tier + per pack; map Price ID → credits in `lib/billing/prices.ts`. Routes:
`/api/stripe/checkout` (POST → Checkout Session, `client_reference_id = userId`),
`/api/stripe/portal`, `/api/stripe/webhook` (sig-verified, dispatched).

Webhook events:
- `checkout.session.completed` — sub: upsert Subscription, grant allotment, set
  `allotmentResetAt = current_period_end`; payment(top-up): grant with
  `expiresAt = now + 12mo`.
- `invoice.payment_succeeded` — renewal: `balance = unexpired_topups + monthlyAllotment` (no rollover).
- `customer.subscription.updated` — tier change: update price + allotment (next-cycle, or pro-rate TBD).
- `customer.subscription.deleted` — downgrade to Free; existing balance still spendable.
- `charge.refunded` — debit the matching grant; never go negative.

Idempotency: `StripeWebhookEvent { id @id, type, processedAt, payload }`,
`INSERT ... ON CONFLICT DO NOTHING`; no row → already processed, 200.

### Phase 4 — Pricing page + paywall + balance UI
`/pricing` tier cards + pack grid; persistent **balance pill** (Header /
Sidebar — placement TBD); Settings → Billing (plan, balance breakdown w/ top-up
expiry, UsageEvent audit, portal link); generate-button gating + cost preview in
`GenerateSplitButton`. **Realtime balance:** emit `credit.balance.changed` from
the ledger helpers over the existing Phase-16 broadcast channel; consume via a
`useCreditBalance()` hook.

### Phase 5 — Deploy + live keys
Live-mode Products/Prices behind an env switch; register prod webhook; $1
smoke-charge + refund; cut over marketing CTAs.

---

## 8. Open questions / tune-with-data

- [ ] **Free monthly refill** — locked to *one-time 400* for now; revisit a small
  monthly trickle (e.g. 100/mo) only if it helps activation without bleeding COGS.
- [ ] **Top-up balance separation** — single `balance` column with
  metadata-tracked expiry vs. split `subscriptionBalance` + `topupBalance`
  (simpler reset, extra column). Decide before Phase 3 reset logic.
- [ ] **Pro-rate on mid-cycle upgrade** — credits side (Stripe handles payment).
- [ ] **Non-deck Claude calls** — audit every `anthropic.messages.create`; flat
  small charge (~5) vs. folded-in. Needed before Phase 2.
- [ ] **Per-user vs per-workspace credits** — per-user today; revisit when teams ship.
- [ ] **Validate the formula values** — need 100+ runs/preset before locking
  `base`/`perSlide`; today's COGS sample is small (≈18 historical runs). The
  flat-$/credit design (§4) is the thing to protect when re-tuning.
- [ ] **Re-baseline ETA constants** (`secsPerSlide`/`baseOverheadSecs`) — real
  4.8 runs are mostly fixed overhead; current pills under-estimate ~1.8×.

---

## Cross-references
- Presets/auto-upgrade: `lib/anthropic/quality-params.ts`, `lib/types/quality.ts`, `inngest/functions/deck-generate.ts`
- JSON safety net: `lib/extract/json-repair.ts`
- User/sub model: `prisma/schema.prisma` (`User`, `Subscription`, `UsageEvent`)
- Realtime (Phase 4 balance): `lib/realtime/*` (Phase 16)
- Low-balance/payment-failure notifications: `lib/notifications/server.ts`
