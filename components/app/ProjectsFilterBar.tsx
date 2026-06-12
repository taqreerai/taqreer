"use client";

// Filter bar for /projects. Single-row layout:
//   • Search input          (visual right — `dir="rtl"` flex-row
//                            puts first DOM child on the start side)
//   • Filter chips          (middle — format pills, language pills,
//                            favourited toggle)
//   • Colour swatch strip   (visual left — pushed to end side via
//                            `ms-auto` inside the wrapping flex,
//                            same row when there's room)
//
// Filter chips are SELF-TOGGLING — clicking an active chip clears
// it to "no filter" (null state). No "all" sentinel pill any more:
// "no chip active" === "show everything". Drop in single-select
// (radiogroup) semantics because click-to-deactivate doesn't fit
// the radio mental model; we use `aria-pressed` on each toggle and
// `group` ARIA on the wrapper.

import { useId } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

// Null = no filter active on this dimension. Single non-null value
// = filter to that one option (no multi-select; the chips are
// mutually exclusive within each group).
export type FormatFilter = "16:9" | "9:16" | null;
export type LanguageFilter = "ar" | "en" | null;

type Props = {
  search: string;
  onSearchChange: (next: string) => void;
  format: FormatFilter;
  onFormatChange: (next: FormatFilter) => void;
  language: LanguageFilter;
  onLanguageChange: (next: LanguageFilter) => void;
  favOnly: boolean;
  onFavOnlyChange: (next: boolean) => void;
  swatchColors: string[];
  selectedColor: string | null;
  onColorChange: (next: string | null) => void;
  // Rendered at the bar's end edge, after the swatches (the
  // multi-select "Select" pill, 2026-06-12).
  trailing?: React.ReactNode;
};

// Shared pill style — matches the existing LanguagePills component
// (border + colour pair on white-alpha utilities). Hover lifts the
// idle state to the active appearance so users get affordance feedback.
function pillClass(isActive: boolean): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    isActive
      ? "border-foreground/40 text-foreground"
      : "border-foreground/15 text-foreground/60 hover:border-foreground/40 hover:text-foreground"
  }`;
}

export function ProjectsFilterBar({
  search,
  onSearchChange,
  format,
  onFormatChange,
  language,
  onLanguageChange,
  favOnly,
  onFavOnlyChange,
  swatchColors,
  selectedColor,
  onColorChange,
  trailing,
}: Props) {
  const searchId = useId();
  const dict = useDict();
  const { dir } = useLocale();

  return (
    <section
      aria-label={dict.components.filterBar.projectFilters}
      // `flex-wrap` so narrow viewports drop swatches / extra chips
      // to a second line. `dir="rtl"` makes the start side (right)
      // hold the search, end side (left) hold whatever has `ms-auto`.
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3"
      dir={dir}
    >
      {/* Search — start side (right in RTL). `flex-1 min-w-[200px]
          max-w-xs` lets it stretch toward the centre but caps so the
          filter chips don't get squeezed off-screen on medium widths. */}
      <div className="relative max-w-xs min-w-[200px] flex-1">
        <span
          aria-hidden
          className="material-symbols-outlined pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[18px] text-muted"
        >
          search
        </span>
        <label htmlFor={searchId} className="sr-only">
          {dict.components.filterBar.searchTitles}
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={dict.components.filterBar.searchPlaceholder}
          className="input-search w-full rounded-full px-4 py-2 pe-10 text-sm"
        />
      </div>

      {/* Filter chip cluster — format + language + fav. Each chip
          self-toggles; clicking the active one clears to null. */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { value: "16:9" as const, label: "16:9" },
            { value: "9:16" as const, label: "9:16" },
          ]
        ).map((opt) => {
          const active = format === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onFormatChange(active ? null : opt.value)}
              className={pillClass(active)}
            >
              {opt.label}
            </button>
          );
        })}

        {(
          [
            { value: "ar" as const, label: dict.components.filterBar.langArabic },
            {
              value: "en" as const,
              label: dict.components.filterBar.langEnglish,
            },
          ]
        ).map((opt) => {
          const active = language === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onLanguageChange(active ? null : opt.value)}
              className={pillClass(active)}
            >
              {opt.label}
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={favOnly}
          onClick={() => onFavOnlyChange(!favOnly)}
          className={pillClass(favOnly)}
        >
          {/* Chip-scale star — `.tq-icon-sm` pins font-size to 14 px
              via the chained-selector cascade fix. Without it the
              icon defaults to Google Fonts' 24 px rule and the pill
              grows ~8 px taller than its text-only siblings. FILL
              axis stays inline because it toggles with the pill's
              pressed state. */}
          <span
            aria-hidden
            className="material-symbols-outlined tq-icon-sm"
            style={{ fontVariationSettings: favOnly ? '"FILL" 1' : '"FILL" 0' }}
          >
            star
          </span>
          {dict.components.filterBar.favoritesOnly}
        </button>
      </div>

      {/* Colour swatches — pushed to the end side (left in RTL) on
          wide viewports via `ms-auto`. Wraps below the chip row on
          medium widths. Only rendered when the user has at least one
          deck with a frozen dominantColor (pre-step-8b legacy decks
          are null and skipped upstream). No leading label — the
          coloured circles read as "filter by colour" on sight. */}
      {swatchColors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 ms-auto">
          {swatchColors.map((hex) => {
            const selected = selectedColor === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-pressed={selected}
                onClick={() => onColorChange(selected ? null : hex)}
                title={hex}
                className={`relative h-6 w-6 rounded-full border-2 transition-all ${
                  selected
                    ? "border-foreground scale-110"
                    : "border-foreground/20 hover:border-foreground/60"
                }`}
                style={{ backgroundColor: hex }}
              >
                <span className="sr-only">
                  {selected
                    ? dict.components.filterBar.clearColor
                    : dict.components.filterBar.filterColor.replace(
                        "{color}",
                        hex,
                      )}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {trailing ? (
        <div className={swatchColors.length > 0 ? "" : "ms-auto"}>{trailing}</div>
      ) : null}
    </section>
  );
}
