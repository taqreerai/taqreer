"use client";

// Shared Generate CTA — the pill-shaped split button used at the
// end of the create flow (post-summary) AND on the single-shot
// /enhance/content page. Two clickable halves inside one glass
// pill:
//
//   ┌──────────────────┬───┐
//   │  ✨ إنشاء          │ ▲ │   ← right half opens preset menu
//   └──────────────────┴───┘
//
// The visual chrome is the canonical `.btn-gradient-anim` class
// (animated mesh-stroke at idle + full-body gradient on hover —
// the design system's signal for "Claude does work here", see
// globals.css PATTERN 4). The menu pops ABOVE the button so it
// doesn't trigger a viewport scroll on shorter screens (matches
// /create/summary's anchoring).
//
// Lifted out of app/create/summary/page.tsx 2026-05-25 so the
// /enhance flow's single-shot page can reuse the exact same CTA
// (per "reuse existing components" rule). Both call sites pass
// their own `onGenerate`, `quality`, `disabled`, `loading`.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  QUALITY_PRESETS,
  estimateMinutes,
  type Quality,
} from "@/lib/types/quality";
import { useDict } from "@/components/i18n/LocaleProvider";
import { generationCost } from "@/lib/credits/cost";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";

export function GenerateSplitButton({
  onGenerate,
  quality,
  onQualityChange,
  // Slide count drives the ETA shown in the preset menu. Falls
  // back to 8 (the historical default) when missing — the menu
  // is decorative anyway, no real consequence.
  slideCount,
  disabled = false,
  loading = false,
  // Label override — defaults to the localized "Create" (the create-flow term,
  // dict.flows.generate.create). /enhance can pass its own copy. Pass through.
  label,
  loadingLabel,
}: {
  onGenerate: () => void;
  quality: Quality;
  onQualityChange: (next: Quality) => void;
  slideCount?: number | null;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
}) {
  const dict = useDict();
  const resolvedLabel = label ?? dict.flows.generate.create;
  const resolvedLoadingLabel = loadingLabel ?? dict.flows.generate.creating;
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const splitButtonRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click / Escape. Same shape as the
  // inline version in /create/summary (single source of truth now).
  useEffect(() => {
    if (!presetMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!splitButtonRef.current?.contains(event.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [presetMenuOpen]);

  const effectiveSlideCount =
    slideCount && slideCount > 0 ? slideCount : 8;
  // Live balance for the per-preset credit estimate (§3a of the
  // subscription model: model choice is a cost choice, made with the
  // price in view). Null until the first fetch - rows render without
  // the credit chip rather than with a wrong number.
  const credits = useCreditBalance();

  return (
    <div ref={splitButtonRef} className="relative">
      {/* Outer pill — the `.btn-gradient-anim` class supplies the
          full animated chrome (border + hover fill). Inner buttons
          carry no background of their own. `dir="ltr"` on the
          wrapper forces a deterministic visual order regardless of
          any RTL inheritance from the surrounding shell — main on
          the visual left, arrow on the visual right. */}
      <div
        dir="ltr"
        className="btn-gradient-anim group relative flex h-11 items-stretch transition-shadow"
        style={{ borderRadius: 9999 }}
      >
        {/* Generate half — `motion.button` with `layout` so the pill
            width transitions smoothly when the label switches between
            the idle term ("إنشاء", short) and the loading variant
            ("جارٍ الإنشاء...", longer). Without `layout` the button
            snaps to its new width in one frame, which reads as a
            jarring "expand" the moment loading kicks in. `layout`
            measures the before/after size and tweens. Position
            animation only — bfcache-safe (verified pattern from
            ProjectsGrid 2026-05-25). */}
        <motion.button
          layout
          type="button"
          onClick={onGenerate}
          disabled={disabled || loading}
          aria-label={label}
          className="relative z-10 inline-flex items-center justify-center gap-2 bg-transparent px-6 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderRadius: "9999px 0 0 9999px" }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {loading ? (
            <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/30 border-t-white" />
          ) : (
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 18 }}
            >
              auto_awesome
            </span>
          )}
          <span>{loading ? resolvedLoadingLabel : resolvedLabel}</span>
        </motion.button>
        {/* 1 px divider between the two clickable areas. Muted via
            the glass-border opacity token (--tq-border-hairline). */}
        <span
          aria-hidden
          className="my-2 w-px bg-[var(--tq-border-hairline)] group-hover:bg-white/25"
        />
        <button
          type="button"
          onClick={() => setPresetMenuOpen((v) => !v)}
          disabled={disabled || loading}
          aria-label={presetMenuOpen ? dict.flows.generate.closeQualityMenu : dict.flows.generate.chooseQuality}
          aria-expanded={presetMenuOpen}
          className="relative z-10 inline-flex w-10 items-center justify-center bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderRadius: "0 9999px 9999px 0" }}
        >
          <span
            className={`material-symbols-outlined leading-none transition-transform ${
              presetMenuOpen ? "rotate-180" : ""
            }`}
            style={{ fontSize: 18 }}
          >
            expand_less
          </span>
        </button>
      </div>

      {/* Preset menu — pops ABOVE the split button. Anchored to
          bottom-full + mb-2 so it never triggers viewport scroll. */}
      <AnimatePresence>
        {presetMenuOpen ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ type: "spring", bounce: 0.25, duration: 0.25 }}
            className=" absolute start-0 bottom-full z-30 mb-2 w-80 overflow-hidden rounded-2xl border bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]"
          >
            <div className="flex items-center justify-between px-3 py-2 text-[11px] text-foreground/40">
              <span>{dict.flows.generate.generationQuality}</span>
              {credits ? (
                <span dir="ltr" className="tabular-nums">
                  {dict.flows.generate.balance.replace(
                    "{count}",
                    formatCredits(credits.balance.total),
                  )}
                </span>
              ) : null}
            </div>
            {QUALITY_PRESETS.map((preset) => {
              const eta = estimateMinutes(preset.key, effectiveSlideCount);
              const cost = generationCost(preset.key, effectiveSlideCount);
              const affordable = credits ? cost <= credits.balance.total : true;
              const active = quality === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    onQualityChange(preset.key);
                    setPresetMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-start text-sm transition-colors ${
                    active
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
                  }`}
                >
                  {/* Left cluster (visual right in RTL): check + label.
                      `flex-1` so the label cluster grows and pushes the
                      chip + eta to a stable visual-left edge — chips and
                      etas end up vertically aligned across rows
                      regardless of label width. */}
                  <span className="flex flex-1 items-center gap-2 min-w-0">
                    <span
                      className="material-symbols-outlined leading-none"
                      style={{ fontSize: 16, opacity: active ? 1 : 0 }}
                    >
                      check
                    </span>
                    <span className="truncate">{preset.label}</span>
                  </span>
                  {/* Right cluster (visual left in RTL): thinking chip
                      + ETA. Both pinned to a consistent x position
                      across rows. The chip sits to the right of the
                      ETA in DOM order, which in RTL renders the chip
                      VISUALLY to the LEFT of the eta and to the FAR
                      right of the eta cluster — same column down the
                      list. Driven by the `thinking` field on each
                      QUALITY_PRESETS entry; mirror of
                      `paramsForQuality()`'s `thinking.type`. */}
                  <span className="flex shrink-0 items-center gap-2">
                    {preset.thinking ? (
                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none text-emerald-200 bg-emerald-500/15">
                        {dict.flows.generate.thinking}
                      </span>
                    ) : (
                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none text-foreground/50 bg-[var(--tq-surface)]">
                        {dict.flows.generate.fast}
                      </span>
                    )}
                    <span className="text-[11px] text-foreground/40 tabular-nums" dir="ltr">
                      {dict.flows.generate.etaMin.replace("{eta}", String(eta))}
                    </span>
                    {/* Per-preset credit estimate - the same cost table
                        the ledger charges from (lib/credits/cost.ts), so
                        the shown number IS the held number. Amber when
                        the current balance doesn't cover it. */}
                    {credits ? (
                      <span
                        className={`text-[11px] tabular-nums ${
                          affordable ? "text-foreground/60" : "text-amber-400"
                        }`}
                        dir="ltr"
                      >
                        {dict.flows.generate.creditsEstimate.replace(
                          "{credits}",
                          formatCredits(cost),
                        )}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
