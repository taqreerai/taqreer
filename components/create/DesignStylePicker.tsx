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
import { StyleThumb } from "@/components/create/StyleThumb";
import { StyleInfoButton } from "@/components/create/StyleInfoButton";
import { PickerExpandButton, PickerExpandModal } from "@/components/create/PickerExpandModal";

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
  | "corporate";

// ── Social mini-card colours ────────────────────────────────────
// `bar` = muted block; accent = var(--tq-purple). (Deck styles use the
// illustrated StyleThumb instead.)
const BAR = "var(--tq-text-muted)";
const BAR_SOFT = "color-mix(in srgb, var(--tq-text-muted) 45%, transparent)";
const ACCENT = "var(--tq-purple)";

// ── Portrait social-card previews ───────────────────────────────
// Same CSS-block language as StyleMini, but a 4:5 portrait card so the
// swatch reads as a phone-feed post. Keys → SOCIAL_STYLES.
function SocialStyleMini({
  k,
  big = false,
  boldSample = "خط",
}: {
  k: SocialStyleKey | "auto";
  big?: boolean;
  boldSample?: string;
}) {
  const base =
    "relative w-full overflow-hidden rounded-md border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)]";
  const abs = (s: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    ...s,
  });
  // A faint dot texture (halftone/grain hint) as a CSS background-image.
  const HALFTONE =
    "radial-gradient(var(--tq-text-muted) 0.8px, transparent 0.8px)";
  return (
    <div className={base} style={{ aspectRatio: "4/5" }} dir="ltr">
      {k === "boldtype" && (
        <div
          className="flex h-full w-full items-center justify-center font-black text-foreground"
          style={{ fontSize: big ? 40 : 15, lineHeight: 1 }}
        >
          {boldSample}
        </div>
      )}
      {k === "editorial" && (
        <>
          <div style={abs({ top: "8%", left: "10%", width: "26%", height: "3%", background: ACCENT })} />
          <div style={abs({ top: "14%", left: "10%", width: "70%", height: "9%", background: BAR })} />
          <div style={abs({ top: "26%", left: "10%", width: "52%", height: "5%", background: BAR_SOFT })} />
          <div style={abs({ top: "40%", left: "10%", right: "10%", height: "38%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "8%", left: "10%", width: "44%", height: "4%", background: BAR_SOFT })} />
        </>
      )}
      {k === "grainy" && (
        <>
          <div
            style={abs({
              inset: 0,
              background:
                "radial-gradient(120% 90% at 30% 20%, color-mix(in srgb, var(--tq-purple) 70%, transparent), transparent 60%), radial-gradient(120% 90% at 80% 90%, color-mix(in srgb, var(--tq-blue, var(--tq-purple)) 65%, transparent), transparent 55%), var(--tq-surface)",
            })}
          />
          <div style={abs({ inset: 0, backgroundImage: HALFTONE, backgroundSize: "5px 5px", opacity: 0.35 })} />
          <div style={abs({ bottom: "20%", left: "16%", width: "56%", height: "7%", borderRadius: 999, background: "#fff" })} />
          <div style={abs({ bottom: "12%", left: "16%", width: "34%", height: "4%", borderRadius: 999, background: "rgba(255,255,255,0.7)" })} />
        </>
      )}
      {k === "brutalist" && (
        <>
          <div style={abs({ top: "12%", left: "12%", width: "50%", height: "24%", background: ACCENT, boxShadow: `${big ? 5 : 3}px ${big ? 5 : 3}px 0 var(--tq-text-primary)`, border: `${big ? 2 : 1.5}px solid var(--tq-text-primary)` })} />
          <div style={abs({ bottom: "14%", left: "12%", width: "70%", height: "16%", background: "var(--tq-surface)", boxShadow: `${big ? 5 : 3}px ${big ? 5 : 3}px 0 var(--tq-text-primary)`, border: `${big ? 2 : 1.5}px solid var(--tq-text-primary)` })} />
        </>
      )}
      {k === "minimal" && (
        <>
          <div style={abs({ top: "46%", left: "24%", width: "52%", height: "6%", background: BAR })} />
          <div style={abs({ top: "58%", left: "44%", width: "12%", height: "2.5%", background: ACCENT })} />
        </>
      )}
      {k === "photo" && (
        <>
          <div style={abs({ inset: 0, background: "color-mix(in srgb, var(--tq-purple) 45%, black)" })} />
          <div style={abs({ inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent 55%)" })} />
          <div style={abs({ bottom: "14%", left: "10%", width: "62%", height: "7%", background: "#fff" })} />
          <div style={abs({ bottom: "7%", left: "10%", width: "38%", height: "4%", background: "rgba(255,255,255,0.7)" })} />
        </>
      )}
      {k === "retro" && (
        <>
          <div style={abs({ inset: 0, background: "color-mix(in srgb, var(--tq-purple) 22%, var(--tq-surface))" })} />
          <div style={abs({ inset: 0, backgroundImage: HALFTONE, backgroundSize: "4px 4px", opacity: 0.5 })} />
          <div style={abs({ inset: "9%", border: `${big ? 2 : 1.5}px solid var(--tq-text-primary)` })} />
          <div style={abs({ top: "42%", left: "20%", width: "60%", height: "8%", background: ACCENT })} />
        </>
      )}
      {k === "pop3d" && (
        <>
          <div style={abs({ top: "12%", left: "14%", width: "34%", aspectRatio: "1", borderRadius: "50%", background: ACCENT, boxShadow: "0 6px 12px rgba(0,0,0,0.25)" })} />
          <div style={abs({ bottom: "14%", left: "12%", right: "12%", height: "34%", borderRadius: 18, background: BAR_SOFT, boxShadow: "0 6px 14px rgba(0,0,0,0.18)" })} />
          <div style={abs({ bottom: "22%", left: "18%", width: "40%", height: "5%", borderRadius: 999, background: BAR })} />
        </>
      )}
      {k === "swiss" && (
        <>
          {/* Column rules + blocks snapped to them: alignment IS the design. */}
          <div style={abs({ top: 0, bottom: 0, left: "25%", width: 1, background: BAR_SOFT })} />
          <div style={abs({ top: 0, bottom: 0, left: "50%", width: 1, background: BAR_SOFT })} />
          <div style={abs({ top: 0, bottom: 0, left: "75%", width: 1, background: BAR_SOFT })} />
          <div style={abs({ top: "12%", left: "10%", width: "40%", height: "7%", background: ACCENT })} />
          <div style={abs({ top: "25%", left: "10%", width: "65%", height: "5%", background: BAR })} />
          <div style={abs({ top: "35%", left: "10%", width: "40%", height: "3%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "14%", left: "52%", right: "10%", height: "28%", background: BAR_SOFT })} />
        </>
      )}
      {k === "corporate" && (
        <>
          <div style={abs({ top: "10%", left: "10%", width: "62%", height: "6%", background: BAR })} />
          <div style={abs({ top: "20%", left: "10%", width: "38%", height: "3%", background: BAR_SOFT })} />
          {/* A small bar set on a baseline: one figure leads the card. */}
          <div style={abs({ bottom: "22%", left: "14%", width: "12%", height: "24%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "22%", left: "31%", width: "12%", height: "38%", background: ACCENT })} />
          <div style={abs({ bottom: "22%", left: "48%", width: "12%", height: "30%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "22%", left: "65%", width: "12%", height: "46%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "20%", left: "10%", right: "10%", height: 1, background: BAR })} />
        </>
      )}
      {k === "auto" && (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: big ? 22 : 14 }}
            aria-hidden
          >
            auto_awesome
          </span>
        </div>
      )}
    </div>
  );
}

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
  const renderMini = (key: string, opts: { big?: boolean }) =>
    isSocial ? (
      <SocialStyleMini
        k={key as SocialStyleKey | "auto"}
        big={opts.big}
        boldSample={t.socialBoldSample}
      />
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
          {renderMini(current?.key ?? "auto", {})}
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
                                {renderMini(s.key, { big: true })}
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
                            {renderMini("auto", { big: true })}
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
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  // Full-width grid for /create's own Design step (2026-10-06): big tiles
  // with the one-line description, no inner scroll and no "Show all" modal.
  wide?: boolean;
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
  const tiles = allTiles.filter((tl) => inSector(tl.key, sector));

  const tile = (tl: (typeof allTiles)[number], big: boolean) => {
    const active = value === tl.value;
    return (
      <div key={tl.key} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(tl.value);
            if (big && !wide) setExpanded(false);
          }}
          aria-pressed={active}
          className={`pick-tile flex w-full flex-col gap-1.5 rounded-lg p-1.5 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
            active ? "is-active" : ""
          }`}
        >
          <StyleThumb k={tl.key} title={t.thumbTitle} dir={dir} />
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
      <PickerExpandModal open={expanded} title={t.allStyles} onClose={() => setExpanded(false)}>
        <div className="mb-3">
          <SectorChips value={sector} onChange={setSector} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {tiles.map((tl) => tile(tl, true))}
        </div>
      </PickerExpandModal>
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
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const t = dict.flows.stylePicker;
  const descs: Record<string, string> = t.socialDescs;
  const tiles: ReadonlyArray<{ key: SocialStyleKey | "auto"; name: string; desc: string; value: string | null }> = [
    { key: "auto", name: t.auto, desc: t.autoDesc, value: null },
    ...SOCIAL_STYLES.map((s) => ({ key: s.key, name: s.label, desc: descs[s.key] ?? "", value: s.label })),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tl) => {
        const active = value === tl.value;
        return (
          <button
            key={tl.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tl.value)}
            aria-pressed={active}
            className={`pick-tile flex w-full flex-col gap-1.5 rounded-xl p-2 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "is-active" : ""
            }`}
          >
            <div className="mx-auto w-3/4">
              <SocialStyleMini k={tl.key} big boldSample={t.socialBoldSample} />
            </div>
            <span className="truncate text-[13px] font-medium text-foreground/85">{tl.name}</span>
            <span className="-mt-1 text-[11px] leading-4 text-foreground/55">{tl.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
