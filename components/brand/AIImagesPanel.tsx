"use client";

// AIImagesPanel — the "صور بالذكاء الاصطناعي" toggle, made UNMISSABLE
// (flow-card redesign). Moved out of the content card into إعدادات
// الإخراج and given its own tinted panel: an image icon in a brand-violet
// tile on the reading edge, title + one-line subtitle, and the Toggle on
// the far edge. The violet wash + border make it read as a feature, not a
// row of fine print, so users don't miss the photography-led option.

import { Toggle } from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";

export function AIImagesPanel({
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
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
        value
          ? "border-[var(--tq-violet)]/50 bg-[var(--tq-violet)]/15"
          : "border-[var(--tq-violet)]/25 bg-[var(--tq-violet)]/8"
      }`}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--tq-violet)]/25 text-[var(--tq-violet)]"
        aria-hidden
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          image
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {dict.flows.brand.aiImagesTitle}
        </span>
        <span className="block text-[11px] text-foreground/55">
          {dict.flows.brand.aiImagesDesc}
        </span>
      </div>
      <Toggle
        ariaLabel={dict.flows.brand.aiImagesTitle}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
