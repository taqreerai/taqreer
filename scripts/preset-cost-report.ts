// Preset cost report - read-only. Groups Job token telemetry by quality
// preset and prices it at the model's Anthropic rates, so preset credit
// pricing decisions run on measured data instead of samples.
//
//   npx tsx scripts/preset-cost-report.ts            # all completed jobs
//   npx tsx scripts/preset-cost-report.ts --since 2026-07-08
//
// Telemetry source: deck-generate writes model/quality/inputTokens/
// outputTokens/cacheReadTokens/cacheCreationTokens on the Job at
// completion. Cache pricing: per-model read rate (see RATES), 5-minute-TTL
// writes at 1.25x input (the pipeline's ephemeral cache).
import { prisma } from "../lib/prisma";

// Anthropic list prices, $ per MTok (verified 2026-10-14 against the current
// model table). Specific prefixes first: the first match wins, so a newer
// generation must precede its family prefix. cacheReadUsd is the cache-HIT rate
// (not always 0.1x input: Opus 5.5 is 0.05x, Fable 5.1 is 0.025x); cache WRITES
// (5-minute TTL) are 1.25x input for every model. Haiku 5.5 is priced for
// prompts up to 100K tokens ($0.50 / $2.50 beyond; no deck prompt gets there) and
// its cache-read rate is assumed 0.1x (not published in the table).
type Rate = { prefix: string; inUsd: number; outUsd: number; cacheReadUsd: number };
const RATES: Rate[] = [
  { prefix: "claude-fable", inUsd: 10, outUsd: 50, cacheReadUsd: 0.25 },
  { prefix: "claude-opus-5-5", inUsd: 4, outUsd: 20, cacheReadUsd: 0.2 },
  { prefix: "claude-opus", inUsd: 5, outUsd: 25, cacheReadUsd: 0.5 },
  { prefix: "claude-sonnet-5", inUsd: 2, outUsd: 10, cacheReadUsd: 0.2 }, // 5.5 and 5
  { prefix: "claude-sonnet", inUsd: 3, outUsd: 15, cacheReadUsd: 0.3 }, // 4.x
  { prefix: "claude-haiku-5", inUsd: 0.1, outUsd: 0.5, cacheReadUsd: 0.01 },
  { prefix: "claude-haiku", inUsd: 1, outUsd: 5, cacheReadUsd: 0.1 }, // 4.5
];
// Unknown model: price it as the dearest common family so a surprise reads high.
const FALLBACK_RATE: Rate = { prefix: "", inUsd: 5, outUsd: 25, cacheReadUsd: 0.5 };

function rateFor(model: string | null): Rate {
  return RATES.find((r) => model?.startsWith(r.prefix)) ?? FALLBACK_RATE;
}

async function main() {
  const sinceArg = process.argv.indexOf("--since");
  const since =
    sinceArg !== -1 && process.argv[sinceArg + 1]
      ? new Date(process.argv[sinceArg + 1])
      : null;

  const jobs = await prisma.job.findMany({
    where: {
      status: "succeeded",
      outputTokens: { gt: 0 },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: {
      type: true,
      quality: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });

  type Agg = {
    n: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    usd: number;
  };
  const byPreset = new Map<string, Agg>();
  for (const j of jobs) {
    const key = `${j.type} · ${j.quality ?? "unknown"} (${j.model ?? "?"})`;
    const agg =
      byPreset.get(key) ??
      ({ n: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 } as Agg);
    const r = rateFor(j.model);
    agg.n += 1;
    agg.input += j.inputTokens;
    agg.output += j.outputTokens;
    agg.cacheRead += j.cacheReadTokens;
    agg.cacheWrite += j.cacheCreationTokens;
    agg.usd +=
      (j.inputTokens / 1e6) * r.inUsd +
      (j.outputTokens / 1e6) * r.outUsd +
      (j.cacheReadTokens / 1e6) * r.cacheReadUsd +
      (j.cacheCreationTokens / 1e6) * r.inUsd * 1.25;
    byPreset.set(key, agg);
  }

  if (byPreset.size === 0) {
    console.log("No completed jobs with token telemetry in range.");
  }
  const rows = [...byPreset.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [key, a] of rows) {
    console.log(
      `${key}\n  decks: ${a.n}` +
        `\n  avg tokens/deck: in ${Math.round(a.input / a.n).toLocaleString("en-US")}` +
        ` | out ${Math.round(a.output / a.n).toLocaleString("en-US")}` +
        ` | cacheR ${Math.round(a.cacheRead / a.n).toLocaleString("en-US")}` +
        ` | cacheW ${Math.round(a.cacheWrite / a.n).toLocaleString("en-US")}` +
        `\n  avg cost/deck: $${(a.usd / a.n).toFixed(3)} | total: $${a.usd.toFixed(2)}\n`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
