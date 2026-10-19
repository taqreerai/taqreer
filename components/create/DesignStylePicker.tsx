"use client";

// Design-style picker (2026-06-12, replacing the 4-row pill stack):
// a compact trigger row inside the output-settings card + a gallery
// modal where every style is PREVIEWED as a static CSS-drawn mini
// slide - no image assets, crisp at any size, theme-aware, and
// strictly inside the locked system (monochrome composition + the one
// blue accent; user-approved direction). Style NAMES stay English -
// they double as the deck-generate DESIGN_STYLE_DIRECTIVES keys.
//
// Canonical sibling-overlay dialog recipe (TemplateDeleteConfirmDialog
// et al). Shared by /create and /datasheet.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useState } from "react";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { DECK_STYLES, STYLE_SECTORS, type DeckStyleKey, type StyleSector } from "@/lib/design-styles";
import { SocialStyleThumb, StyleThumb, type SocialThumbKey } from "@/components/create/StyleThumb";
import { StyleInfoButton } from "@/components/create/StyleInfoButton";
import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";
import { FIT_MAX_ROWS, useFitCount } from "@/components/create/useFitCount";

// Deck styles: the shared list (lib/design-styles.ts). `label` is the prompt
// anchor stored on the brief; the visible name comes from the dictionary.
const STYLES = DECK_STYLES;

type SectorFilter = "all" | StyleSector;

// Sector filter chips above the deck-style tiles (2026-10-05). Same pill
// treatment as the colours "Auto" pill; scrolls sideways on narrow cards.
function SectorChips({
  value,
  onChange,
}: {
  value: SectorFilter;
  onChange: (next: SectorFilter) => void;
}) {
  const t = useDict().flows.stylePicker;
  const labels: Record<string, string> = t.sectors;
  return (
    <div role="group" aria-label={t.filterAria} className="hide-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
      {(["all", ...STYLE_SECTORS] as const).map((sec) => {
        const active = value === sec;
        return (
          <button
            key={sec}
            type="button"
            onClick={() => onChange(sec)}
            aria-pressed={active}
            className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
              active
                ? "border-foreground/40 bg-[var(--tq-overlay-soft)] text-foreground"
                : "border-[var(--tq-border-hairline)] text-foreground/60 hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {labels[sec]}
          </button>
        );
      })}
    </div>
  );
}

function inSector(key: string, sector: SectorFilter): boolean {
  if (sector === "all" || key === "auto") return true;
  const st = DECK_STYLES.find((d) => d.key === key);
  return !!st && (st.sectors as readonly string[]).includes(sector);
}

// ── Social-media style set (2026 trends) ────────────────────────
// Distinct from the deck styles above: these target portrait phone-feed
// cards (a scroll-stopping hook, big legible type, one atmosphere across
// the carousel). Labels double as DESIGN_STYLE_DIRECTIVES keys in
// deck-generate.ts (kept globally unique so both sets coexist in that map).
const SOCIAL_STYLES: ReadonlyArray<{ label: string; key: SocialStyleKey }> = [
  { label: "Bold Type", key: "boldtype" },
  { label: "Editorial Feed", key: "editorial" },
  { label: "Grainy Gradient", key: "grainy" },
  { label: "Neo-Brutalist", key: "brutalist" },
  { label: "Minimal Air", key: "minimal" },
  { label: "Photo Overlay", key: "photo" },
  { label: "Retro Print", key: "retro" },
  { label: "3D Pop", key: "pop3d" },
  // The two structured looks the deck set had and social lacked. Their labels
  // are deliberately NOT the deck ones ("Swiss / Grid", "Corporate / Data"):
  // the map is keyed by label, so these carry their own portrait-tuned
  // directives instead of the landscape 12-column / page-number ones.
  { label: "Swiss Grid", key: "swiss" },
  { label: "Corporate Data", key: "corporate" },
  // More looks (owner request 2026-10-07): quote and text-post formats,
  // Gulf heritage, premium, tech, hand-made, collage and how-to carousels.
  // Labels differ from the deck set ("Heritage / Geometric" etc.) so each
  // carries its own portrait-tuned directive.
  { label: "Quote Card", key: "quote" },
  { label: "Text Post", key: "textpost" },
  { label: "Heritage Pattern", key: "heritage" },
  { label: "Luxury Noir", key: "luxury" },
  { label: "Tech Glow", key: "techglow" },
  { label: "Doodle Notes", key: "doodle" },
  { label: "Scrapbook", key: "scrapbook" },
  { label: "Step by Step", key: "steps" },
];
type SocialStyleKey =
  | "boldtype"
  | "editorial"
  | "grainy"
  | "brutalist"
  | "minimal"
  | "photo"
  | "retro"
  | "pop3d"
  | "swiss"
  | "corporate"
  | "quote"
  | "textpost"
  | "heritage"
  | "luxury"
  | "techglow"
  | "doodle"
  | "scrapbook"
  | "steps";


export function DesignStylePicker({
  value,
  onChange,
  disabled = false,
  variant = "deck",
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  // "social" swaps in the 2026 social-media style set + portrait previews.
  variant?: "deck" | "social";
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.flows.stylePicker;
  const isSocial = variant === "social";
  // Style list, preview renderer, and descriptions all switch on the variant.
  const styles: ReadonlyArray<{ label: string; key: string }> = isSocial
    ? SOCIAL_STYLES
    : STYLES;
  const descs: Record<string, string> = isSocial ? t.socialDescs : t.descs;
  // Deck styles show their localized name; social keeps its English labels.
  const names: Record<string, string> = t.names;
  const nameOf = (st: { label: string; key: string }) =>
    isSocial ? st.label : (names[st.key] ?? st.label);
  const info: Record<string, { does: string; best: string }> = t.info;
  const renderMini = (key: string) =>
    isSocial ? (
      <SocialStyleThumb k={key as SocialThumbKey} title={t.thumbTitle} dir={dir} />
    ) : (
      <StyleThumb k={key as DeckStyleKey | "auto"} title={t.thumbTitle} dir={dir} />
    );
  const [open, setOpen] = useState(false);
  const [sector, setSector] = useState<SectorFilter>("all");
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const current = styles.find((s) => s.label === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Trigger row - the selected style's swatch + name + descriptor. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-2 text-start transition-colors hover:border-[var(--tq-purple)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className={`${isSocial ? "w-10" : "w-14"} shrink-0`}>
          {renderMini(current?.key ?? "auto")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {current ? nameOf(current) : t.auto}
          </p>
          <p className="truncate text-[11px] text-muted">
            {current ? descs[current.key] : t.autoDesc}
          </p>
        </div>
        <span
          className="material-symbols-outlined shrink-0 text-muted"
          style={{ fontSize: 18 }}
          aria-hidden
        >
          {dir === "rtl" ? "chevron_left" : "chevron_right"}
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <>
                  <motion.div
                    key="style-dim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    onClick={() => setOpen(false)}
                    className="modal-dim fixed inset-0 z-[1200]"
                  />
                  <div
                    key="style-wrapper"
                    className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4"
                  >
                    <motion.div
                      ref={panelRef}
                      dir={dir}
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="style-picker-title"
                      onClick={(e) => e.stopPropagation()}
                      initial={{ opacity: 0, scale: 0.96, y: 12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 12 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="surface-modal pointer-events-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 hide-scrollbar"
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <h3
                          id="style-picker-title"
                          className="text-lg font-bold text-foreground"
                        >
                          {t.dialogTitle}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setOpen(false)}
                          aria-label={dict.common.close}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-overlay-soft hover:text-foreground"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>

                      {!isSocial ? (
                        <div className="mb-3">
                          <SectorChips value={sector} onChange={setSector} />
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {styles.filter((s) => isSocial || inSector(s.key, sector)).map((s) => {
                          const active = value === s.label;
                          return (
                            <div key={s.key} className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                onChange(s.label);
                                setOpen(false);
                              }}
                              className={`w-full rounded-xl border p-2 text-start transition-colors ${
                                active
                                  ? "border-transparent outline outline-2 outline-[var(--tq-purple)]"
                                  : "border-[var(--tq-border-hairline)] hover:border-[var(--tq-purple)]"
                              }`}
                            >
                              <div className={isSocial ? "mx-auto w-3/5" : undefined}>
                                {renderMini(s.key)}
                              </div>
                              <p className="mt-2 text-[12px] font-semibold text-foreground">
                                {nameOf(s)}
                              </p>
                              <p className="text-[11px] text-muted">{descs[s.key]}</p>
                            </button>
                            {!isSocial && info[s.key] ? (
                              <StyleInfoButton
                                name={nameOf(s)}
                                does={info[s.key].does}
                                best={info[s.key].best}
                                className="absolute end-3.5 top-3.5"
                              />
                            ) : null}
                            </div>
                          );
                        })}
                        {/* Auto - clears the pick; Claude decides. */}
                        <button
                          type="button"
                          onClick={() => {
                            onChange(null);
                            setOpen(false);
                          }}
                          className={`rounded-xl border border-dashed p-2 text-start transition-colors ${
                            value === null
                              ? "border-transparent outline outline-2 outline-[var(--tq-purple)]"
                              : "border-[var(--tq-border-hairline)] hover:border-[var(--tq-purple)]"
                          }`}
                        >
                          <div className={isSocial ? "mx-auto w-3/5" : undefined}>
                            {renderMini("auto")}
                          </div>
                          <p className="mt-2 text-[12px] font-semibold text-foreground">{t.auto}</p>
                          <p className="text-[11px] text-muted">{t.autoDesc}</p>
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Inline style grid for /create's Design step: Auto + every deck style as an
 * illustrated tile with its localized name and an info button (what it does,
 * best topics). More columns as the card widens; "Show all" opens the large
 * gallery with descriptions.
 */
export function DesignStyleGrid({
  value,
  onChange,
  disabled = false,
  wide = false,
  fit = false,
  suggested = [],
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  // Style labels suggested for the user's content, best first (/create,
  // 2026-10-19): listed right after Auto with a "Suggested" badge.
  suggested?: readonly string[];
  // Full-width grid for /create's own Design step (2026-10-06): big tiles
  // with the one-line description, no inner scroll and no "Show all" modal.
  wide?: boolean;
  // With `wide`: a grid inside a fixed-height card (/create's Design card):
  // columns follow the CARD width, and on a viewport-fit stage only the rows
  // scroll inside the card; elsewhere 4 rows, the rest behind "Show all".
  fit?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.flows.stylePicker;
  const names: Record<string, string> = t.names;
  const descs: Record<string, string> = t.descs;
  const info: Record<string, { does: string; best: string }> = t.info;
  const [expanded, setExpanded] = useState(false);
  const [sector, setSector] = useState<SectorFilter>("all");
  const allTiles: ReadonlyArray<{
    key: DeckStyleKey | "auto";
    name: string;
    desc: string;
    does: string;
    best: string;
    value: string | null;
  }> = [
    { key: "auto", name: t.auto, desc: t.autoDesc, does: t.autoInfoDoes, best: t.autoInfoBest, value: null },
    ...STYLES.map((s) => ({
      key: s.key,
      name: names[s.key] ?? s.label,
      desc: descs[s.key] ?? "",
      does: info[s.key]?.does ?? "",
      best: info[s.key]?.best ?? "",
      value: s.label,
    })),
  ];
  const rank = (v: string | null) => (v ? suggested.indexOf(v) : -1);
  const ordered = [
    ...allTiles.filter((tl) => tl.value === null),
    ...allTiles.filter((tl) => rank(tl.value) >= 0).sort((a, b) => rank(a.value) - rank(b.value)),
    ...allTiles.filter((tl) => tl.value !== null && rank(tl.value) < 0),
  ];
  const tiles = ordered.filter((tl) => inSector(tl.key, sector));
  const { boxRef: fitBoxRef, gridRef: fitGridRef, count: fitCount } = useFitCount(wide && fit, tiles.length, FIT_MAX_ROWS);

  const tile = (tl: (typeof allTiles)[number], big: boolean) => {
    const active = value === tl.value;
    return (
      <div key={tl.key} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(tl.value);
            if (big && (!wide || fit)) setExpanded(false);
          }}
          aria-pressed={active}
          className={`pick-tile flex w-full flex-col gap-1.5 rounded-lg p-1.5 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
            active ? "is-active" : ""
          }`}
        >
          <span className="relative block">
            <StyleThumb k={tl.key} title={t.thumbTitle} dir={dir} />
            {rank(tl.value) >= 0 ? (
              <span className="style-suggested-badge pointer-events-none absolute start-1.5 top-1.5">
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                {t.suggested}
              </span>
            ) : null}
          </span>
          <span className={`truncate font-medium text-foreground/85 ${big ? "text-[13px]" : "text-[11px]"}`}>
            {tl.name}
          </span>
          {big ? <span className="-mt-1 text-[11px] leading-4 text-foreground/55">{tl.desc}</span> : null}
        </button>
        <StyleInfoButton
          name={tl.name}
          does={tl.does}
          best={tl.best}
          className={big ? "absolute end-3 top-3" : "absolute end-2.5 top-2.5"}
        />
      </div>
    );
  };

  const expandModal = (
    <PickerExpandModal open={expanded} title={t.allStyles} onClose={() => setExpanded(false)}>
      <div className="mb-3">
        <SectorChips value={sector} onChange={setSector} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {tiles.map((tl) => tile(tl, true))}
      </div>
    </PickerExpandModal>
  );

  if (wide && fit) {
    // Viewport-fit: every tile, scrolling inside the card (owner direction
    // 2026-10-07); phones / short viewports cap at 4 rows + "Show all".
    return (
      <div className="@container flex flex-col gap-3 stage:h-full stage:min-h-0">
        <SectorChips value={sector} onChange={setSector} />
        <div
          ref={fitBoxRef}
          className="p-0.5 stage:min-h-0 stage:flex-1 stage:overflow-y-auto stage:overscroll-contain"
        >
          <div
            ref={fitGridRef}
            className="grid auto-rows-max grid-cols-2 gap-3 @min-[32rem]:grid-cols-3 @min-[52rem]:grid-cols-4"
          >
            {tiles.slice(0, fitCount ?? undefined).map((tl) => tile(tl, true))}
          </div>
        </div>
        {fitCount != null && tiles.length > fitCount ? (
          <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
        ) : null}
        {expandModal}
      </div>
    );
  }

  if (wide) {
    return (
      <div className="flex flex-col gap-3">
        <SectorChips value={sector} onChange={setSector} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
          {tiles.map((tl) => tile(tl, true))}
        </div>
      </div>
    );
  }

  return (
    <div className="@container flex flex-col gap-1.5">
      <SectorChips value={sector} onChange={setSector} />
      <div className="design-scroll grid shrink-0 auto-rows-max grid-cols-3 gap-2 @min-[26rem]:grid-cols-4 @min-[34rem]:grid-cols-5 @min-[46rem]:grid-cols-6">
        {tiles.map((tl) => tile(tl, false))}
      </div>
      <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
      {expandModal}
    </div>
  );
}

/**
 * Full-width social style grid for /social's Design step (2026-10-06, the
 * shared creation wizard): Auto + every social style as a portrait post
 * preview with its name and one-line description, the same tile language as
 * the deck DesignStyleGrid. `value` is the style label (null = Auto).
 */
export function SocialStyleGrid({
  value,
  onChange,
  disabled = false,
  fit = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  // Inside a fixed-height wizard card (2026-10-07, /create's two-step
  // layout): columns follow the card width and only the whole rows that fit
  // render, the rest behind "Show all". Same as DesignStyleGrid's `fit`.
  fit?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.flows.stylePicker;
  const descs: Record<string, string> = t.socialDescs;
  const tiles: ReadonlyArray<{ key: SocialStyleKey | "auto"; name: string; desc: string; value: string | null }> = [
    { key: "auto", name: t.auto, desc: t.autoDesc, value: null },
    ...SOCIAL_STYLES.map((s) => ({ key: s.key, name: s.label, desc: descs[s.key] ?? "", value: s.label })),
  ];
  const [expanded, setExpanded] = useState(false);
  const { boxRef: fitBoxRef, gridRef: fitGridRef, count: fitCount } = useFitCount(fit, tiles.length, FIT_MAX_ROWS);

  const tile = (tl: (typeof tiles)[number], inModal: boolean) => {
    const active = value === tl.value;
    return (
      <button
        key={tl.key}
        type="button"
        disabled={disabled}
        onClick={() => {
          onChange(tl.value);
          if (inModal) setExpanded(false);
        }}
        aria-pressed={active}
        className={`pick-tile flex w-full flex-col gap-1.5 rounded-xl p-2 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
          active ? "is-active" : ""
        }`}
      >
        <div className="mx-auto w-3/4">
          <SocialStyleThumb k={tl.key} title={t.thumbTitle} dir={dir} />
        </div>
        <span className="truncate text-[13px] font-medium text-foreground/85">{tl.name}</span>
        <span className="-mt-1 text-[11px] leading-4 text-foreground/55">{tl.desc}</span>
      </button>
    );
  };

  if (fit) {
    return (
      <div className="@container flex flex-col gap-3 stage:h-full stage:min-h-0">
        <div ref={fitBoxRef} className="p-0.5 stage:min-h-0 stage:flex-1 stage:overflow-y-auto stage:overscroll-contain">
          <div
            ref={fitGridRef}
            className="grid auto-rows-max grid-cols-3 gap-3 @min-[28rem]:grid-cols-4 @min-[38rem]:grid-cols-5 @min-[52rem]:grid-cols-6"
          >
            {tiles.slice(0, fitCount ?? undefined).map((tl) => tile(tl, false))}
          </div>
        </div>
        {fitCount != null && tiles.length > fitCount ? (
          <PickerExpandButton onClick={() => setExpanded(true)} disabled={disabled} />
        ) : null}
        <PickerExpandModal open={expanded} title={t.allStyles} onClose={() => setExpanded(false)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {tiles.map((tl) => tile(tl, true))}
          </div>
        </PickerExpandModal>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tl) => tile(tl, false))}
    </div>
  );
}
