"use client";

// Dashboard-header status chip — reflects real upstream provider health
// (via useServerStatus → /api/status). A colored dot + Arabic label,
// non-interactive (display only). Hidden while loading or when the
// status can't be determined (no fake "all good").

import { useServerStatus } from "@/lib/hooks/useServerStatus";
import type { ServerStatusLevel } from "@/lib/status/anthropic-status";

const META: Record<
  Exclude<ServerStatusLevel, "unknown">,
  { label: string; dot: string }
> = {
  operational: { label: "كل الأنظمة تعمل", dot: "bg-[var(--tq-status-ok-dot)]" },
  degraded: { label: "أداء منخفض حالياً", dot: "bg-[var(--tq-status-warn-dot)]" },
  down: { label: "انقطاع في الخدمة", dot: "bg-[var(--tq-status-down-dot)]" },
};

// `inline` (§20): the dashboard header is gone, so the status now lives as a
// row in the sidebar profile menu. The pill chrome (border + blur + bg) reads
// as heavy/cramped in a narrow menu, so the inline variant strips it to a bare
// dot + label and stays visible on every breakpoint (the pill is hidden < sm).
export function ServerStatusChip({ inline = false }: { inline?: boolean } = {}) {
  const status = useServerStatus();
  if (!status || status.level === "unknown") return null;

  const meta = META[status.level];

  if (inline) {
    return (
      <span className="flex items-center gap-2 text-xs text-white/70">
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
        <span>{meta.label}</span>
      </span>
    );
  }

  return (
    <span className="backdrop-blur-glass hidden items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 sm:flex">
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
      <span>{meta.label}</span>
    </span>
  );
}
