"use client";

// PhotoRefreshPanel — Enhance's "Refresh my photos" row (owner, 2026-10-20).
// Off by default: every original photo is kept (cleaned up). On: the deck's
// most important generic photos are re-made in the new style, within a cap;
// people are never replaced (lib/extract/photo-refresh.ts). Same row layout as
// AIImagesPanel so the two read as one settings list.

import { Toggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";

export function PhotoRefreshPanel({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  return (
    <div className="flex items-center gap-3">
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          value
            ? "bg-[var(--tq-violet)]/15 text-[var(--tq-violet)]"
            : "bg-[var(--tq-overlay-soft)] text-foreground/55"
        }`}
        aria-hidden
      >
        <span className="material-symbols-outlined leading-none" style={{ fontSize: 22 }}>
          photo_library
        </span>
        <span
          className="material-symbols-outlined absolute -end-1 -top-1 rounded-full bg-[var(--tq-surface)] leading-none text-[var(--tq-violet)]"
          style={{ fontSize: 13, padding: 1 }}
        >
          autorenew
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-4 text-foreground/70">
          {dict.flows.brand.photoRefreshTitle}
        </span>
        <span className="mt-1 block text-[11px] leading-4 text-foreground/50">
          {dict.flows.brand.photoRefreshDesc}
        </span>
      </div>
      <div className="shrink-0">
        <Toggle
          ariaLabel={dict.flows.brand.photoRefreshTitle}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
