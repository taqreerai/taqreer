// Preset cost report - read-only. Groups Job token telemetry by quality
// preset and prices it at the model's Anthropic rates, so preset credit
// pricing decisions run on measured data instead of samples.
//
//   npx tsx scripts/preset-cost-report.ts            # all completed jobs
//   npx tsx scripts/preset-cost-report.ts --since 2026-07-08
//
// Telemetry source: deck-generate writes model/quality/inputTokens/
// outputTokens/cacheReadTokens/cacheCreationTokens on the Job at
// completion. Cache pricing: reads at 0.1x input, 5-minute-TTL writes at
// 1.25x input (the pipeline's ephemeral cache).
import { prisma } from "../lib/prisma";

// $ per MTok by model prefix; extend as models enter the preset matrix.
const RATES: Array<{ prefix: string; inUsd: number; outUsd: number }> = [
  { prefix: "claude-opus", inUsd: 5, outUsd: 25 },
  { prefix: "claude-fable", inUsd: 10, outUsd: 50 },
  { prefix: "claude-sonnet", inUsd: 3, outUsd: 15 },
  { prefix: "claude-haiku", inUsd: 1, outUsd: 5 },
];

function rateFor(model: string | null) {
  return RATES.find((r) => model?.startsWith(r.prefix)) ?? RATES[0];
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
      (j.cacheReadTokens / 1e6) * r.inUsd * 0.1 +
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
