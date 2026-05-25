# Pricing & Token Economics

> Working document — point values, tier sizes, and cost estimates are **proposed**, not shipped. Code-side pricing system is not built yet. Update this file as the data sample grows.

## Anthropic API pricing reference

| Model | Input / MTok | Output / MTok | Cache read | Cache write (5min) |
|-------|--------------|---------------|------------|---------------------|
| Claude Opus 4.7 | $15 | $75 | $1.50 (0.1×) | $18.75 (1.25×) |
| Claude Sonnet 4.6 | $3 | $15 | $0.30 (0.1×) | $3.75 (1.25×) |

Output tokens include **thinking tokens** when `thinking: { type: "adaptive" }` is on — Claude is billed at the regular output rate for them. Cache writes are 5-minute TTL ephemeral.

---

## Current preset config (locked, 2026-05-25)

Source of truth: `lib/anthropic/quality-params.ts`. **Only these four presets exist in the codebase today** — the expanded matrix at the bottom is a reference for future expansion.

| Preset key | Display name (AR) | Model | Thinking | Effort |
|-----------|---------------------|--------------------|----------|--------|
| `fast` | سريع | claude-sonnet-4-6 | disabled | — |
| `medium` (default) | متوسط | claude-opus-4-7 | adaptive | low |
| `quality` | عالي | claude-opus-4-7 | adaptive | medium |
| `extreme` | متطرف | claude-opus-4-7 | adaptive | high |

### Measured cost (succeeded `deck.generate` jobs, 2026-05-25 DB snapshot)

| Preset | Sample size | Avg input | Avg output | Cache read | Cache write | **Avg $ / 8-slide run** |
|--------|-------------|-----------|------------|------------|-------------|--------------------------|
| Fast | 7 | 10,802 | 19,132 | 1,861 | 10,164 | **$0.36** |
| Medium | 4 | 11,750 | 29,702 | 0 | 4,686 | **$2.49** |
| Quality | 0 | — | — | — | — | *no data yet — interpolated ~$2.50* |
| Extreme | 7 | 10,479 | 28,932 | 2,083 | 11,882 | **$2.55** |

**Notes / caveats:**

- **Sample is tiny.** 18 total runs across 3 measured tiers. Variance is real — the max single-deck cost we've seen was ~$15 (extreme, long deck, multi-attempt). Don't lock pricing on this sample; keep collecting through `deck.generate` Job rows.
- **Medium / Quality / Extreme cost basically the same on Opus** despite different `effort` settings. Why: `adaptive` thinking lets Claude pick *what he needs*, not the ceiling. For our editorial-deck task, Claude rarely exceeds ~4k thinking even at `effort:high`. The thinking-budget ceilings are *upper bounds*, not commitments. Differentiation between Opus tiers is mostly **edge case behavior on complex slides**, not average cost.
- **`deck.regenerate.partial` ≠ deck.generate.** Regen is a separate Job type, costs roughly $0.10-0.79 depending on slides regenerated. Not folded into per-deck cost here — see "Regen overhead" section below.

### ⚠️ Known failure mode: `sonnet-fast` on source-document flows (enhance / mimic / data)

Observed 2026-05-25: a 9-slide enhance run on `sonnet-fast` (Sonnet 4.6 + thinking disabled) failed `JSON.parse` 3 times at position ~31417 with `Expected ',' or '}' after property value`. The retry loop burned ~30k output tokens per attempt with no recoverable result. Root cause: Sonnet without extended thinking loses JSON-structure discipline deep into 30+ KB structured outputs — typical of long verbatim flows where Claude has to emit dense HTML/SVG/inline-styles for 9+ slides.

**Mitigations shipped in the same fix:**

1. **`lib/extract/json-repair.ts`** — string-aware repair pass that runs BEFORE `JSON.parse()`. Handles trailing commas + missing-comma-between-adjacent-properties without damaging HTML payload content. If raw parse fails, repair pass is attempted; if both fail, diagnostic logging captures head/tail of the JSON for pattern matching.
2. **Auto-upgrade in `deck-generate.ts`** — when `source.kind` is `enhance | mimic | data` AND `quality === "sonnet-fast"`, the actual Claude call quietly upgrades to `sonnet-low` (adds adaptive thinking, ~$0.05 more per run). `Job.quality` keeps the user's original choice for analytics; only `paramsForQuality()`'s input is upgraded.

**What's still risky:**
- The `sonnet-low/medium/high/max` configs are untested for long enhance outputs. Auto-upgrade lands users on `sonnet-low` but we have **zero data** showing it's reliable. Worth running test generations on each Sonnet thinking tier (`sonnet-low` through `sonnet-max`) against the same 9-slide enhance source the failing run used.
- `sonnet-fast` is still fine for **create-flow** (no PDF, shorter outputs, ~5-8k tokens total). The upgrade only fires on source-document flows.

---

## Proposed point system (NOT shipped)

### Formula

```
points = base[preset] + (slides × perSlide[preset])
```

### Values (Plan: 1 point ≈ $0.012 retail → ~3× markup over actual cost)

| Preset | base | + perSlide | 8-slide pts | Actual $ cost | $/pt retail | Margin |
|--------|------|------------|--------------|----------------|--------------|--------|
| Fast | 20 | 10 | **100** | $0.36 | $0.012 | 3.3× |
| Medium | 100 | 50 | **500** | $2.49 | $0.012 | 2.4× |
| Quality | 120 | 55 | **560** | ~$2.50 | $0.012 | 2.7× |
| Extreme | 150 | 60 | **630** | $2.55 | $0.012 | 3.0× |

### Tier math (proposed Plus = 1,000 pts / month)

| Preset | Pts / 8-slide deck | Decks / month | With regen overhead | Daily cadence |
|--------|---------------------|---------------|----------------------|----------------|
| Fast | 100 | 10 | ~8 | 1 every 4 days |
| Medium | 500 | 2 | ~1.6 | 1 every 19 days |
| Quality | 560 | 1.8 | ~1.4 | 1 every 21 days |
| Extreme | 630 | 1.6 | ~1.2 | 1 every 25 days |

**Implication:** Plus at 1,000 pts is effectively a Fast-tier subscription. Opus access is symbolic at this volume. Decisions to make before launching:

- **(A)** Position Plus as "Fast-tier-only" honestly, push Opus into Pro+.
- **(B)** Bump Plus to ~3,000 pts so a Plus user gets ~5 Medium decks / mo.
- **(C)** Gate access (Plus = Fast + Medium only, Pro adds Quality, Ultra adds Extreme) — like Gamma's tier-gated AI models.
- **(D)** Drop a redundant Opus tier — Medium/Quality/Extreme cost roughly the same to us; menu simplification.

### Regen overhead

| Regen sample | Model | Quality | Sample | Avg $ / regen |
|--------------|-------|---------|--------|---------------|
| Opus regen | opus-4-7 | extreme | 1 | $0.79 |
| Opus regen | opus-4-7 | medium | 7 | $0.68 |
| Sonnet regen | sonnet-4-6 | fast | 2 | $0.10 |
| Sonnet regen | sonnet-4-6 | medium | 6 | $0.16 |

Empirical regen-per-deck ratio: **0.76** (16 regens / 21 generates). A "realistic" per-deck cost for budgeting purposes ≈ initial-gen cost × 1.3 (gen + ~0.3 of a regen averaged across decks).

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

### Sonnet 4.6 variants (5 configs)

| Config name | Model | Thinking | Effort | Est. $ / 8-slide | Notes |
|-------------|-------|----------|--------|--------------------|--------|
| `sonnet-4.6-fast` | claude-sonnet-4-6 | disabled | — | **~$0.36** | Current `fast` preset. Measured. |
| `sonnet-4.6-low` | claude-sonnet-4-6 | adaptive | low | ~$0.40-0.45 | Untested. Adaptive on Sonnet was historically unpredictable on multi-slide JSON (see quality-params.ts header comment 2026-05-24). |
| `sonnet-4.6-medium` | claude-sonnet-4-6 | adaptive | medium | ~$0.50-0.60 | Untested. |
| `sonnet-4.6-high` | claude-sonnet-4-6 | adaptive | high | ~$0.65-0.80 | Untested. |
| `sonnet-4.6-max` | claude-sonnet-4-6 | adaptive | max | ~$0.90-1.20 | Untested. Likely diminishing returns vs Opus tiers at this cost. |

### Opus 4.7 variants (6 configs)

| Config name | Model | Thinking | Effort | Est. $ / 8-slide | Notes |
|-------------|-------|----------|--------|--------------------|--------|
| `opus-4.7-fast` | claude-opus-4-7 | disabled | — | ~$1.80-2.10 | Untested. Cheapest Opus tier. Output-only premium, no reasoning. |
| `opus-4.7-low` | claude-opus-4-7 | adaptive | low | **~$2.49** | Current `medium` preset. Measured. |
| `opus-4.7-medium` | claude-opus-4-7 | adaptive | medium | **~$2.50** | Current `quality` preset. *No measured data yet — gather.* |
| `opus-4.7-high` | claude-opus-4-7 | adaptive | high | **~$2.55** | Current `extreme` preset. Measured. |
| `opus-4.7-xhigh` | claude-opus-4-7 | adaptive | xhigh | ~$2.70-3.50 | Untested. Opus-only effort tier. |
| `opus-4.7-max` | claude-opus-4-7 | adaptive | max | ~$3.20-4.50+ | Untested. Unconstrained ceiling — Claude may go deep on hard slides. |

### Suggested point cost — full expanded matrix

If we ever expose all 11 configs as user-pickable presets (we won't — too many choices is bad UX), here's where point pricing would land at 3× markup:

| Config | Est. $ cost | Suggested pts (base + per-slide) | 8-slide pts |
|--------|-------------|---------------------------------|-------------|
| sonnet-4.6-fast | $0.36 | 20 + 10/slide | 100 |
| sonnet-4.6-low | $0.42 | 25 + 12/slide | 121 |
| sonnet-4.6-medium | $0.55 | 35 + 15/slide | 155 |
| sonnet-4.6-high | $0.72 | 50 + 20/slide | 210 |
| sonnet-4.6-max | $1.05 | 80 + 30/slide | 320 |
| opus-4.7-fast | $1.95 | 80 + 40/slide | 400 |
| opus-4.7-low | $2.49 | 100 + 50/slide | 500 |
| opus-4.7-medium | $2.50 | 120 + 55/slide | 560 |
| opus-4.7-high | $2.55 | 150 + 60/slide | 630 |
| opus-4.7-xhigh | $3.10 | 180 + 75/slide | 780 |
| opus-4.7-max | $3.85 | 220 + 95/slide | 980 |

**This matrix is for reference, not for shipping.** Exposing 11 user-pickable knobs would be a UX disaster. Pick 3-5 from this matrix to be the user-facing presets, hide the rest as internal tuning.

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
