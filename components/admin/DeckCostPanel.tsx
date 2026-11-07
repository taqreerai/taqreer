// Admin > Compare: what this deck cost (lib/admin/deck-cost.ts). Server
// component: plain markup, no state. Admin pages are English-only.

import type { DeckCost } from "@/lib/admin/deck-cost";

function usd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function tok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const CELL = "px-3 py-2 text-start";
const NUM = "px-3 py-2 text-end tabular-nums";

export function DeckCostPanel({ cost }: { cost: DeckCost }) {
  return (
    <section className="surface-card flex flex-col gap-4 rounded-xl p-5" aria-label="Deck cost">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Cost of this deck</h2>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="text-muted">Real cost </span>
            <span className="font-semibold tabular-nums text-foreground">{usd(cost.totalUsd)}</span>
          </span>
          <span>
            <span className="text-muted">Credits charged </span>
            <span className="font-semibold tabular-nums text-foreground">
              {cost.creditsCharged.toLocaleString("en-US")}
            </span>
          </span>
        </p>
      </div>

      {cost.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--tq-border-hairline)] text-xs text-muted">
                <th className={CELL}>Step</th>
                <th className={CELL}>Model</th>
                <th className={NUM}>Calls</th>
                <th className={NUM}>In</th>
                <th className={NUM}>Out</th>
                <th className={NUM}>Cache read / write</th>
                <th className={NUM}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {cost.rows.map((r) => (
                <tr key={`${r.purpose}|${r.model}|${r.basis}`} className="border-b border-[var(--tq-border-hairline)]">
                  <td className={CELL}>
                    <span className="text-foreground">{r.label}</span>
                    {r.basis !== "per-call" ? (
                      <span className="ms-2 text-xs text-muted">
                        {r.basis === "estimate" ? "estimated rate" : "job totals"}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${CELL} text-muted`} dir="ltr">{r.model}</td>
                  <td className={NUM}>{r.calls}</td>
                  <td className={NUM}>{tok(r.inputTokens)}</td>
                  <td className={NUM}>{tok(r.outputTokens)}</td>
                  <td className={NUM}>
                    {tok(r.cacheReadTokens)} / {tok(r.cacheCreationTokens)}
                  </td>
                  <td className={`${NUM} font-medium text-foreground`}>{usd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No AI usage recorded for this deck.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted">Jobs and credits</h3>
          {cost.jobs.map((j, i) => (
            <p key={i} className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-foreground">
                {j.type} <span className="text-muted">· {j.model ?? j.quality ?? "?"} · {j.status}</span>
              </span>
              <span className="tabular-nums text-muted">
                {j.credits !== null ? `${j.credits.toLocaleString("en-US")} credits${j.creditStatus === "settled" ? "" : ` (${j.creditStatus})`}` : "no charge"}
              </span>
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-muted">Pictures</h3>
          {cost.images.length ? (
            cost.images.map((im) => (
              <p key={im.source} className="flex justify-between gap-2 text-sm">
                <span className="text-foreground">{im.source}</span>
                <span className="tabular-nums text-muted">{im.count}</span>
              </p>
            ))
          ) : (
            <p className="text-sm text-muted">None</p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted">
        Anthropic calls are priced per call at the API rates in lib/anthropic/pricing.ts.
        {cost.estimatedUsd > 0 ? ` AI pictures (${usd(cost.estimatedUsd)}) use estimated gpt-image rates.` : ""}
        {cost.perCallTracked
          ? ""
          : " This deck predates per-call tracking (2026-11-07): only writing and regeneration are counted, from their job totals; file reading, reviews and picture checks were not recorded."}
      </p>
    </section>
  );
}
