"use client";

// Filter bar for /templates. Mirrors ProjectsFilterBar's chip style and
// self-toggling chip semantics — with one swap: the project page's
// "favorited" chip is replaced by an owner chip (خاصة / المجتمع /
// الكل) because templates have no isFavorite axis but DO have an
// own-vs-community partition the user wants to slice on. There is no
// search input: templates are untitled, so there's no text to match —
// filtering is by format / language / owner / palette colour only.
//
// Kept as a sibling file (not a generalised ProjectsFilterBar) because
// the chip cluster's specific options are page-domain knowledge.
// Refactoring to a generic <FilterBar chips={...}> is a v2 move once
// we have a third filter-bar consumer to triangulate the API against.

export type FormatFilter = "16:9" | "9:16" | null;
export type LanguageFilter = "ar" | "en" | null;
// Default = "own". The user lands on the templates page looking for
// their own saved templates most often; community discovery is a
// secondary mode. Toggle chips cycle own → community → all → own.
export type OwnerFilter = "own" | "community" | "all";

type Props = {
  format: FormatFilter;
  onFormatChange: (next: FormatFilter) => void;
  language: LanguageFilter;
  onLanguageChange: (next: LanguageFilter) => void;
  owner: OwnerFilter;
  onOwnerChange: (next: OwnerFilter) => void;
  swatchColors: string[];
  selectedColor: string | null;
  onColorChange: (next: string | null) => void;
  // Per-tab counts so the owner chips can show numbers — gives the
  // user a quick read of "do I have any community templates available?"
  // before clicking the chip.
  ownCount: number;
  communityCount: number;
};

function pillClass(isActive: boolean): string {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    isActive
      ? "border-white/40 text-white"
      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
  }`;
}

export function TemplatesFilterBar({
  format,
  onFormatChange,
  language,
  onLanguageChange,
  owner,
  onOwnerChange,
  swatchColors,
  selectedColor,
  onColorChange,
  ownCount,
  communityCount,
}: Props) {
  const ownerOptions: ReadonlyArray<{
    value: OwnerFilter;
    label: string;
    count?: number;
  }> = [
    { value: "own", label: "خاصة", count: ownCount },
    { value: "community", label: "المجتمع", count: communityCount },
    { value: "all", label: "الكل" },
  ];

  return (
    <section
      aria-label="فلاتر القوالب"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3"
      dir="rtl"
    >
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
            { value: "ar" as const, label: "العربية" },
            { value: "en" as const, label: "الإنجليزية" },
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

        {/* Owner chip cluster — radio-style (always exactly one active).
            Differs from format/language which can be "no filter"; for
            owner there is no "all templates with no filter" mode
            because the page domain itself has two distinct populations
            (own + community) and the user always wants one of three
            views. */}
        {ownerOptions.map((opt) => {
          const active = owner === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onOwnerChange(opt.value)}
              className={pillClass(active)}
            >
              <span>{opt.label}</span>
              {opt.count !== undefined ? (
                <span
                  className={
                    active ? "text-white/80" : "text-white/35"
                  }
                  dir="ltr"
                >
                  {opt.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {swatchColors.length > 0 ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">
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
                    ? "scale-110 border-white"
                    : "border-white/20 hover:border-white/60"
                }`}
                style={{ backgroundColor: hex }}
              >
                <span className="sr-only">
                  {selected ? "إلغاء تصفية اللون" : `تصفية باللون ${hex}`}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
