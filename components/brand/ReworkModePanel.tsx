"use client";

// ReworkModePanel - Enhance's "Redesign freely" row (owner, 2026-10-22). The
// file's analysis preselects it (lib/extract/rework-score.ts) and the line
// under the title says why; the user can flip it. Same row layout as
// PhotoRefreshPanel so the settings read as one list.

import { Toggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";
import type { ReworkReason } from "@/lib/extract/rework-score";

export function ReworkModePanel({
  value,
  onChange,
  reason,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  reason: ReworkReason;
  disabled?: boolean;
}) {
  const dict = useDict();
  const copy = dict.flows.brand;
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          value
            ? "bg-[var(--tq-violet)]/15 text-[var(--tq-violet)]"
            : "bg-[var(--tq-overlay-soft)] text-foreground/55"
        }`}
        aria-hidden
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: 22 }}>
          auto_awesome_mosaic
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-4 text-foreground/70">{copy.reworkTitle}</span>
        <span className="mt-1 block text-[11px] leading-4 text-foreground/50">{copy.reworkDesc}</span>
        <span className="mt-1 block text-[11px] font-medium leading-4 text-foreground/60">
          {copy.reworkReasons[reason]}
        </span>
      </div>
      <div className="shrink-0">
        <Toggle ariaLabel={copy.reworkTitle} value={value} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}
