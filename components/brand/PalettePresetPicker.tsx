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
import { useFitCount } from "@/components/create/useFitCount";

// Fill mode shows at most 3 rows of 4 (owner direction 2026-10-07).
const FILL_MAX = 12;

export function PalettePresetPicker({
  colors,
  onPick,
  disabled = false,
  wide = false,
  fill = false,
  expanded: expandedProp,
  onExpandedChange,
}: {
  colors: readonly string[];
  onPick: (colors: string[]) => void;
  disabled?: boolean;
  // /create's Brand step (2026-10-06): every preset named, in a tall
  // scrolling grid, no "Show all" modal.
  wide?: boolean;
  // No scroll, for a height-bound card (/create's Brand card): big tiles
  // (the strip fills the tile), 4 per row, up to FILL_MAX (3 rows); fewer
  // whole rows when the card is short (measured by useFitCount). The rest
  // stays in "Show all".
  fill?: boolean;
  // Controlled "Show all" modal: the caller renders the trigger elsewhere
  // (/create's Brand card puts it on the Colours row) and fill mode then
  // draws no trigger line of its own.
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
}) {
  const dict = useDict();
  const [ownExpanded, setOwnExpanded] = useState(false);
  const expanded = expandedProp ?? ownExpanded;
  const setExpanded = onExpandedChange ?? setOwnExpanded;
  const activeId = PALETTE_PRESETS.find((p) => samePalette(colors, p.colors))?.id ?? null;
  const {
    boxRef: fitBoxRef,
    gridRef: fitGridRef,
    count: fitCount,
  } = useFitCount(fill, PALETTE_PRESETS.length);
  if (wide) {
    return (
      <div className="@container max-h-[340px] overflow-y-auto overscroll-contain p-0.5">
        <PalettePresetGrid
          activeId={activeId}
          onPick={(p) => onPick([...p.colors])}
          disabled={disabled}
          labels
          className="grid grid-cols-2 gap-2 @min-[30rem]:grid-cols-3 @min-[40rem]:grid-cols-4"
        />
      </div>
    );
  }
  const expandButton = (
    <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
  );
  return (
    <>
      {fill ? (
        <div className="flex flex-col gap-2 stage:min-h-0 stage:flex-1">
          {onExpandedChange ? null : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/55">
                {dict.flows.design.colorTemplates}
              </span>
              {expandButton}
            </div>
          )}
          {/* min-h-12: never thinner than ONE row of tiles (h-8 strip + tile
              padding + border + grid padding = 46px), so a short card still
              shows a whole row instead of a sliver. */}
          <div
            ref={fitBoxRef}
            className="stage:min-h-12 stage:flex-1 stage:overflow-hidden"
          >
            {/* Unnamed: the strip fills the tile (names ride the tooltip
                and the "Show all" modal). */}
            <PalettePresetGrid
              gridRef={fitGridRef}
              activeId={activeId}
              onPick={(p) => onPick([...p.colors])}
              disabled={disabled}
              stripClassName="h-8"
              limit={Math.min(fitCount ?? FILL_MAX, FILL_MAX)}
              className="palette-fit"
            />
          </div>
        </div>
      ) : (
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
          {expandButton}
        </>
      )}
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
