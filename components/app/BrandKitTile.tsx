"use client";

// Brand-kit tile rendered on /brand-kits. Shows the saved logo
// (white silhouette via the canonical `brightness(0) invert(1)`
// filter that `LogoUploadSlot` uses), palette swatches, and font
// names — the three things the user paid attention to when saving
// the kit. Click anywhere on the body opens the use-dialog; the
// 3-dots top-right opens the actions menu.
//
// Layout mirrors `.qa-card` (dashboard QuickActions) at the
// chrome level (glass surface, hover lift), with a content
// structure tuned to brand kits:
//   • Logo viewport — top, generous height, centred.
//   • Palette row — bottom-left.
//   • Fonts — bottom-right (heading on top, body below).
//   • Kit name — header above the logo.
//   • Date — subhead under the name.

import { useRef } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

// Inputs from the SSR page. Optional fields tolerate legacy rows /
// the user-sync race.
export type BrandKitTileData = {
  id: string;
  name: string;
  createdAt: string; // ISO from SSR
  logoDisplayUrl: string | null; // signed URL (server-side)
  colors: string[]; // hex strings — empty for kits saved before palette pinning
  fontHeadingName: string | null;
  fontBodyName: string | null;
  // Marks this kit as the user's default — surfaces a small star
  // chip in the header so the user can spot it at a glance, and
  // floats the tile to the top of the list (page.tsx orders by
  // isDefault desc).
  isDefault: boolean;
};

export function BrandKitTile({
  kit,
  onUse,
  onMenuOpen,
}: {
  kit: BrandKitTileData;
  // Tile-body click. Parent opens the flow-picker.
  onUse: () => void;
  // 3-dots click. Parent owns the menu open state + the trigger rect.
  onMenuOpen: (triggerRect: DOMRect) => void;
}) {
  const dotsRef = useRef<HTMLButtonElement | null>(null);
  const dict = useDict();
  const { dir } = useLocale();

  const handleDotsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const trigger = dotsRef.current;
    if (!trigger) return;
    onMenuOpen(trigger.getBoundingClientRect());
  };

  // `ar-u-nu-latn` keeps Arabic month names with Latin digits per
  // the project's "Latin numerals only" rule.
  const dateLabel = new Date(kit.createdAt).toLocaleDateString("ar-u-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onUse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onUse();
        }
      }}
      aria-label={dict.components.brandKitTile.use.replace("{name}", kit.name)}
      dir={dir}
      // `rounded-3xl` overrides .surface-card's default radius so the
      // tiles read as visibly rounded (per user direction 2026-05-27).
      // The list page renders the tiles directly — no wrapping
      // container — so the rounding is the only chrome separating
      // each kit from its neighbours.
      //
      // `hover:-translate-y-0.5` is the same subtle lift QuickActions
      // applies via `.qa-card:hover` — kept in CSS (not JS state) so
      // it composes naturally with the 3-dots button's own hover.
      className="surface-card group relative flex cursor-pointer flex-col gap-4 overflow-hidden rounded-3xl p-4 transition-all duration-200 hover:-translate-y-0.5"
    >
      {/* Header row — name + 3-dots aligned to the visual top edges.
          Default kits get a small star chip pinned to the start of
          the name row so the user can spot the default at a glance. */}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {kit.isDefault ? (
              <span
                title={dict.common.default}
                // Material Symbols defaults to outlined; FILL=1 plus
                // a higher weight gives the canonical filled star.
                // White (not violet) per user direction 2026-05-27 —
                // the chip should read as a neutral "this is the
                // default" marker, not a brand-coloured accent.
                className="material-symbols-outlined shrink-0 text-white"
                style={{
                  fontSize: 14,
                  fontVariationSettings: "'FILL' 1, 'wght' 500",
                }}
                aria-label={dict.common.default}
              >
                star
              </span>
            ) : null}
            <h3 className="truncate text-sm font-semibold leading-snug text-white">
              {kit.name}
            </h3>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            {dateLabel}
          </p>
        </div>
        <button
          ref={dotsRef}
          type="button"
          data-brand-kit-menu-trigger={kit.id}
          onClick={handleDotsClick}
          aria-label={dict.components.brandKitTile.options}
          aria-haspopup="menu"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-white"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18 }}
            aria-hidden
          >
            more_horiz
          </span>
        </button>
      </header>

      {/* Logo viewport — same recipe `LogoUploadSlot` uses for the
          filled-state preview: white silhouette via brightness(0)
          + invert(1) so the kit's brand mark reads on dark glass
          regardless of its source color (uploaded SVGs are
          monochromatic by the /create logo policy). Fallback when
          no logo: the kit's "B" initial in a neutral chip. */}
      <div
        className="relative flex h-32 w-full items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02]"
        aria-hidden
      >
        {kit.logoDisplayUrl ? (
          <img
            src={kit.logoDisplayUrl}
            alt=""
            className="h-16 w-auto max-w-[70%] object-contain [filter:brightness(0)_invert(1)]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span
            className="material-symbols-outlined text-[40px] text-white/30"
            aria-hidden
          >
            image
          </span>
        )}
      </div>

      {/* Palette + fonts row. Palette on the start side (visual
          right in RTL) so its color identity reads first; fonts
          opposite. Both bleed to the card edge for a denser, more
          editorial layout. */}
      <footer className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted/70">
            {dict.components.brandKitTile.colors}
          </span>
          <div className="flex items-center gap-1.5">
            {kit.colors.length > 0 ? (
              kit.colors.slice(0, 6).map((hex, idx) => (
                <span
                  key={`${hex}-${idx}`}
                  className="h-5 w-5 rounded-full border border-white/15 shadow-sm"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))
            ) : (
              <span className="text-[11px] text-muted">—</span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-end">
          <span className="text-[10px] uppercase tracking-wider text-muted/70">
            {dict.components.brandKitTile.fonts}
          </span>
          <span
            className="max-w-[140px] truncate text-[12px] font-medium text-white"
            title={kit.fontHeadingName ?? undefined}
          >
            {kit.fontHeadingName ?? "—"}
          </span>
          {kit.fontBodyName && kit.fontBodyName !== kit.fontHeadingName ? (
            <span
              className="max-w-[140px] truncate text-[11px] text-muted"
              title={kit.fontBodyName}
            >
              {kit.fontBodyName}
            </span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
