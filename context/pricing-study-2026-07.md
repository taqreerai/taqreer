# Taqreer Pricing Study - July 2026

Repricing for the first 1-2 years: market comps, real COGS, margin model, new ladder, free tier, MENA plan. Strategy locked with Osama on 2026-07-07: **growth first, thin margins acceptable**. This document is the analysis + recommendation; implementation (Stripe, config, copy) is a separate follow-up task (phases 2-3 in the plan).

---

## 1. Executive summary

Taqreer launched as the most expensive non-enterprise ladder in its competitive set while offering the stingiest free tier (200 credits, 6-slide cap = ~1 deck; Gamma gives ~10). Real production COGS shows we can afford to be dramatically more generous: the recommendation is to undercut Gamma on every tier while giving 2x its credits, and to fix the two places we currently sell below cost (the fast preset under cheap credits, and free image generation).

**Recommended ladder:**

| Tier | Today | Proposed (mo) | Proposed (annual, per mo) | Credits/mo | Per-credit revenue |
|---|---|---|---|---|---|
| Free | $0, 200 cr one-time, 6-slide cap | $0, **1,000 cr one-time**, 10-slide cap | - | one-time | - |
| Plus | $15, 2,000 cr | **$9** | **$7.65** ($91.80/yr) | **4,000** | $0.00225 |
| Pro | $30, 5,000 cr | **$19** | **$16.15** ($193.80/yr) | **10,000** | $0.0019 |
| Max | $70, 12,000 cr | **$49** | **$41.65** ($499.80/yr) | **28,000** | $0.00175 |

Annual = uniform **15% off** (decided 2026-07-07, revised from the earlier 25% draft). Campaign **promo codes top yearly up to 25% total** for the first year: Stripe-dashboard-managed coupons at percent_off 11.76, duration "once", yearly checkouts only (the promo field renders only there).

Alongside the price cut (same release):
1. **Charge 5 credits per generated image** (today images are free: up to 12 x $0.05-0.08 per deck of pure COGS).
2. **Bump `opus-fast` to 100 base + 15/slide** (from 10/slide) so the fast preset is not sold below cost at the new cheaper per-credit rates.
3. **Make yearly real at 15% off** (current code is a ~10% placeholder), with promo codes as the 25% first-year campaign lever.
4. Keep `fable-low` inactive, or reprice it to ~900 base + 60/slide before reactivating (see 4.3).

Year 1-2 margin target: **blended gross margin >= 50%**; the entry tier may dip to 25-30% for heavy users; full-burn fast-preset usage may go negative on Plus and that is accepted under growth-first (see 5.3 for monitoring triggers).

---

## 2. Market landscape (verified live on vendor pricing pages, 2026-07-07)

| Tool | Free tier | Entry paid | Mid | Top | Model | PPTX export gate |
|---|---|---|---|---|---|---|
| **Gamma** (anchor) | 400 one-time credits (~10 decks) +200/referral | $12 / $9yr Plus, 1,000 cr | $25 / $18yr Pro, 4,000 cr | $100 / $90yr Ultra, 20,000 cr | Credits on free; paid = ~unlimited standard gen, credits meter premium only | Free (badge) |
| Beautiful.ai | None (14-day trial) | $12 annual-only, unlimited | $40/user Team | Custom | Unlimited | Paid only |
| Canva | ~200 std AI uses/mo | $10-15 Pro | $15-20 Business | Custom | Monthly AI allowance | Free |
| Presentations.ai | 100 credits | $20 annual-only ($240) | - | $100 Gold | Credits + explicit PPP | Paid only (headline gate) |
| Decktopus | ~none | $14.99yr / ~$25mo | $34.99 Business | Custom | Credits (deck = 30) | PDF Pro, PPTX higher |
| Pitch | 100 credits, unlimited manual decks | $15 / $13yr Plus | $19-23 Team | $25-30 Business | Credits + $0.004 top-up | Plus and up |
| Plus AI | None (7-day trial) | $10-15 Basic | $20-25 Pro | $200-240 Max unlimited | Credits | n/a (add-on) |
| **Mouj** (AR) | 15 slides | $9 | $19 | - | 1 credit = 1 slide | Free w/ watermark |
| **Sharayeh** (AR) | - | $10 pack one-time | $24 pack | - | Pay-as-you-go packs | Any pack |
| **Taqreer today** | 200 cr (~1 deck) | $15 | $30 | $70 | Credits | Free |

Reading of the market:
- Entry-paid clusters at **$9-15**, mid at **$18-25**, top at **$90-100 or $200+**. Taqreer's $15/$30 sit at the top of each band with zero brand equity; $70 Max sits in no-man's-land.
- **Gamma's free tier is the category's onboarding standard**: enough one-time credits to build ~10 decks. Ours funds ~1.
- Paid tiers from the leaders **feel unlimited** (Gamma meters only premium usage on paid). A hard credit meter at $15 reads as worse value than Gamma at $12.
- Annual discounts are standard and steep: 17-40%.
- Arabic-native competitors (Mouj $9/$19, Sharayeh packs) price low but are far below Taqreer's quality; no Gamma-quality MENA-native competitor exists. $9 entry is right for the region.
- Cautionary tale: Tome died (20M users, <$4M ARR) on generous free with no conversion lever. Our levers on paid: monthly credits, all 4 flows, 30-75 slide caps, better presets. (Watermark-on-free was considered and ruled out: users strip watermarks, wasted effort.)

## 3. Real COGS (production data, not estimates)

Per-deck token averages from the prod `Job` table (every generation persists `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens`), joined with current API list prices (Opus 4.8: $5/$25 per MTok in/out, cache read 0.1x, cache write 1.25x; Fable 5: $10/$50).

Query used:

```sql
SELECT model, quality, count(*),
  round(avg("inputTokens")), round(avg("outputTokens")),
  round(avg("cacheReadTokens")), round(avg("cacheCreationTokens"))
FROM "Job" WHERE "outputTokens" > 0 GROUP BY model, quality;
```

| Preset | n | Avg in / out / cwrite | **$/deck** | Credits/deck (8 sl, today) | COGS $/credit |
|---|---|---|---|---|---|
| opus-fast (Opus 4.8) | 43 | 19.1k / 19.1k / 7.3k | **$0.62** | 180 | **$0.0034** |
| opus-balanced (Opus 4.8) | 48 | 9.8k / 31.8k / 6.7k | **$0.89** | 576 | **$0.0015** |
| fable-low (Fable 5) | 1 | 11.6k / 61.7k / 2.0k | **$3.22** | 724 | **$0.0044** |

Notes:
- One deck = one streaming Anthropic call (no per-slide calls). Partial regen is one call per slide at 16k max_tokens. System prompt is cache-controlled.
- The in-repo pricing assumption ("5-slide fast deck ~= $0.10, >90% margin") is optimistic vs production: real decks average larger inputs (enhance/mimic PDFs) and outputs.
- **Images are the biggest unpriced cost**: OpenAI gpt-image-2 medium ~= $0.05-0.08/image, up to 12/deck (warm-fill + reconcile, 3x retry on transient errors), charged 0 credits today. An image-heavy fast deck's true COGS roughly doubles to ~$1+.
- Sonnet as a cheaper model was **tried before and ruled out**: despite lower per-token rates, Sonnet produced more and less disciplined output (prod data: ~18k avg output with spikes to 83k) plus weaker RTL, making it more expensive than Opus in practice.

## 4. Margin model at the proposed prices

Assumptions: 10-slide decks; ~6 images/deck when images are on; **new** preset pricing (opus-fast 100+15, opus-balanced 400+22 unchanged); images charged 5 cr each. Deck credit cost: fast = 250+30 = 280 cr; balanced = 620+30 = 650 cr. Deck COGS: fast ~$0.98, balanced ~$1.25 (incl. images).

### 4.1 Plus $9 / 4,000 credits (the stress tier)

| Scenario | Decks funded | COGS | Gross margin |
|---|---|---|---|
| 100% burn, all balanced (paid default) | ~6.2 | ~$7.7 | **15%** |
| 100% burn, all fast | ~14.3 | ~$14.0 | **-56%** (accepted worst case) |
| 40% utilization, 60/40 balanced/fast mix | ~3.5 | ~$4.1 | **~54%** |

Pro $19 and Max $49 carry the same per-credit economics within 1-3 margin points (per-credit revenue $0.0019 / $0.00175 vs Plus $0.00225), scaled by allotment.

### 4.2 Why this is acceptable (growth-first)

- 100% credit utilization across a whole cohort does not happen in practice; typical prosumer SaaS utilization runs well under half. **We have no utilization data of our own yet** (product just launched), which is exactly why monitoring triggers are defined in 5.3.
- The default paid preset is opus-balanced, the healthiest per-credit margin ($0.0015 cost vs $0.0019-0.00225 revenue).
- The genuinely unprofitable corner (full-burn fast-preset usage) is narrowed by the 15/slide bump and by image charging; if monitoring shows fast-heavy burn, the next lever is another admin-editable per-slide bump, no deploy needed.

### 4.3 Fable preset warning

At new per-credit revenue ($0.0019 on Pro), fable-low's COGS of ~$0.0044/credit means it is sold at >2x below cost at full burn. It is currently inactive in prod. **Do not reactivate at 500+28**; reprice to ~**900 base + 60/slide** (~1,380 cr for 8 slides, ~$0.0023/credit COGS) or keep it off until there is demand.

## 5. Free tier

### 5.1 Recommended: 1,000 credits one-time + 10-slide cap

- Funds **~3.5-4.5 full decks including images** (280 cr per 10-slide fast deck) - enough to hit the "wow" moment several times, vs exactly 1 deck today.
- **Worst-case COGS ~$3.5-4 per fully-activated free user**, one-time and capped. At a 6-8% free-to-paid conversion (typical for AI prosumer tools; 15-20% is great), a converting user pays back ~15-25 free users' worst case in their first month or two.
- Ratio optics after raising paid allotments: free 1,000 = **25% of a single Plus month** (Gamma's own ratio is 40%), and 2% of a Plus year.
- Keep existing gates: create flow only, opus-fast only, signup velocity/IP guard. The bigger grant raises the value of fake signups; the guard in `lib/credits/signup.ts` stays load-bearing and should be watched.

### 5.2 Alternative modeled: monthly refresh (rejected)

300 cr/month = ~1 deck/month forever. Uncapped: a dormant-but-returning free user costs up to ~$12/year at full use, and the recurring drip directly competes with the $9 Plus subscription ("wait for next month" behavior). One-time grant caps cost, front-loads the wow, and leaves recurring credits as a paid-only property. Matches Gamma. Referral bonuses (+200 cr) can be added later as a growth loop without changing the shape.

### 5.3 Monitoring triggers (revisit pricing when any fires)

- Blended gross margin dips below 50% for a full month.
- Median paid credit utilization exceeds ~60%, or fast-preset share of paid spend exceeds ~50%.
- 500+ paid seats (renegotiate assumptions with real cohort data).
- Anthropic/OpenAI list price changes.
- Free-signup abuse signals (many maxed-out grants from correlated IPs/domains).

## 6. MENA / PPP pricing

**Phase 1 (now): the global USD cut above.** At $9 entry we already match the Arabic-native anchor (Mouj $9) with a far better product; no regional list needed to launch the new prices.

**Phase 2 (after the USD cut settles): Stripe multi-currency display.**
- **SAR/AED at near parity**, rounded to local psychological price points (Plus ~34 SAR / ~33 AED, Pro ~71 SAR, Max ~184 SAR). Precedent: Canva serves SAR natively (450 SAR/yr Pro). This is a conversion lever (local currency trust), not a discount.
- **True PPP (~40-60% off) for EGP-level markets** later, gated by abuse controls (card country checks), following the Presentations.ai explicit-PPP precedent.
- Implementation is Stripe multi-currency prices on the same lookup keys + currency display in `display-prices.ts`; no credit-system changes.

## 7. Risks

| Risk | Exposure | Mitigation |
|---|---|---|
| Utilization assumption wrong (no own data yet) | Plus margin | Triggers in 5.3; per-slide credits are admin-editable live |
| Fast-preset-heavy users at full burn | Negative margin corner on Plus | 15/slide bump now; further bumps live if needed |
| Image cost drift (gpt-image-2 pricing, >6 images/deck habits) | ~$0.05-0.08/image uncharged today | 5 cr/image charging in the same release; prompt-drift double-billing bug noted in `deck-images-generate.ts` worth fixing |
| Free-signup farming (1,000 cr worth ~$3.5-4) | Free COGS | Existing velocity/IP guard; watch correlated signups; referral program deferred |
| Anthropic price changes | All margins | Trigger in 5.3; ladder holds at current $5/$25 Opus rates |
| Fable reactivation at old credit prices | Sold 2x below cost | 4.3: reprice before reactivating |
| Existing subscribers on $15/$30/$70 | Churn/confusion | Stripe keeps existing subs on old prices by default; they got MORE expensive plans - recommend auto-migrating them to the new cheaper prices (goodwill, trivial revenue impact at current seat count). Decide at implementation. |

## 8. Open decisions for Osama

1. **Existing subscribers**: auto-move to new (cheaper) prices, or grandfather? (Recommend auto-move + email.)
2. **Image credit price**: 5 cr/image proposed; alternatives: 3 cr (cheaper feel) or free-tier-capped instead of charged.
3. **Max tier**: ship at $49/28,000 or defer the tier entirely until power users appear (market top tiers are $90+ or $200+; $49 is deliberately an easy upsell instead).
4. **Annual discount depth**: DECIDED 2026-07-07 - 15% base, 25% total via first-year promo codes (yearly only, Stripe-dashboard-managed).
5. **Referral credits** (+200 like Gamma): now or later?

## 9. Implementation pointer (separate task, after sign-off)

Phase 2: code+Stripe repricing (`lib/credits/cost.ts` TIERS/TOPUP, `lib/config/runtime-config.ts` seeds, `lib/billing/prices.ts` yearly table, `scripts/stripe-setup-products.ts` re-run, admin live edits for allotments/signupGrant/slideCap, image charging, /security-review, dev->main PR).
Phase 3: dynamic-surface hardening so future tweaks are Stripe/admin-only - fix the 9 audited hardcoded spots: yearly discount label (dictionaries 743), duplicated `YEARLY_PER_MONTH_USD` (prices.ts + BillingSection), SEO JSON-LD AggregateOffer (schema.ts:112), Stripe-driven top-up display, `priceUsd` fallback wiring, "12 months" expiry literal (dict 898), "Plus" tier name in creditGate copy, brand-page receipt mockup ($30.00), stale comments in PricingTiers.
Everything else (pricing cards, FAQ, in-app estimates, upgrade modals, welcome/receipt emails) is already dynamic and updates itself.

---

*Sources: vendor pricing pages verified live via Playwright 2026-07-07 (gamma.app, beautiful.ai, canva.com, presentations.ai, decktopus.com, pitch.com, plusai.com, mouj.ai, sharayeh.com); Anthropic model pricing via claude-api skill 2026-07-07; gpt-image-2 pricing via web search 2026-07-07 (~$0.053/image medium 1024x1024); prod DB queries against `Job`, `UsageEvent`, `Tier`, `Preset` tables 2026-07-07; freemium conversion benchmarks: userpilot/ChartMogul/ProfitWell 2025-26.*
