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

export function DesignStylePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.flows.stylePicker;
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  const current = STYLES.find((s) => s.label === value) ?? null;

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
        <div className="w-14 shrink-0">
          <StyleMini k={current?.key ?? "auto"} boldSample={t.boldSample} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {current ? current.label : t.auto}
          </p>
          <p className="truncate text-[11px] text-muted">
            {current ? t.descs[current.key] : t.autoDesc}
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
                        {STYLES.map((s) => {
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
                              <StyleMini k={s.key} big boldSample={t.boldSample} />
                              <p className="mt-2 text-[12px] font-semibold text-foreground">
                                {s.label}
                              </p>
                              <p className="text-[11px] text-muted">{t.descs[s.key]}</p>
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
                          <StyleMini k="auto" big />
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
