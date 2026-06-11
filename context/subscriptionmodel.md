# Subscription & Credit Model — Taqreer

> **Single source of truth** for pricing, credits, tier capabilities, and the
> billing architecture. Supersedes `context/pricing.md` + `context/subscription.md`.
>
> **Status:** tier prices, credit grants, slide caps, model/flow gates are
> **LOCKED** (2026-05-30). Credit *formula values*, COGS, and top-up sizes are
> **PROPOSED** — tune once we have 100+ runs/preset. Billing code not shipped;
> §7 is the build plan.
>
> **Rev 2026-06-11 (naming):** tiers RENAMED **Free / Plus / Pro / Max**
> (was Free / Starter / Plus / Pro) per user direction - same Latin names in
> both languages. Grants, prices, caps, and gates are UNCHANGED; whenever this
> doc says Starter read **Plus**, Plus read **Pro**, Pro read **Max**. Code
> keys follow the new names (`lib/plan.ts`, `lib/credits/cost.ts` TIERS).
>
> **Rev 2026-06-09:** reconciled to the **current 3-preset menu** (presets changed
> since the original draft); **user-selectable model with per-preset credit cost**
> (§3a); cost basis **validated against measured production spend** ($223 real API
> cost, §4); auto-upgrade behaviour clarified (§6); reset stands at **monthly**
> (supersedes the earlier "every 3 months" idea). Margins unchanged.

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

- **Model choice is the user's, and credits vary by preset.** Within the presets a
  tier unlocks, the user picks freely per generation; the cheaper the preset, the
  fewer credits it burns (§3, §3a). The grant sizes above are sized so the tier is
  comfortable on its *priciest* unlocked preset — picking a cheaper one stretches
  it further.
- **Credit reset:** monthly allotment resets to the tier amount each billing cycle —
  **no rollover** (Notion AI / Linear pattern). Free's 400 is a **one-time signup
  grant**, not a monthly refill.
- **Hard system cap:** 75 slides (= Pro's cap). Above ~80 slides we hit the 128k
  output-token ceiling, so nothing higher is ever exposed.
- **Margins at these numbers:** ~55–59% gross at *full* credit burn on the priciest
  allowed model, after Anthropic COGS + Stripe + the ~$1.50/user fixed-infra share
  (§4). Typical utilization is much fatter. **Validated against real spend — see §4.**

### Why the ladder gates the way it does
- **Free = create-only + Sonnet** is the only genuinely cheap config. Source flows
  (enhance/mimic/datasheet) **auto-upgrade Sonnet → opus-fast** (Sonnet can't hold
  JSON discipline on long structured decks — §6), so allowing them on Free would
  pull in Opus cost. Create+Sonnet caps Free COGS at ~$0.90 one-time.
- **Starter** unlocks Opus (سريع) + all source flows + 30 slides.
- **Plus** adds the thinking tier (تفكير / opus-balanced) + premium templates + 60 slides.
- **Pro** is max-everything: 75 slides + the largest grant. (Same model menu as Plus —
  Pro's differentiation is cap + volume, not new models.)

### Top-up packs (proposed)
One-time, **stack on** the subscription balance, **expire 12 months** from purchase,
**survive the monthly reset** (reset only clears *subscription* credits). Priced above
the per-credit subscription rate:

| Pack | Credits | Price | $/credit |
|---|---|---|---|
| Small | 1,000 | $12 | $0.012 |
| Medium | 3,000 | $32 | $0.0107 |
| Large | 8,000 | $75 | $0.0094 |

---

## 2. What each tier can and can't do

**Everyone (incl. Free) can:** generate via **create** up to their cap; import (PDF/PPTX)
and export (PDF/PPTX/PNG/HTML); view, edit, favorite, rename, duplicate, re-export any
existing deck — **all free** (no Claude call → no charge).

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
```text
credits = base[preset] + (slides × perSlide[preset])
```

### Per-preset values (PROPOSED — sized to track real COGS, §4)

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

### What that buys per tier

| Tier | ≈ decks / month |
|---|---|
| Free (400 once) | ~2 Sonnet decks (trial) |
| Starter (2,000) | ~10 Sonnet · or ~2–4 opus-fast source decks |
| Plus (5,000) | ~4–5 opus-balanced 30-slide · or ~6 opus-fast |
| Pro (12,000) | ~11 opus-balanced 30-slide · or ~6 full 75-slide |

### Charging rule (requested vs actual slides)
- **Fixed slide count** (stepper set): debit the requested count.
- **Auto mode** (Claude decides): **pre-authorize (hold)** credits for the tier's slide
  cap, generate, then **debit the actual saved-manifest count and release the
  remainder** (hotel-style pre-auth). The UI shows a rough estimate (~1 slide /
  ~100 words); the authoritative charge is the **actual manifest count**. Makes
  failure refunds trivial (release the hold).

---

## 3a. What the user sees before generating (per-preset estimate)  ⟵ NEW

Model choice is a **cost choice**, so the user makes it with the price in view. The
generate control (`GenerateSplitButton`) shows, for the **current** brief, the live
credit cost of each preset the tier unlocks — next to the live balance.

```text
estimate(preset) = base[effectivePreset] + slides × perSlide[effectivePreset]
```

- **slides** = the stepper value (fixed mode) or the tier slide-cap shown as "up to N"
  (auto mode; the hold uses the cap, the final debit uses the manifest count).
- **effectivePreset** = the preset *after* any source-flow auto-upgrade (§6). The number
  shown is **what will actually be charged** — never the pre-upgrade sticker price. If a
  picked preset would upgrade, show the upgraded cost with a one-line reason, so there's
  no surprise debit. (This is the fix for the old "silent upgrade cost" gap.)

**Example — a 30-slide `create` deck, user on Plus (balance 4,200):**

| Preset | Shown to user |
|---|---|
| Sonnet · سريع | **≈ 400 credits** · you have 4,200 |
| Opus · سريع (opus-fast) | **≈ 830 credits** · you have 4,200 |
| Opus · تفكير (opus-balanced, default) | **≈ 1,060 credits** · you have 4,200 |

**Example — the same brief as an `enhance` (source) flow:** the Sonnet row renders as
**"≈ 830 credits — runs on Opus سريع for source decks"** (the auto-upgraded cost),
because Sonnet would be force-upgraded for reliability (§6).

- **Locked presets** (above the tier) show an **upgrade CTA** in place of a number.
- **Insufficient balance** for the chosen preset: the row is the gap (*needs N, you have
  M*) with a cheaper-preset / fewer-slides path that fits, and the button hard-blocks
  (§5). No partial decks.

---

## 4. Cost basis (why the numbers cover everything)

Pricing must cover **all** costs — Anthropic, hosting, domain, Resend, Supabase,
Inngest, Stripe.

> **✅ Validated against measured spend (rev 2026-06-09).** Production usage May 11 –
> Jun 7, 2026: **$214.99 Claude + $8.05 GPT-images = $223.04**. Findings that confirm
> this section: (1) **output tokens are ~84% of Claude cost** — the cost is the
> generated HTML + thinking, exactly what `perSlide` tracks; (2) measured **~$0.09
> all-in per opus-balanced slide** on mid-size decks, sitting inside the `$0.85 base +
> $0.05/slide` model below; (3) **images are only 3.6% of total** — currently *not* in
> the credit formula and absorbed by the margin cushion (revisit a small image surcharge
> only if image usage scales); (4) **prompt caching is correctly configured but ~neutral**
> at current usage (single sporadic call per deck, 5-min TTL mostly expires) — it is *not*
> a lever and needs no change.

### Anthropic API rates (verified, [docs](https://platform.claude.com/docs/en/about-claude/pricing))

| Model | Input /MTok | Output /MTok | 5m cache-write | cache-read |
|---|---|---|---|---|
| Opus 4.8 | $5 | $25 | $6.25 | $0.50 |
| Sonnet 4.6 | $3 | $15 | $3.75 | $0.30 |
| Haiku 4.5 | $1 | $5 | $1.25 | $0.10 |

Batch API is 50% off but async/no-streaming — **unusable** for live-preview, so we pay
standard rates.

### Measured per-deck COGS (conservative, rounded up)

| Slides | sonnet-fast | opus-fast | opus-balanced |
|---|---|---|---|
| 10 | ~$0.40 | ~$1.20 | ~$1.40 |
| 30 | ~$0.70 | ~$2.00 | ~$2.40 |
| 60 | ~$1.20 | ~$3.20 | ~$4.00 |
| 75 | ~$1.50 | ~$3.80 | ~$4.80 |

Cost model: `sonnet ≈ $0.20 + $0.020/slide`, `opus-fast ≈ $0.75 + $0.034/slide`,
`opus-balanced ≈ $0.85 + $0.050/slide`. The credit formula (§3) is these costs
**× ~450–500**, so **COGS is a flat ≈ $0.0022/credit at any deck size** — no
"cheap-looking deck quietly loses money" hole.

### Fixed infrastructure (~$50–90/mo, amortizes fast)

| Item | ~Monthly |
|---|---|
| Supabase Pro | $25 |
| Hosting (Vercel Pro / Fly) | $20 |
| Inngest | $0 → $20 |
| Resend | $0 → $20 |
| Domain | ~$3 |

~$1.50/user at 50 paying users; shrinks with scale. Generation is the only per-user
variable cost.

### Payment processing
Stripe ≈ **2.9% + $0.30**/charge. VAT (KSA/UAE) via Stripe Tax before live launch.

### Margin check (worst case = whole allotment on the priciest allowed preset)

| Tier | Credits | Worst-case COGS¹ | Net after Stripe | Margin² |
|---|---|---|---|---|
| Starter $15 | 2,000 | $4.40 | ~$14.25 | ~59% |
| Plus $30 | 5,000 | $11.00 | ~$28.80 | ~57% |
| Pro $70 | 12,000 | $26.40 | ~$67.60 | ~59% |

¹ credits × $0.0022. ² after the ~$1.50/user fixed share. Premium vs Gamma ($18 Pro)
is justified by Opus-everywhere quality, Arabic-first RTL/BiDi, the enhance/mimic/
datasheet flows Gamma lacks, and a buyer base that pays. Compare by **decks delivered**,
not credit count.

---

## 5. Edge-case behavior

- **Source deck exceeds the tier's cap** (e.g. Starter cap 30, 60-slide upload):
  **block at extraction with an upgrade CTA**, never silently truncate (page count known
  up front via pdf-lib; enhance is verbatim 1:1).
  *"خطتك تنشئ حتى 30 شريحة لكل عرض — هذا الملف يحتوي 60. رقِّ إلى Plus."*
- **Not enough credits:** **hard-block before generation** (402) — never a partial deck.
  Show the gap (*needs N, you have M, top up N−M*) **and** a cheaper path (switch preset /
  fewer slides) that fits.
- **Credits depleted before renewal:** the wall blocks only **new generation / regen**;
  existing decks stay viewable/editable/exportable (free). Empty state shows renewal date
  + top-up CTA.
- **Generation fails after retries / user cancels pre-emit:** **refund** consumed credits
  (or release the pre-auth hold). Mid-stream cancel: refund un-streamed slides
  (`Job.slidesGenerated`).
- **Atomic consume is the only money gate** — `tryConsume` (§7) is one conditional UPDATE;
  a job can't overspend even under races.

---

## 6. Models & presets (reference)

Source of truth in code: `lib/anthropic/quality-params.ts` + `lib/types/quality.ts`.
**3 presets, intent-based Arabic labels** (سريع = no thinking, تفكير = light thinking):

| Preset key | Label | Model | Thinking | Effort |
|---|---|---|---|---|
| `sonnet-fast` | Sonnet 4.6 · سريع | claude-sonnet-4-6 | disabled | — |
| `opus-fast` | Opus 4.8 · سريع | claude-opus-4-8 | disabled | — |
| `opus-balanced` (default) | Opus 4.8 · تفكير | claude-opus-4-8 | adaptive | low |

- **User-selectable:** within their tier's unlocked set, the user chooses the preset per
  generation; the per-preset credit cost is shown live (§3a).
- **Auto-upgrade (reliability guard):** a `sonnet-fast` request on a **source-document
  flow** (`enhance`/`mimic`/`data`) upgrades to **`opus-fast`** at the API layer — Sonnet
  loses JSON-structure discipline deep into 30+ KB structured outputs (`JSON.parse`
  failures observed ~31k chars). `Job.quality` keeps the user's pick for analytics.
  `lib/extract/json-repair.ts` is the safety net. The user-facing estimate (§3a) shows
  the **upgraded** cost, so the upgrade is never a silent debit.
  > ⚠️ **CONFIRM against current code before locking billing.** A prior code-review of
  > `deck-generate.ts` described this upgrade landing on **`opus-balanced`** (thinking-on),
  > not `opus-fast`. The two cost differently. If the live target is `opus-balanced`, then
  > (a) the §3a estimate for upgraded source flows must use `400 + 22/slide`, and (b)
  > Starter — which doesn't unlock `opus-balanced` — would be running and must be priced
  > on it. Pin the actual target, then make §3a + the Starter source-flow price match it.
- `opus-balanced` runs `effort: low` deliberately — on 4.8, `medium` over-thinks this task
  (5-slide deck: medium = 16 min / $1.69 / ~60k output; low = 3.4 min / $0.68 / ~23.6k —
  no quality gain). `opus-max` retired.
- `thinking: { type: "enabled", budget_tokens }` is **rejected at runtime** on 4.x — use
  `adaptive` + `output_config.effort` only.

---

## 7. Billing architecture (build plan — not shipped)

Locked: subscriptions **+** top-up packs both ship; every Claude call debits; spend is
per-generation **+** per-slide **+** per-regen; monthly allotment resets (no rollover);
top-ups expire 12 months; fully local dev (Stripe test mode) until launch.

### Phase 1 — Credit ledger (no Stripe)
```prisma
model Credit {
  userId           String    @id
  balance          Int       @default(0)   // transactional, never derived on read
  monthlyAllotment Int       @default(0)   // 0 for Free; reset by renewal webhook
  allotmentResetAt DateTime?               // mirrors Stripe current_period_end
  updatedAt        DateTime  @updatedAt
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
// Subscription: stripeSubscriptionId @unique, stripePriceId, cancelAtPeriodEnd
// UsageEvent: eventType ∈ grant_subscription|grant_topup|consume|refund|expire_topup
//   amount: signed int; metadata: { jobId, slideCount, preset, effectivePreset, model }
//   @@unique([userId, stripeEventId]) for grant idempotency
```
Helpers (`lib/credits/server.ts`): `getBalance`, `tryConsume` (atomic
`UPDATE … SET balance = balance - $amt WHERE userId=$u AND balance >= $amt RETURNING balance`
+ UsageEvent in one tx; 0 rows → `{ok:false,reason:"insufficient"}`), `grant` (idempotent),
`refund` (idempotent), `expireTopups` (daily cron once live).

### Phase 2 — Wire consumption into every Claude entry point
Consume-then-call; refund on failure. Cost from `lib/credits/cost.ts` (runtime mirror of
§3, pinned to `quality-params.ts`, **resolving `effectivePreset` after auto-upgrade**).

| Entry point | File | Cost |
|---|---|---|
| Deck generate (create/enhance/mimic/datasheet) | `inngest/functions/deck-generate.ts` | `base + slides × perSlide` (effective preset) |
| Partial / full regen | regen Inngest fn | `perSlide × N` |
| Template-name | `inngest/functions/generate-name.ts` | 5 (Haiku) |
| Extraction / color-tag / brand-derive | resp. modules | only if they call Claude (audit) |

`/api/projects` does a **non-debiting** balance pre-check → 402 if insufficient, before
enqueuing; real debit happens inside Inngest, tx-aligned with the Claude call.

### Phase 3 — Stripe (local: CLI + test keys)
Products/Prices per tier + per pack; map Price ID → credits in `lib/billing/prices.ts`.
Routes: `/api/stripe/checkout`, `/portal`, `/webhook` (sig-verified). Events:
`checkout.session.completed` (grant allotment / top-up w/ 12mo expiry),
`invoice.payment_succeeded` (renewal: `balance = unexpired_topups + monthlyAllotment`),
`customer.subscription.updated` (tier change), `.deleted` (→ Free, balance still spendable),
`charge.refunded` (debit matching grant, never negative). Idempotency via
`StripeWebhookEvent` + `ON CONFLICT DO NOTHING`.

### Phase 4 — Pricing page + paywall + balance UI
`/pricing` tier cards + pack grid; persistent **balance pill**; Settings → Billing;
**`GenerateSplitButton` shows the per-preset estimate (§3a)** next to balance, with
gating + upgrade CTAs for locked presets. Realtime balance via `credit.balance.changed`
over the Phase-16 broadcast channel → `useCreditBalance()`.

### Phase 5 — Deploy + live keys
Live Products/Prices behind an env switch; prod webhook; $1 smoke-charge + refund.

---

## 8. Open questions / tune-with-data

- [ ] **Confirm the auto-upgrade target** (`opus-fast` vs `opus-balanced`) in current
  code, then align §3a estimate + Starter source-flow pricing (§6 warning). **Highest
  priority — it's a margin leak if wrong.**
- [ ] **Free monthly refill** — locked to one-time 400; revisit a small trickle (~100/mo)
  only if it helps activation without bleeding COGS.
- [ ] **Image surcharge** — images are 3.6% of cost and currently free/bundled. Add a
  per-image credit only if usage scales enough to matter.
- [ ] **Top-up balance separation** — single `balance` + metadata expiry vs. split
  `subscriptionBalance` + `topupBalance`. Decide before Phase-3 reset logic.
- [ ] **Pro-rate on mid-cycle upgrade** (credits side; Stripe handles payment).
- [ ] **Non-deck Claude calls** — audit every `anthropic.messages.create`; flat ~5 vs folded.
- [ ] **Per-user vs per-workspace credits** — per-user today; revisit when teams ship.
  *(Note: no team/Enterprise tier yet — for GCC gov/finance this is the eventual profit
  centre, so keep it on the roadmap.)*
- [ ] **Validate formula values** — need 100+ runs/preset before locking `base`/`perSlide`.
  Protect the flat-$/credit design (§4) when re-tuning.
- [ ] **Re-baseline ETA constants** — real 4.8 runs are mostly fixed overhead; current
  pills under-estimate ~1.8×.

---

## Cross-references
- Presets/auto-upgrade: `lib/anthropic/quality-params.ts`, `lib/types/quality.ts`, `inngest/functions/deck-generate.ts`
- Cost mirror: `lib/credits/cost.ts` · JSON safety net: `lib/extract/json-repair.ts`
- User/sub model: `prisma/schema.prisma` · Realtime: `lib/realtime/*` · Notifications: `lib/notifications/server.ts`
