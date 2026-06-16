"use client";

// Admin > Overview. Static Phase-0 screen: KPI cards, users-by-plan split,
// live online users + a world map, and a recent-activity feed. All data is
// mock (lib/admin/mock.ts); the wiring phase swaps the source, not the UI.
// English-only, dark-only, LTR (forced by the admin layout).

import {
  MOCK_STATS,
  MOCK_PLAN_SPLIT,
  MOCK_ACTIVITY,
  PLAN_LABEL,
  type AdminStat,
  type ActivityItem,
  type Plan,
} from "@/lib/admin/mock";
import { IconCircle } from "@/components/admin/IconCircle";
import { DeviceBreakdown } from "@/components/admin/DeviceBreakdown";
import dynamic from "next/dynamic";

// Client-only (WebGL / three.js): ssr:false so globe.gl never runs on the server.
const LiveGlobePanel = dynamic(
  () =>
    import("@/components/admin/LiveGlobePanel").then((m) => m.LiveGlobePanel),
  {
    ssr: false,
    loading: () => <div style={{ minHeight: 360 }} />,
  },
);

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 96;
  const h = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true">
      <polyline
        points={pts}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({ stat }: { stat: AdminStat }) {
  const down = stat.trend === "down";
  return (
    <div className="surface-card flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm" style={{ color: MUTED }}>
          {stat.label}
        </span>
        {stat.delta ? (
          <span
            className="text-xs font-medium"
            style={{ color: down ? MUTED : ACCENT }}
          >
            {stat.delta}
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-bold" style={{ color: PRIMARY }}>
        {stat.value}
      </div>
      <Sparkline data={stat.spark} color={down ? MUTED : ACCENT} />
    </div>
  );
}

function PlanSplit({ split }: { split: Record<Plan, number> }) {
  const order: Plan[] = ["free", "plus", "pro", "max"];
  const total = order.reduce((sum, p) => sum + split[p], 0) || 1;
  // Single blue accent, opacity ramp by tier (flat system, one accent).
  const opacity: Record<Plan, number> = { free: 0.3, plus: 0.55, pro: 0.78, max: 1 };
  return (
    <div className="surface-card flex flex-1 flex-col gap-4 rounded-xl p-5">
      <span className="text-sm font-medium" style={{ color: PRIMARY }}>
        Users by plan
      </span>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        style={{ background: "var(--tq-overlay-soft)" }}
      >
        {order.map((p) => (
          <div
            key={p}
            style={{
              width: `${(split[p] / total) * 100}%`,
              background: ACCENT,
              opacity: opacity[p],
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {order.map((p) => (
          <div key={p} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2" style={{ color: MUTED }}>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: ACCENT, opacity: opacity[p] }}
              />
              {PLAN_LABEL[p]}
            </span>
            <span style={{ color: PRIMARY }}>{split[p].toLocaleString("en-US")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityItem["kind"], string> = {
  signup: "person_add",
  generation: "auto_awesome",
  purchase: "payments",
};

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="surface-card rounded-xl p-5">
      <span className="text-sm font-medium" style={{ color: PRIMARY }}>
        Recent activity
      </span>
      <div className="mt-2 flex flex-col">
        {items.map((it, i) => (
          <div
            key={it.id}
            className="flex items-center gap-3 py-3"
            style={
              i === items.length - 1
                ? undefined
                : { borderBottom: "1px solid var(--tq-border-hairline)" }
            }
          >
            <IconCircle icon={ACTIVITY_ICON[it.kind]} size={32} />
            <span className="flex-1 text-sm" style={{ color: PRIMARY }}>
              {it.text}
            </span>
            <span className="text-xs" style={{ color: MUTED }}>
              {it.at}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {MOCK_STATS.map((stat) => (
          <StatCard key={stat.key} stat={stat} />
        ))}
      </div>

      {/* Live online + map (2/3) and plan split (1/3) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="surface-card rounded-xl p-5 lg:col-span-3">
          <LiveGlobePanel />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <DeviceBreakdown />
          <PlanSplit split={MOCK_PLAN_SPLIT} />
        </div>
      </div>

      {/* Activity */}
      <ActivityFeed items={MOCK_ACTIVITY} />
    </div>
  );
}
