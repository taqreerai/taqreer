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

// Option label -> dict desc key. Labels mirror DESIGN_STYLE_OPTIONS in
// OutputCards.tsx (the prompt anchors - keep in sync).
const STYLES: ReadonlyArray<{ label: string; key: StyleKey }> = [
  { label: "Swiss / Grid", key: "swiss" },
  { label: "Corporate / Data", key: "corporate" },
  { label: "Minimal / Keynote", key: "minimal" },
  { label: "Editorial", key: "editorial" },
  { label: "Bold / Display", key: "bold" },
  { label: "Duotone / Full-bleed", key: "duotone" },
  { label: "Playful / Dopamine", key: "playful" },
  { label: "Brutalist", key: "brutalist" },
];
type StyleKey =
  | "swiss"
  | "corporate"
  | "minimal"
  | "editorial"
  | "bold"
  | "duotone"
  | "playful"
  | "brutalist";

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
];
type SocialStyleKey =
  | "boldtype"
  | "editorial"
  | "grainy"
  | "brutalist"
  | "minimal"
  | "photo"
  | "retro"
  | "pop3d";

// ── The static mini-slide previews ──────────────────────────────
// Each is a 16:9 box composed of token-colored blocks. Percentage
// geometry so ONE markup serves both the small trigger swatch and the
// gallery cards. `bar` = muted block; accent = var(--tq-purple).
const BAR = "var(--tq-text-muted)";
const BAR_SOFT = "color-mix(in srgb, var(--tq-text-muted) 45%, transparent)";
const ACCENT = "var(--tq-purple)";

function StyleMini({
  k,
  big = false,
  // Locale-aware sample word for the Bold/Display preview ("عرض" in
  // AR, "Deck" in EN).
  boldSample = "عرض",
}: {
  k: StyleKey | "auto";
  big?: boolean;
  boldSample?: string;
}) {
  const base =
    "relative w-full overflow-hidden rounded-md border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)]";
  const abs = (s: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    ...s,
  });
  return (
    <div className={base} style={{ aspectRatio: "16/9" }} dir="ltr">
      {k === "swiss" && (
        <>
          {/* The grid itself as hairlines (2 columns x 2 rows) with
              small text-like dashes in the cells + one blue marker -
              reads as a layout grid, not content blocks (user
              direction 2026-06-12). */}
          <div style={abs({ top: "8%", bottom: "8%", left: "36%", width: 1, background: BAR_SOFT })} />
          <div style={abs({ top: "8%", bottom: "8%", left: "67%", width: 1, background: BAR_SOFT })} />
          <div style={abs({ left: "8%", right: "8%", top: "48%", height: 1, background: BAR_SOFT })} />
          <div style={abs({ top: "16%", left: "10%", width: "18%", height: "7%", background: BAR })} />
          <div style={abs({ top: "30%", left: "10%", width: "12%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "16%", left: "41%", width: "14%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "26%", left: "41%", width: "18%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "16%", left: "72%", width: "16%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "60%", left: "10%", width: "8%", aspectRatio: "1", background: ACCENT })} />
          <div style={abs({ top: "60%", left: "41%", width: "16%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "70%", left: "41%", width: "12%", height: "4%", background: BAR_SOFT })} />
          <div style={abs({ top: "60%", left: "72%", width: "14%", height: "4%", background: BAR_SOFT })} />
        </>
      )}
      {k === "corporate" && (
        <>
          <div style={abs({ top: "10%", left: "8%", width: "44%", height: "10%", background: BAR })} />
          <div style={abs({ bottom: "12%", left: "8%", width: "12%", height: "28%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "12%", left: "24%", width: "12%", height: "48%", background: ACCENT })} />
          <div style={abs({ bottom: "12%", left: "40%", width: "12%", height: "38%", background: BAR_SOFT })} />
          <div style={abs({ bottom: "12%", left: "56%", width: "12%", height: "60%", background: BAR })} />
        </>
      )}
      {k === "minimal" && (
        <>
          <div style={abs({ top: "44%", left: "30%", width: "40%", height: "9%", background: BAR })} />
          <div style={abs({ top: "60%", left: "40%", width: "20%", height: "5%", background: BAR_SOFT })} />
        </>
      )}
      {k === "editorial" && (
        <>
          <div style={abs({ top: "10%", left: "6%", width: "34%", height: "14%", background: BAR })} />
          <div style={abs({ top: "30%", bottom: "12%", left: "6%", width: "34%", background: BAR_SOFT })} />
          <div style={abs({ top: "10%", bottom: "12%", left: "46%", width: "22%", background: BAR_SOFT })} />
          <div style={abs({ top: "10%", bottom: "12%", left: "72%", width: "22%", background: BAR_SOFT })} />
        </>
      )}
      {k === "bold" && (
        <div
          className="flex h-full w-full items-center justify-center font-black text-foreground"
          style={{ fontSize: big ? 34 : 13, lineHeight: 1 }}
        >
          {boldSample}
        </div>
      )}
      {k === "duotone" && (
        <>
          <div style={abs({ inset: 0, background: "color-mix(in srgb, var(--tq-purple) 55%, black)" })} />
          <div style={abs({ inset: 0, background: ACCENT, clipPath: "polygon(0 0, 62% 0, 34% 100%, 0 100%)" })} />
          <div style={abs({ bottom: "12%", right: "8%", width: "36%", height: "8%", background: "#fff" })} />
        </>
      )}
      {k === "playful" && (
        <>
          <div style={abs({ top: "14%", left: "12%", width: "22%", aspectRatio: "1", borderRadius: "50%", background: ACCENT })} />
          <div style={abs({ bottom: "16%", right: "14%", width: "30%", height: "22%", borderRadius: 999, background: BAR_SOFT })} />
          <div style={abs({ top: "46%", left: "52%", width: "10%", aspectRatio: "1", borderRadius: "50%", background: BAR })} />
        </>
      )}
      {k === "brutalist" && (
        <>
          <div style={abs({ inset: "10%", border: `${big ? 3 : 2}px solid var(--tq-text-primary)` })} />
          <div style={abs({ top: "10%", left: "10%", width: "44%", height: "16%", background: "var(--tq-text-primary)" })} />
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
  const renderMini = (key: string, opts: { big?: boolean }) =>
    isSocial ? (
      <SocialStyleMini
        k={key as SocialStyleKey | "auto"}
        big={opts.big}
        boldSample={t.socialBoldSample}
      />
    ) : (
      <StyleMini k={key as StyleKey | "auto"} big={opts.big} boldSample={t.boldSample} />
    );
  const [open, setOpen] = useState(false);
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
            {current ? current.label : t.auto}
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

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {styles.map((s) => {
                          const active = value === s.label;
                          return (
                            <button
                              key={s.key}
                              type="button"
                              onClick={() => {
                                onChange(s.label);
                                setOpen(false);
                              }}
                              className={`rounded-xl border p-2 text-start transition-colors ${
                                active
                                  ? "border-transparent outline outline-2 outline-[var(--tq-purple)]"
                                  : "border-[var(--tq-border-hairline)] hover:border-[var(--tq-purple)]"
                              }`}
                            >
                              <div className={isSocial ? "mx-auto w-3/5" : undefined}>
                                {renderMini(s.key, { big: true })}
                              </div>
                              <p className="mt-2 text-[12px] font-semibold text-foreground">
                                {s.label}
                              </p>
                              <p className="text-[11px] text-muted">{descs[s.key]}</p>
                            </button>
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
