"use client";

// Dashboard-header status chip — reflects real upstream provider health
// (via useServerStatus → /api/status). A colored dot + Arabic label,
// linking to the live status page. Hidden while loading or when the
// status can't be determined (no fake "all good").

import { useServerStatus } from "@/lib/hooks/useServerStatus";
import type { ServerStatusLevel } from "@/lib/status/anthropic-status";

const META: Record<
  Exclude<ServerStatusLevel, "unknown">,
  { label: string; dot: string }
> = {
  operational: { label: "كل الأنظمة تعمل", dot: "bg-emerald-400" },
  degraded: { label: "أداء منخفض حالياً", dot: "bg-amber-400" },
  down: { label: "انقطاع في الخدمة", dot: "bg-red-400" },
};

export function ServerStatusChip() {
  const status = useServerStatus();
  if (!status || status.level === "unknown") return null;

  const meta = META[status.level];
  return (
    <a
      href="https://status.claude.com"
      target="_blank"
      rel="noopener noreferrer"
      title={status.description || meta.label}
      className="backdrop-blur-glass hidden items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white sm:flex"
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
      <span>{meta.label}</span>
    </a>
  );
}
