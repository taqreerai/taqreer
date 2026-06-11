# Billing & Subscription Architecture Plan

> **Status: DRAFT for review - nothing here is built yet.** This is the
> missing "whole model" layer above context/subscriptionmodel.md (which owns
> pricing numbers and the credit ledger, both built and tested). This doc owns
> the USER-FACING model: surfaces, journeys, Stripe's role, and build order.
> Review, amend, then we proceed phase by phase.

---

## 1. The one architectural rule

Two systems, each owning what it is good at:

- **Stripe owns money state**: who pays, which plan, period dates, payment
  methods, invoices, cancellation state. We never store card data and never
  hand-build what Stripe hosts for free.
- **Our DB owns credit state**: the ledger (CreditAccount / TopupGrant /
  CreditHold, already built and 30/30 tested). Stripe events TRIGGER ledger
  operations; the ledger never talks back to Stripe.

`User.plan` and `Subscription.currentPeriodEnd` become read-mirrors of Stripe,
updated only by webhooks. If they ever disagree with Stripe, Stripe is right.

## 2. Surfaces (where billing lives in the UI)

| Surface | What it shows / does | Build |
|---|---|---|
| **Landing `#pricing`** | The 4 tier cards (exists). CTA behavior changes by state: signed-out → signup; signed-in lower tier → Stripe Checkout for that tier; current tier → "Current plan" (disabled) | small edit |
| **Settings → Billing section** | THE billing page. Current plan + renewal date + credit card (PlanUsage, exists), top-up pack buttons (3 packs → Stripe Checkout), "Manage subscription" button → Stripe Customer Portal, invoice history link (also portal) | new section, ~1 screen |
| **Stripe Customer Portal** (hosted) | Cancel, change payment method, view invoices, (optionally) switch plans. We build NONE of this UI - it is a redirect | config only |
| **Profile popup** (exists) | Upgrade pill → landing #pricing today; later can deep-link to Checkout | done |
| **Insufficient-credits dialog** | The two offers: reduce slides / top up (top-up button → Checkout with the smallest covering pack preselected) | part of wiring phase |
| **Paywall states** | Locked preset / locked flow / cap exceeded → upgrade CTA → #pricing | part of wiring phase |

Decision embedded here: **no custom billing page beyond one Settings section.**
Cancel/cards/invoices are Stripe-hosted. This kills ~80% of the UI work.

## 3. Journeys (what happens when)

**Subscribe (Free → paid).** Click tier CTA → `POST /api/stripe/checkout`
(creates a Checkout Session for that price, attaches/creates the Stripe
customer) → Stripe-hosted payment page → webhook `checkout.session.completed`
→ `grantSubscriptionCycle(userId, plan, periodEnd)` (already built: sets
allotment, balance, resetAt, User.plan) → redirected back to /settings with a
success toast; popup + ring update via the existing realtime nudge.

**Top-up.** Settings (or the insufficient dialog) → Checkout in one-time mode
for the pack → webhook → `grantTopup(userId, credits, sourceKey =
stripeEventId)` (already built, idempotent, 12-month expiry).

**Renewal (monthly).** Stripe auto-charges → webhook
`invoice.payment_succeeded` → `resetMonthlyAllotment` semantics via
`grantSubscriptionCycle` with the new period end (no rollover; top-ups
survive - already tested). This webhook IS the monthly reset trigger; no cron
needed for subscribers.

**Upgrade (mid-cycle).** Portal or our CTA → Stripe prorates payment →
webhook `customer.subscription.updated` → `grantSubscriptionCycle(newPlan)`
(immediate new allotment - the generous option we already implemented).
OPEN DECISION: credit-side proration (grant full new allotment vs difference).
Proposal: full new allotment, revisit if abused.

**Downgrade.** Portal, takes effect at period end (Stripe default) → webhook
at rollover → `changePlanKeepBalance(newPlan)` then next renewal grants the
smaller allotment. Already built + tested: nothing is clawed back mid-cycle.

**Cancel.** Portal → cancel at period end → webhook
`customer.subscription.deleted` at the boundary → `changePlanKeepBalance
("free")`. Remaining subscription credits stay spendable until the (now
final) resetAt passes; top-ups keep their own 12-month life. Tested (6.4).

**Payment failure.** Stripe retries per its dunning schedule; webhook
`invoice.payment_failed` → mark Subscription.status past_due → banner in
Settings ("payment failed, update your card" → portal). Credits are NOT
frozen during dunning; if Stripe gives up, the subscription.deleted path runs.

**Refund (manual, support-initiated).** `charge.refunded` webhook → debit the
matching grant (never below zero). Rare; admin-panel concern.

## 4. Webhook → ledger mapping (the whole integration in one table)

| Stripe event | Ledger call (all already built) |
|---|---|
| checkout.session.completed (subscription) | grantSubscriptionCycle(plan, periodEnd) |
| checkout.session.completed (top-up) | grantTopup(credits, sourceKey=event.id) |
| invoice.payment_succeeded (renewal) | grantSubscriptionCycle(plan, newPeriodEnd) |
| customer.subscription.updated (plan change) | grantSubscriptionCycle / changePlanKeepBalance |
| customer.subscription.deleted | changePlanKeepBalance("free") |
| invoice.payment_failed | Subscription.status = past_due (no ledger op) |
| charge.refunded | debit matching grant (small new helper) |

Idempotency: every handler keys on the Stripe event id (StripeWebhookEvent
table, insert-or-skip) - and grantTopup's sourceKey already double-guards.

## 5. Priority: does Stripe come before the generation wiring?

**Recommendation: No - wire generation charging first, Stripe immediately
after.** Reasoning:

- The wiring (preflight/hold/settle in deck-generate, regen, signup grant,
  sweeper - gaps #2/#5/#6) consumes the ledger API, which does not change
  shape when Stripe arrives. Zero rework risk, and it makes the whole credit
  experience real for testers NOW (estimates, holds, the insufficient dialog,
  live balance) with credits granted by script.
- Stripe's webhooks plug into ledger functions that already exist and are
  tested - Stripe is a THIN layer. Building it second means it lands on a
  pipeline that is already proven end to end with real generations.
- The reverse order would have us building checkout flows while generation
  still charges nothing - the only thing testers could do with purchased
  credits is watch the number sit there.

One ordering exception: the **monthly reset for Free-tier-like states** needs
no Stripe at all (Free has no renewal), and subscriber resets arrive WITH
Stripe webhooks - so no reset cron is needed in the wiring phase.

## 6. Build phases (proposed)

| Phase | Contents | Size |
|---|---|---|
| **A. Generation wiring** (gaps #2+#5+#6+#1-cheap) | preflight in /api/projects (402 + two offers), hold/settle in deck-generate + onFailure + cancel(per keeps-partial spec §7), chargeCredits in regen + name-gen, signup grant call site + email-normalize + IP velocity, daily sweeper (stuck holds + expireTopups), insufficient-credits dialog UI | 1 session |
| **B. Stripe test mode** | Products/Prices (4 tiers + 3 packs) in test dashboard, lib/billing/prices.ts mapping, /api/stripe/checkout + /portal + /webhook (sig-verified, idempotent), Settings → Billing section, pricing CTAs wired, StripeWebhookEvent table | 1 session |
| **C. Polish + edge UX** | past_due banner, upgrade deep-links from popup/paywalls, success/cancel return pages, admin refund helper | small |
| **D. Live keys** | live Products/Prices behind env switch, prod webhook endpoint, Stripe Tax (KSA/UAE VAT), $1 smoke charge + refund | small, pre-launch |

## 7. Cancel keeps-partial spec (gap #3, folded into Phase A)

- Cancel button confirms with the real numbers: "Stop now? You keep N
  finished slides for X credits" (N = slides fully streamed, X = base +
  perSlide × N on the effective preset).
- Cancel before the first finished slide: full release, nothing kept.
- The cancel route STOPS discarding partials: the version saves with the
  finished slides, status "completed", and the project opens/edits/exports
  like any deck. A small "stopped early" marker on the version metadata for
  analytics; no special UI state.
- Mid-final-slide cancel: the in-flight slide is dropped (only closed
  `<section>`s count) - consistent with "pay for what was made".
- Settle = `settleHold(jobKey, generationCost(preset, N))`; ledger already
  clamps to the hold (never above the shown estimate).

## 8. Open decisions for review

1. **Upgrade proration (credits side)**: full new allotment immediately
   (proposed) vs difference-only. Stripe handles the money proration either way.
2. **Yearly billing**: the landing toggle shows ~10%-off yearly prices that do
   not exist in the model. Ship monthly-only in Phase B and hide the toggle,
   or define yearly (12x credits up front? monthly drip?). Proposal: hide the
   toggle until yearly is really designed.
3. **Plan switching inside the Customer Portal**: allow (less code, Stripe UI)
   or restrict portal to cancel/payment-method and keep upgrades on our
   pricing page (more control over messaging). Proposal: portal does
   everything; our pricing page is acquisition, portal is management.
4. **Free trial of paid tiers**: not in the model today. Proposal: none -
   Free's 400-credit grant IS the trial.
5. **Refund policy** (product, not code): define before live keys.

---

*Next step: review this doc. On approval, Phase A starts (it needs no Stripe
decisions beyond §7's cancel spec).*
