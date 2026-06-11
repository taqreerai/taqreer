# Billing & Subscription Architecture Plan

> **Status: REVIEWED 2026-06-11 - decisions locked in §8.** This is the
> missing "whole model" layer above context/subscriptionmodel.md (which owns
> pricing numbers and the credit ledger, both built and tested). This doc owns
> the USER-FACING model: surfaces, journeys, Stripe's role, and build order.
> UI components ship for review FIRST as static renders on /lab/billing
> before any of them go live (user direction).

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
| **Paywall states** | Locked preset / locked flow / cap exceeded / **premium template (Pro+Max only)** → upgrade CTA → #pricing | part of wiring phase |
| **Billing notifications** (existing bell) | Billing events land in the existing Notification system: "Your account was credited with N" (top-up / renewal / signup), "Payment failed - update your card", "Subscription will end on {date}". Realtime fan-out + bell rows already exist; billing just adds types | small |

Decision embedded here: **no custom billing page beyond one Settings section.**
Cancel/cards/invoices are Stripe-hosted. This kills ~80% of the UI work.

**UI review loop (user direction 2026-06-11):** every component above ships
FIRST as a static render on the dev-only showcase page `/lab/billing` -
the user reviews each, gives directions, and only then does the component
graduate into the real flow. Nothing billing-UI goes live unreviewed.

**Premium templates:** gated to **Pro + Max** (`isProPlan` in lib/plan.ts,
already enforced server-side in POST /api/templates/[id]/use). WHICH
templates are premium is curated in the future **admin panel**
(context/admin-panel-plan.md) - `Template.isPremium` already exists in the
schema, so the architecture is ready; until the panel ships it stays a
DB-set flag.

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
| **A0. Billing-UI showcase** | /lab/billing static renders of every billing component (notifications, insufficient dialog, paywalls, premium-template lock, Settings Billing, past_due banner) - user reviews + directs before anything ships | done first |
| **A. Generation wiring** (gaps #2+#5+#6+#1-cheap) | preflight in /api/projects (402 + two offers), hold/settle in deck-generate + onFailure + cancel(per keeps-partial spec §7), chargeCredits in regen + name-gen, signup grant call site + email-normalize + IP velocity, daily cron (stuck-holds sweep + expireTopups + monthly drip for yearly subs via resetMonthlyAllotment), insufficient-credits dialog (as approved from A0) | 1 session |
| **B. Stripe test mode** ✅ DONE (commit 7d8c2dc) | lib/billing/{stripe,prices,customer}.ts; scripts/stripe-setup-products.ts (run: 7 products + 10 prices live); /api/stripe/{checkout,portal,webhook}; GET /api/billing/summary; components/billing/BillingSection; landing pricing CTAs; billing Notification types; Subscription mirror fields + StripeWebhookEvent table. Verified 5/5 webhook checks + live checkout URL + sim 30/30 + security-review clean. | done |
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

## 8. Decisions (locked in review, 2026-06-11)

1. **Upgrade proration (credits side): full new allotment immediately.**
   Stripe prorates the money; the ledger grants the new tier's full
   allotment on upgrade (already implemented as grantSubscriptionCycle).
2. **Yearly billing: IN scope, credits renew monthly.** A yearly
   subscriber pays the discounted yearly price once (Stripe yearly Price
   per tier, created in Phase B); credits still DRIP MONTHLY - the
   existing `resetMonthlyAllotment` (idempotent, advances resetAt one
   month per cycle) is driven by the Phase A daily cron, independent of
   Stripe invoices. Monthly subscribers reset on the renewal webhook;
   yearly subscribers reset on the cron. The landing's monthly/yearly
   toggle stays.
3. **Customer Portal restricted to cancel + payment methods + invoices.**
   Plan switching (up AND down) happens only on our pricing page, so we
   own the messaging; the portal's plan-switch feature stays disabled in
   its Stripe dashboard config.
4. **No free trial of paid tiers.** The Free plan's 400-credit signup
   grant is the trial.
5. **Premium templates: Pro + Max only** (see §2); curation lands in the
   admin panel later, architecture ready now.

## 9. Refund policy (researched proposal - approve before live keys)

Standard practice for consumable AI credits is "non-refundable once
consumed, fair within a window", plus always refunding billing errors -
forcing credits-only on legitimate refund requests measurably increases
chargeback risk, while goodwill credits as a FIRST OFFER are fine.

Proposed policy (AR + EN in the terms page before live keys):

- **Subscriptions:** full refund within **7 days of the FIRST purchase**
  if less than ~10% of the month's credits were consumed. Renewals are
  not auto-refundable (Stripe sends receipts; we add a pre-renewal email
  reminder later, which is the single best dispute reducer). Goodwill
  exceptions at our discretion.
- **Top-up packs:** refundable in full within **14 days if untouched**;
  non-refundable once any credit from the pack is spent (instant-delivery
  consumable - the standard carve-out).
- **Always refunded in full:** duplicate charges, billing errors, paid
  features not delivered due to our fault.
- **Mechanics:** refunds issued in Stripe (support-initiated for now,
  admin panel later); the `charge.refunded` webhook debits the matching
  granted credits, floored at zero. Cancelling a subscription is never a
  refund - it stops renewal, access runs to period end (§3).
- **KSA/UAE note:** digital consumables are generally exempt from
  cooling-off once consumption starts; state this explicitly in the
  Arabic terms. Re-verify wording with Stripe Tax / local counsel before
  live keys.

---

*Phase A is unblocked: cancel keeps-partial spec is in §7, all §8
decisions are locked, and the /lab/billing showcase gates each UI piece
on user review before it goes live.*
