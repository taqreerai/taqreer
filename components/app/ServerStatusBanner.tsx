"use client";

// Pre-generate warning banner shown at the top of the generation flows
// (create / enhance / mimic / datasheet) ONLY when the upstream provider
// is actually degraded or down (via useServerStatus → /api/status).
// Renders nothing on a healthy day, so it never nags falsely.

import { useServerStatus } from "@/lib/hooks/useServerStatus";

const COPY = {
  degraded: {
    text: "خدمة الإنشاء أبطأ من المعتاد حالياً. قد يحتاج العرض وقتاً إضافياً ليكتمل.",
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
    // §24: compact pill pinned to the top of the viewport so it never pushes the
    // flow cards down. Centered between the top-bar's edge icons (search / theme
    // / language), which sit at the corners.
    <div
      dir="rtl"
      role="status"
      className={`fixed left-1/2 top-2 z-40 flex max-w-[min(94vw,560px)] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-lg ${copy.cls} ${className}`}
    >
      <span
        className="material-symbols-outlined shrink-0 text-[15px]"
        aria-hidden
      >
        warning
      </span>
      <span className="leading-snug">{copy.text}</span>
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
