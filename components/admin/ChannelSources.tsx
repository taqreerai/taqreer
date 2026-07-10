// Admin > Overview "Traffic sources" card. Labelled bars (mirrors the
// DeviceBreakdown pattern), fed real PostHog data from the server page. Label
// = the actual source (utm_source or referring domain, normalized); the muted
// suffix is PostHog's $channel_type classification (Paid Search, Organic
// Social...). Distinguishes "not configured" (null) from "no traffic" (empty).

import type { ChannelRow } from "@/lib/analytics/posthog";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";

export function ChannelSources({ data }: { data: ChannelRow[] | null }) {
  return (
    <div className="surface-card flex flex-1 flex-col gap-4 rounded-xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Traffic sources
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
            <div
              key={`${d.label}|${d.channel}`}
              className="flex items-center gap-3"
            >
              <span className="w-40 flex-shrink-0 truncate text-sm">
                <span style={{ color: PRIMARY }}>{d.label}</span>
                {d.channel ? (
                  <span className="ms-1.5 text-xs" style={{ color: MUTED }}>
                    {d.channel}
                  </span>
                ) : null}
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
