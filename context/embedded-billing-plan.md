# Embedded Billing Pages - Plan (agreed 2026-06-12, build next session)

Replace the Stripe-hosted Customer Portal with fully in-app billing.
Users never leave taqreer.ai. Same approach as /checkout: Stripe APIs +
Elements themed via lib/billing/appearance.ts.

## Page structure (user-decided)

| Page | Content |
|---|---|
| **/plans** | What /billing is TODAY: plan summary card, change-plan cards (landing-size, popular pill, monthly/yearly SegmentedToggle), top-up packs |
| **/billing** | NEW: subscription card (status, renewal/ends date, Cancel with NoticeCard confirm, Resume undo) + Payment methods (list / add / remove / set default) + past_due banner pointing at the card section |
| **/invoices** | NEW: invoice history table (date, description, amount, status) in `.settings-row` style + Stripe hosted PDF link per row; empty state for free users |
| **/checkout** | Unchanged (already built, Elements form) |

## Navigation

- Shared pill-tab strip under one title across /plans, /billing,
  /invoices so they read as one billing area with three views.
- User menu "Billing" row keeps pointing at /billing; no extra menu
  rows - the tabs handle discovery.
- Repointing ("change my plan" intents go to /plans):
  - popup upgrade pill -> /plans
  - popup credits card -> /plans
  - settings plan-banner upgrade button -> /plans
  - checkout "Back to billing" + return-page failure link -> /plans
  - CreditGateDialog top-up link -> /plans

## Backend (new routes - all auth-gated, scoped to caller's stripeCustomerId)

- `GET  /api/billing/payment-methods` - list cards (brand, last4, exp, default flag)
- `POST /api/billing/payment-methods/setup-intent` - SetupIntent client
  secret for the add-card PaymentElement (same Appearance as checkout,
  RTL + theme-reactive)
- `POST /api/billing/payment-methods/detach`
- `POST /api/billing/payment-methods/default` - set invoice default
- `GET  /api/billing/invoices` - invoices.list -> our table; keep
  Stripe's hosted_invoice_url / invoice_pdf links per row (document
  download only, not a flow)
- `POST /api/billing/subscription/cancel` + `/resume` -
  cancel_at_period_end toggle; the existing webhook already mirrors it
- DELETE after parity: /api/stripe/portal route + the "Manage
  subscription" button + the restricted-portal config notes

## Decisions locked

- Cancel keeps access to period end: /billing shows "ends {date}" +
  Resume until then; /plans keeps offering upgrades as usual.
- Payment-method rows + invoice table follow the `.settings-row`
  recipe so the billing area matches Settings.
- Add-card = SetupIntent + PaymentElement in a NoticeCard-style modal
  or inline section (decide at build; reuse, don't invent chrome).

## Build order

1. Route skeletons + shared tab strip (/plans gets today's /billing
   content verbatim; /billing + /invoices stubs)
2. Payment methods (list -> add via SetupIntent -> detach/default)
3. Invoices table + empty state
4. Cancel / resume + past_due banner repoint
5. Link repointing sweep (popup, settings banner, checkout back,
   CreditGateDialog)
6. Browser-verify EN/AR x light/dark; delete portal route
7. /security-review (new money-adjacent API surface) + commit

Reference: the broader billing status lives in context/billing-plan.md;
this file only covers the portal-replacement build.
