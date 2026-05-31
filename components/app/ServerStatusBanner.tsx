"use client";

// Pre-generate warning banner shown at the top of the generation flows
// (create / enhance / mimic / datasheet) ONLY when the upstream provider
// is actually degraded or down (via useServerStatus → /api/status).
// Renders nothing on a healthy day, so it never nags falsely.

import { useServerStatus } from "@/lib/hooks/useServerStatus";

const COPY = {
  degraded: {
    text: "خدمة الإنشاء تشهد بطئاً مؤقتاً — قد يستغرق إنشاء العرض وقتاً أطول من المعتاد.",
    cls: "border-[var(--tq-status-warn-border)] bg-[var(--tq-status-warn-bg)] text-[var(--tq-status-warn-text)]",
  },
  down: {
    text: "خدمة الإنشاء تواجه انقطاعاً حالياً — قد يفشل الإنشاء. يمكنك المحاولة لاحقاً.",
    cls: "border-[var(--tq-status-down-border)] bg-[var(--tq-status-down-bg)] text-[var(--tq-status-down-text)]",
  },
} as const;

export function ServerStatusBanner({
  className = "",
}: {
  className?: string;
}) {
  const status = useServerStatus();
  if (!status || (status.level !== "degraded" && status.level !== "down")) {
    return null;
  }

  const copy = COPY[status.level];
  return (
    <div
      dir="rtl"
      role="status"
      className={`mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${copy.cls} ${className}`}
    >
      <span
        className="material-symbols-outlined shrink-0 text-[18px]"
        aria-hidden
      >
        warning
      </span>
      <span className="flex-1 leading-relaxed">{copy.text}</span>
      <a
        href="https://status.claude.com"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
      >
        عرض الحالة
      </a>
    </div>
  );
}
