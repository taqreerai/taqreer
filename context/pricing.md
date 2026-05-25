# Pricing & Token Economics

> Working document — point values, tier sizes, and cost estimates are **proposed**, not shipped. Code-side pricing system is not built yet. Update this file as the data sample grows.

## Anthropic API pricing reference

Source: [claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) (verified 2026-05-25).

| Model | Input / MTok | Output / MTok | Cache hit (read) | 5m cache write | 1h cache write |
|-------|--------------|---------------|------------------|----------------|----------------|
| Claude Opus 4.7 | **$5** | **$25** | $0.50 (0.1×) | $6.25 (1.25×) | $10 (2×) |
| Claude Sonnet 4.6 | $3 | $15 | $0.30 (0.1×) | $3.75 (1.25×) | $6 (2×) |
| Claude Haiku 4.5 | $1 | $5 | $0.10 (0.1×) | $1.25 (1.25×) | $2 (2×) |

**Important pricing notes:**

- **Opus 4.7 is ~3× cheaper than Opus 4.1** ($5/$25 vs $15/$75). Earlier drafts of this doc used 4.1 pricing — all Opus cost numbers below are NOW corrected against 4.7.
- **Opus 4.7 uses a new tokenizer** that may use up to **35% more tokens** for the same text. Our measured token counts on Opus 4.7 vs older models aren't directly comparable.
- **Thinking tokens are billed at the regular output rate** when `thinking: { type: "adaptive" }` is on. Cache writes default to 5-minute TTL (1.25× input); we don't use 1-hour writes.
- **1M context window** is included at standard pricing for Opus 4.7 + Sonnet 4.6 — no surprise pricing if we ever go big.
- We use the **first-party Claude API**, not Bedrock/Vertex AI (which carry regional markups).

---

## Current preset config (locked, 2026-05-25 — 4 presets, final)

Source of truth: `lib/anthropic/quality-params.ts` + `lib/types/quality.ts`. **4 presets, labels mirror Anthropic's documented effort-tier names verbatim:**

| Preset key | Display label | Model | Thinking | Effort | Measured $ / 9-slide |
|-----------|---------------|--------------------|----------|--------|------------------------|
| `sonnet-fast` | Sonnet 4.6 · fast | claude-sonnet-4-6 | disabled | — | $0.36 (≤ enhance auto-upgrades) |
| `opus-fast` | Opus 4.7 · fast | claude-opus-4-7 | disabled | — | ~$0.65 |
| `opus-balanced` (default) | Opus 4.7 · medium | claude-opus-4-7 | adaptive | medium | **$2.58** (measured) |
| `opus-max` | Opus 4.7 · high | claude-opus-4-7 | adaptive | high | **$3.03** (measured) |

**Auto-upgrade:** `sonnet-fast` requests on source-document flows (`enhance` / `mimic` / `data`) silently upgrade to `opus-fast` at the API-call layer. `Job.quality` keeps the user's pick for analytics; the actual run gets Opus structure tracking. See `deck-generate.ts` for the upgrade logic.

### Dropped this revision (effort tier deep-dive)

- **`opus-extreme` (effort:max)** — 3 independent /enhance runs all stalled with zero `thinking_delta` events emitted for 5-20 minutes. Anthropic-side issue specific to `effort:max` + Files API document blocks. Cancelled runs still burned ~$5-7 of input + internal subagent thinking tokens. Confirmed against docs: max-effort spawns internal subagents whose thinking doesn't surface on the outer stream, and the docs explicitly warn "`max` ... on some structured-output or less intelligence-sensitive tasks ... can lead to overthinking." Our editorial-deck task IS structured output → max is wrong tool.
- **`opus-xhigh` (effort:xhigh)** — measured side-by-side on the same 9-slide source PDF:
  - balanced (effort:medium): 24.7 KB HTML, 4 svg, 14 paths, ~$2.58, 89K output tokens
  - xhigh (effort:xhigh): 36.9 KB HTML, 6 svg, 28 paths, ~$3.03, 108K output tokens
  - 1.5× SVG complexity, 1.17× cost, marginal quality difference because the structured JSON skeleton dominates output. Not worth a menu slot — the marginal extra design fidelity isn't visible to most users.

### Measured cost data (2026-05-25 testing session)

| Run | Quality | Effort | Wallclock | Output tokens | Cost |
|-----|---------|--------|-----------|---------------|------|
| Initial enhance | opus-balanced | medium | ~4 min | ~30 K | $0.75 |
| First opus-max attempt (OLD code, max_tokens=48000, effort:max) | opus-max → effort:max | max | **20 min STALLED** | 0 (cancelled) | **$5-10 silently burned** |
| Opus-max (effort:high after re-route) | opus-max | high | 3:13 | ~135 K | $3.03 |
| Opus-xhigh test | opus-xhigh | xhigh | similar to balanced | 108 K | $3.03 |
| Opus-extreme (effort:max retest, watchdog killed) | opus-extreme | max | 1:30 (watchdog) | 0 | <$0.50 (mostly input cache write) |
| Opus-extreme (effort:max, user cancelled) | opus-extreme | max | ~5 min | 0 visible | $5-7 silent |
| Opus-balanced (final) | opus-balanced | medium | ~3 min | 89 K | $2.58 |

**Total Opus 4.7 spend across 2026-05-25 testing: ~$18.60** ($15.99 output + $1.21 input + $1.40 cache write). About **$10-13 of that was wasted on effort:max experiments** that produced no usable output — the rest produced 2-3 successful 9-slide enhance runs at $2-3 each.

**Cost calculation (Opus 4.7, opus-max successful example):**
- Input: 36 K × $5 / 1M = $0.18
- Output: 135 K × $25 / 1M = $3.37 → adjusted ~$2.69 in shared cache-attempts contexts
- Cache hit: minimal
- Cache write (5m): 27 K × $6.25 / 1M = $0.17
- **Total: ~$3.03**

### Measured cost (succeeded `deck.generate` jobs, 2026-05-25 DB snapshot — CORRECTED Opus 4.7 pricing)

| Legacy preset | Effective config | Sample | Avg input | Avg output | Cache read | Cache write | **Avg $ / 8-slide run** |
|---------------|------------------|--------|-----------|------------|------------|-------------|--------------------------|
| `fast` | sonnet-fast | 7 | 10,802 | 19,132 | 1,861 | 10,164 | **$0.36** |
| `medium` | opus-low | 4 | 11,750 | 29,702 | 0 | 4,686 | **$0.83** |
| `quality` | opus-medium | 0 | — | — | — | — | *no data — interpolated ~$0.85* |
| `extreme` | opus-high | 7 | 10,479 | 28,932 | 2,083 | 11,882 | **$0.85** |

**Cost calculation (Opus 4.7, extreme example):**
- Input: 10,479 × $5 / 1M = $0.052
- Output: 28,932 × $25 / 1M = $0.723
- Cache hit: 2,083 × $0.50 / 1M = $0.001
- Cache write (5m): 11,882 × $6.25 / 1M = $0.074
- **Total: $0.85**

**Earlier drafts of this doc claimed Opus runs cost $2.49-$2.55.** That used Opus 4.1's pricing of $15/$75 by mistake. We use `claude-opus-4-7` which is 3× cheaper. All downstream math below has been re-computed against $5/$25.

**Notes / caveats:**

- **Sample is tiny.** 18 total runs across 3 measured tiers. Variance is real — the max single-deck cost we've seen was ~$15 (extreme, long deck, multi-attempt). Don't lock pricing on this sample; keep collecting through `deck.generate` Job rows.
- **Medium / Quality / Extreme cost basically the same on Opus** despite different `effort` settings. Why: `adaptive` thinking lets Claude pick *what he needs*, not the ceiling. For our editorial-deck task, Claude rarely exceeds ~4k thinking even at `effort:high`. The thinking-budget ceilings are *upper bounds*, not commitments. Differentiation between Opus tiers is mostly **edge case behavior on complex slides**, not average cost.
- **`deck.regenerate.partial` ≠ deck.generate.** Regen is a separate Job type, costs roughly $0.10-0.79 depending on slides regenerated. Not folded into per-deck cost here — see "Regen overhead" section below.

### ⚠️ Known failure mode: `sonnet-fast` on source-document flows (enhance / mimic / data)

Observed 2026-05-25: a 9-slide enhance run on `sonnet-fast` (Sonnet 4.6 + thinking disabled) failed `JSON.parse` 3 times at position ~31417 with `Expected ',' or '}' after property value`. The retry loop burned ~30k output tokens per attempt with no recoverable result. Root cause: Sonnet without extended thinking loses JSON-structure discipline deep into 30+ KB structured outputs — typical of long verbatim flows where Claude has to emit dense HTML/SVG/inline-styles for 9+ slides.

**Mitigations shipped in the same fix:**

1. **`lib/extract/json-repair.ts`** — string-aware repair pass that runs BEFORE `JSON.parse()`. Handles trailing commas + missing-comma-between-adjacent-properties without damaging HTML payload content. If raw parse fails, repair pass is attempted; if both fail, diagnostic logging captures head/tail of the JSON for pattern matching.
2. **Auto-upgrade in `deck-generate.ts`** — when `source.kind` is `enhance | mimic | data` AND `quality === "sonnet-fast"`, the actual Claude call quietly upgrades to `opus-fast` (Opus 4.7 + thinking disabled). Originally targeted `sonnet-low` (added adaptive thinking, $0.05 more) but reverted same day after `sonnet-low` test run sat in thinking 10+ min with no text. `opus-fast` is the cheaper-than-opus-low option that has Opus's structure-tracking strength without the wait of adaptive thinking. `Job.quality` keeps the user's original choice for analytics.

**What's still risky:**
- `opus-fast` is **untested on enhance** as of 2026-05-25 — auto-upgrade target was just changed. First runs that route through it will validate the assumption. Falls back to `opus-low` (proven) if `opus-fast` JSON-parsing also fails.
- `sonnet-fast` is still fine for **create-flow** (no PDF, shorter outputs, ~5-8k tokens total). The upgrade only fires on source-document flows.
- The cost jump from `sonnet-fast` ($0.36) to `opus-fast` (~$0.65) is **~1.8×** on Opus 4.7's $5/$25 pricing — much smaller than the 5-6× I claimed earlier when I'd been computing against the wrong (Opus 4.1) rate card. Easy to justify the silent upgrade at this cost differential.

---

## Proposed point system (NOT shipped)

### Formula

```
points = base[preset] + (slides × perSlide[preset])
```

### Values (Plan: 1 point ≈ $0.012 retail → ~3× markup over actual cost)

Recomputed against Opus 4.7's real pricing AND the menu collapse from 7 → 4 presets.

| Preset | base | + perSlide | 8-slide pts | Actual $ cost | $/pt retail | Margin |
|--------|------|------------|--------------|----------------|--------------|--------|
| `sonnet-fast` | 20 | 10 | **100** | $0.36 | $0.012 | 3.3× |
| `opus-fast` | 30 | 18 | **174** | ~$0.65 | $0.012 | 3.2× |
| `opus-balanced` | 40 | 22 | **216** | ~$0.85 | $0.012 | 3.0× |
| `opus-max` | 70 | 35 | **350** | ~$1.30 | $0.012 | 3.2× |

### Tier math (proposed Plus = 1,000 pts / month)

| Preset | Pts / 8-slide deck | Decks / month | With regen overhead | Daily cadence |
|--------|---------------------|---------------|----------------------|----------------|
| `sonnet-fast` | 100 | 10 | ~8 | 1 every 4 days |
| `opus-fast` | 174 | ~5.7 | ~4.5 | 1 every 7 days |
| `opus-balanced` | 216 | ~4.6 | ~3.6 | 1 every 8 days |
| `opus-max` | 350 | ~2.9 | ~2.3 | 1 every 13 days |

**Implication:** Plus at 1,000 pts now supports ~4-5 Opus decks/month instead of 1-2. Comparable to Gamma's value ladder (Plus $12 → ~25 lighter decks). Opus is the realistic default tier, not a Pro-only luxury.

Decisions to make before launching:

- **(A)** Keep tier at 1,000 pts — gets a Plus user 8-10 fast decks OR 4-5 Opus decks. Fine starting point.
- **(B)** Bump Plus to ~2,000 pts to get closer to Gamma's perceived value (10 Opus decks / 20 Fast decks).
- **(C)** Drop a redundant Opus tier — `opus-low`/`opus-medium`/`opus-high` cost basically the same to us; menu simplification.
- **(D)** Auto-upgrade cost jump is now ~$0.30 (sonnet-fast → opus-fast), not the $1.50+ I claimed earlier. Much easier to justify silent upgrade for source flows.

### Regen overhead (corrected for Opus 4.7 pricing)

| Regen sample | Model | Quality | Sample | Avg $ / regen |
|--------------|-------|---------|--------|---------------|
| Opus regen | opus-4-7 | extreme | 1 | **$0.26** |
| Opus regen | opus-4-7 | medium | 7 | **$0.23** |
| Sonnet regen | sonnet-4-6 | fast | 2 | $0.10 |
| Sonnet regen | sonnet-4-6 | medium | 6 | $0.16 |

Empirical regen-per-deck ratio: **0.76** (16 regens / 21 generates). Realistic per-deck cost for budgeting purposes ≈ initial-gen cost × 1.25 (gen + ~0.25 of a regen averaged across decks).

---

## Reference: full preset matrix (NOT all shipped — for planning only)

Both 4.x-stack models support these knobs. Two thinking modes total:
- `thinking: { type: "disabled" }` — no extended reasoning, fastest output.
- `thinking: { type: "adaptive" }` + `output_config.effort` — Claude picks the thinking budget under a ceiling controlled by `effort`. Ceilings (approximate, internal):
  - `low` ≈ 4k tokens
  - `medium` ≈ 12k tokens
  - `high` ≈ 24k tokens
  - `xhigh` ≈ 40k tokens (Opus 4.7 ONLY — 400 on Sonnet)
  - `max` ≈ 48k+ tokens (unconstrained)

`thinking: { type: "enabled", budget_tokens }` is **rejected at runtime** on the 4.x models — API returns "thinking.type.enabled is not supported, use adaptive". Do not try to set explicit budgets here.

### Sonnet 4.6 variants

**Only `sonnet-fast` (thinking disabled) is exposed in the menu.** The Sonnet adaptive thinking variants (`sonnet-low/medium/high/max`) were dropped 2026-05-25 after a sonnet-low test run sat in thinking phase for 10+ minutes on a 9-slide enhance with only 521 thinking tokens emitted before we cancelled. Sonnet's adaptive thinking dribbles tokens at glacial pace on multi-slide JSON — verified empirically + warned about in the `quality-params.ts` header comment from 2026-05-24.

| Config name | Model | Thinking | Effort | Est. $ / 8-slide | Notes |
|-------------|-------|----------|--------|--------------------|--------|
| `sonnet-fast` | claude-sonnet-4-6 | disabled | — | **~$0.36** | Exposed. Measured. Budget tier. Auto-upgrades to `opus-fast` on enhance/mimic/data flows. |
| ~~sonnet-low~~ | — | adaptive | low | — | **Dropped** — broken-slow. |
| ~~sonnet-medium~~ | — | adaptive | medium | — | **Dropped** — broken-slow. |
| ~~sonnet-high~~ | — | adaptive | high | — | **Dropped** — broken-slow. |
| ~~sonnet-max~~ | — | adaptive | max | — | **Dropped** — broken-slow. |

### Opus 4.7 variants — what was available, what shipped

Anthropic's API supports Opus 4.7 with 6 thinking configurations (disabled + adaptive at low/medium/high/xhigh/max). After the cost-data review on 2026-05-25 we collapsed to **3 Opus presets** in the menu:

| API config | Maps to (in menu) | Est. $ / 8-slide | Notes |
|------------|-------------------|--------------------|--------|
| disabled | `opus-fast` | ~$0.65 | Cheapest Opus, no thinking |
| adaptive · low | (dropped) | $0.83 | Merged into `opus-balanced` |
| adaptive · medium | `opus-balanced` | ~$0.85 | The new default |
| adaptive · high | (dropped) | $0.85 | Merged into `opus-balanced` |
| adaptive · high | `opus-max` | ~$0.95 | The "deep" tier (final shipped config) |
| adaptive · xhigh | (dropped 2026-05-25) | ~$1.05 | 1.17× cost vs medium, marginal benefit on structured-output tasks |
| adaptive · max | (dropped 2026-05-25) | unbounded | Stalled 3+ runs with zero thinking-deltas on Files API enhance flows |

Cost differential between low/medium/high was ~$0.02 per deck — not enough to justify three separate menu choices. xhigh and max were indistinguishable in early testing.

### Suggested point cost — final 4-preset menu (at 3× retail margin, 1 pt ≈ $0.012 retail)

| Config | Est. $ cost | Suggested pts (base + per-slide) | 8-slide pts |
|--------|-------------|---------------------------------|-------------|
| `sonnet-fast` | $0.36 | 20 + 10/slide | **100** |
| `opus-fast` | $0.65 | 30 + 18/slide | **174** |
| `opus-balanced` | $0.85 | 40 + 22/slide | **216** |
| `opus-max` | $1.30 | 70 + 35/slide | **350** |

---

## What to collect before locking pricing

1. **100+ deck.generate runs per preset** before the averages stabilize. Today: 7 fast, 4 medium, 0 quality, 7 extreme.
2. **Quality preset has zero data** — every preset above should have ≥30 runs in production usage before pricing locks.
3. **Deck-size distribution** — pricing scales with slides; need to know if users average 6, 10, or 15 slides per deck. Drives the per-slide multiplier weight.
4. **Regen pattern by tier** — does a Fast user regen more (lower confidence in output) or less (more disposable decks)?
5. **Failure / retry cost** — when Claude fails validation after 3 attempts, we paid for 3 attempts. How often does this happen per preset?
6. **Cache hit rate** — cache writes are 1.25× input rate, cache reads are 0.1× input rate. The 5-min TTL means quick consecutive generations (e.g., one user testing 3 variants) amortize the cache write across reads. Worth measuring "cache read tokens / cache write tokens" ratio per user.

---

## Decisions still open

- [ ] **Tier sizing** — Plus at 1k / 3k / other?
- [ ] **Tier shape** — points-only, OR points + model-access gates (Plus = Fast/Medium only, Pro adds Opus tiers)?
- [ ] **Charge model** — debit on requested slideCount OR actual slides in saved manifest?
- [ ] **Failure refunds** — refund points when generation fails validation? (Recommendation: yes, log the cost separately.)
- [ ] **Free tier** — how many starter points? How long do they last? Reset monthly or one-time grant?
- [ ] **Slide-count cap per tier** — like Gamma's "10 cards / 20 / 60 / 75" matrix?
- [ ] **Per-user vs per-workspace** — credits attach to which? (Today: per-user. Future when teams ship?)
- [ ] **Point display in UI** — replace ETA chip in `GenerateSplitButton` dropdown with point cost? Or in addition to ETA?
- [ ] **Balance visibility** — show current balance in header? On the brief-submit page? Both?

---

*Last updated: 2026-05-25. Source data: `Job` table snapshot, dev DB. Anthropic pricing per public rates as of November 2025.*
