"use client";

// Admin > Overview "Traffic by device / browser / OS" card. A small segmented
// toggle switches the breakdown; each is a list of labelled bars. Data is real
// (PostHog $device_type / $browser / $os), passed from the server page.

import { useState } from "react";
import type { DeviceBreakdowns } from "@/lib/analytics/posthog";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";

type TabKey = "device" | "browser" | "os";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "device", label: "Device" },
  { key: "browser", label: "Browser" },
  { key: "os", label: "OS" },
];

export function DeviceBreakdown({ data }: { data: DeviceBreakdowns }) {
  const [active, setActive] = useState<TabKey>("device");
  const rows = data[active];

  return (
    <div className="surface-card flex flex-1 flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Traffic by
        </span>
        <div
          className="flex gap-1 rounded-full p-0.5"
          style={{ background: "var(--tq-overlay-soft)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                color: active === t.key ? PRIMARY : MUTED,
                background: active === t.key ? "var(--tq-overlay)" : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>
          No traffic yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span
                className="w-20 flex-shrink-0 truncate text-sm"
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
                className="w-9 flex-shrink-0 text-end text-sm tabular-nums"
                style={{ color: MUTED }}
              >
                {d.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
