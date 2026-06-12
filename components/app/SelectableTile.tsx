"use client";

// Selection-mode overlay for library tiles (2026-06-12). Wraps ANY
// tile (ProjectThumbnail / TemplateTile / BrandKitTile /
// LibraryImageCard) without touching its internals: when the page's
// multi-select mode is active, an absolute click-capture layer
// intercepts the tile's own click targets, a check circle sits in the
// top-start corner, and the selected state draws the accent outline
// (same blue as the current-tier card). Inactive mode renders the
// children untouched.

import { useDict } from "@/components/i18n/LocaleProvider";

export function SelectableTile({
  active,
  selected,
  // Non-selectable rows (e.g. decks shared WITH the viewer, community
  // templates) render a dimmed lock circle and ignore clicks.
  disabled = false,
  onToggle,
  // Matches the wrapped tile's corner radius so the outline hugs it.
  radiusClassName = "rounded-[14px]",
  children,
}: {
  active: boolean;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  radiusClassName?: string;
  children: React.ReactNode;
}) {
  const dict = useDict();
  if (!active) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <div
        role="checkbox"
        aria-checked={selected}
        aria-disabled={disabled}
        aria-label={dict.common.bulk.toggleItem}
        tabIndex={disabled ? -1 : 0}
        onClick={disabled ? undefined : onToggle}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`absolute inset-0 z-20 ${radiusClassName} ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        } ${
          selected
            ? "outline outline-2 -outline-offset-1 outline-[var(--tq-purple)]"
            : ""
        }`}
      >
        <span
          className={`absolute start-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-white ${
            disabled
              ? "border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] opacity-50"
              : selected
                ? "border-[var(--tq-purple)] bg-[var(--tq-purple)]"
                : "border-white/70 bg-black/30"
          }`}
          aria-hidden
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {disabled ? "block" : selected ? "check" : ""}
          </span>
        </span>
      </div>
    </div>
  );
}
