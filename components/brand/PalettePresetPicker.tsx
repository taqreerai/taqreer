"use client";

// The colour-template picker shared by every creation flow (2026-10-05:
// /create's version extracted so /mimic, /social, /enhance and /datasheet
// get the same 48 presets): a scrolling grid of palettes, a "Show all" link,
// and the large modal with every preset named. Picking applies the palette.

import { useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { PalettePresetGrid } from "@/components/brand/PalettePresets";
import { PALETTE_PRESETS, samePalette } from "@/lib/brand/palette-presets";
import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";

export function PalettePresetPicker({
  colors,
  onPick,
  disabled = false,
}: {
  colors: readonly string[];
  onPick: (colors: string[]) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const [expanded, setExpanded] = useState(false);
  const activeId = PALETTE_PRESETS.find((p) => samePalette(colors, p.colors))?.id ?? null;
  return (
    <>
      {/* More palettes per row as the card widens (full-width desktop cards). */}
      <div className="@container">
        <PalettePresetGrid
          activeId={activeId}
          onPick={(p) => onPick([...p.colors])}
          disabled={disabled}
          className="palette-scroll grid grid-cols-6 gap-1.5 @min-[26rem]:grid-cols-8 @min-[34rem]:grid-cols-10 @min-[46rem]:grid-cols-12"
        />
      </div>
      <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
      <PickerExpandModal
        open={expanded}
        title={dict.flows.design.allColorTemplates}
        onClose={() => setExpanded(false)}
      >
        <PalettePresetGrid
          activeId={activeId}
          onPick={(p) => {
            onPick([...p.colors]);
            setExpanded(false);
          }}
          labels
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6"
        />
      </PickerExpandModal>
    </>
  );
}
