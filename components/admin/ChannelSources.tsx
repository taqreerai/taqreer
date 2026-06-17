// Admin > Overview "Sources by channel" card. Labelled bars (mirrors the
// DeviceBreakdown pattern), fed real PostHog data from the server page. Channel
// = PostHog's $channel_type (Direct, Organic Search, Paid Social, Referral...).
// Distinguishes "not configured" (null) from "no traffic yet" (empty).

import type { ChannelRow } from "@/lib/analytics/posthog";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";

export function ChannelSources({ data }: { data: ChannelRow[] | null }) {
  return (
    <div className="surface-card flex flex-1 flex-col gap-4 rounded-xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Sources by channel
        </span>
        <span className="text-xs" style={{ color: MUTED }}>
          30d
        </span>
      </div>

      {data === null ? (
        <p className="text-sm" style={{ color: MUTED }}>
          Analytics not configured.
        </p>
      ) : data.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>
          No traffic yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span
                className="w-28 flex-shrink-0 truncate text-sm"
                style={{ color: PRIMARY }}
              >
                {d.label}
              </span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--tq-overlay-soft)" }}
              >
                <div
                  style={{ width: `${d.pct}%`, height: "100%", background: ACCENT }}
                />
              </div>
              <span
                className="w-12 flex-shrink-0 text-end text-sm tabular-nums"
                style={{ color: MUTED }}
              >
                {d.visitors.toLocaleString("en-US")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
