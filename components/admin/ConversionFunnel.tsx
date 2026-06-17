// Admin > Overview "Conversion funnel" card. Four ordered steps
// (Signed up -> Created a deck -> Exported -> Purchased), 30-day window, fed by
// PostHog's windowFunnel (lib/analytics/posthog.ts getFunnel). Each bar narrows
// relative to step 1; the trailing number is the count + conversion % from the
// previous step.

import type { FunnelStep } from "@/lib/analytics/posthog";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";

export function ConversionFunnel({ data }: { data: FunnelStep[] | null }) {
  const top = data?.[0]?.count ?? 0;

  return (
    <div className="surface-card flex flex-col gap-4 rounded-xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Conversion funnel
        </span>
        <span className="text-xs" style={{ color: MUTED }}>
          30d
        </span>
      </div>

      {data === null ? (
        <p className="text-sm" style={{ color: MUTED }}>
          Analytics not configured.
        </p>
      ) : top === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>
          No funnel data yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((step, i) => {
            const widthPct = top > 0 ? Math.max(2, (step.count / top) * 100) : 0;
            const prev = i > 0 ? data[i - 1].count : null;
            const stepConv =
              prev && prev > 0 ? Math.round((step.count / prev) * 100) : null;
            return (
              <div key={step.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: PRIMARY }}>{step.label}</span>
                  <span className="tabular-nums" style={{ color: MUTED }}>
                    {step.count.toLocaleString("en-US")}
                    {stepConv !== null ? ` · ${stepConv}%` : ""}
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: "var(--tq-overlay-soft)" }}
                >
                  <div
                    style={{
                      width: `${widthPct}%`,
                      height: "100%",
                      background: ACCENT,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
