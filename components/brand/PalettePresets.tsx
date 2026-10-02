"use client";

// Colour-template chips (2026-10-02), shared by /create's Design step and
// the studio's deck-colours menu. Each preset renders as its five colour
// roles in one strip (lib/brand/palette-presets.ts).

import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  PALETTE_PRESETS,
  type PalettePreset,
} from "@/lib/brand/palette-presets";

export function PaletteStrip({
  colors,
  className = "",
}: {
  colors: readonly string[];
  className?: string;
}) {
  return (
    <div className={`palette-strip ${className}`} dir="ltr" aria-hidden>
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </div>
  );
}

/**
 * The preset list as selectable tiles. `activeId` outlines the picked one;
 * `labels` adds the preset name under each strip (studio menu), otherwise the
 * name rides the tooltip only (compact /create row).
 */
export function PalettePresetGrid({
  activeId,
  onPick,
  labels = false,
  disabled = false,
  className = "grid grid-cols-6 gap-1.5",
}: {
  activeId: string | null;
  onPick: (preset: PalettePreset) => void;
  labels?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  return (
    <div className={className}>
      {PALETTE_PRESETS.map((p) => {
        const name = locale === "en" ? p.name.en : p.name.ar;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(p)}
            title={name}
            aria-label={name}
            aria-pressed={activeId === p.id}
            className={`pick-tile flex flex-col gap-1 rounded-lg p-1 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
              activeId === p.id ? "is-active" : ""
            }`}
          >
            <PaletteStrip colors={p.colors} className={labels ? "h-6" : "h-4"} />
            {labels ? (
              <span className="truncate px-0.5 text-[11px] font-medium text-foreground/80">
                {name}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
