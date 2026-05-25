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
  // Label override — defaults to "إنشاء" (the create-flow term).
  // /enhance might want "إنشاء العرض" or just stick with "إنشاء"
  // for consistency. Pass through.
  label = "إنشاء",
  loadingLabel = "جارٍ الإنشاء...",
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
        className="btn-gradient-anim flex h-11 items-stretch transition-shadow"
        style={{ borderRadius: 9999 }}
      >
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled || loading}
          aria-label={label}
          className="relative inline-flex items-center justify-center gap-2 bg-transparent px-6 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderRadius: "9999px 0 0 9999px" }}
        >
          {loading ? (
            <span className="spinner h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 18 }}
            >
              auto_awesome
            </span>
          )}
          <span>{loading ? loadingLabel : label}</span>
        </button>
        {/* 1 px divider between the two clickable areas. Muted via
            the glass-border opacity token (--tq-border-glass). */}
        <span
          aria-hidden
          className="my-2 w-px bg-[var(--tq-border-glass)]"
        />
        <button
          type="button"
          onClick={() => setPresetMenuOpen((v) => !v)}
          disabled={disabled || loading}
          aria-label={presetMenuOpen ? "إغلاق قائمة الجودة" : "اختيار جودة"}
          aria-expanded={presetMenuOpen}
          className="relative inline-flex w-10 items-center justify-center bg-transparent text-white disabled:cursor-not-allowed disabled:opacity-60"
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
            dir="rtl"
            className="backdrop-blur-glass absolute right-0 bottom-full z-30 mb-2 w-56 overflow-hidden rounded-2xl border shadow-2xl bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
          >
            <div className="px-3 py-2 text-[11px] text-white/40">
              جودة التوليد
            </div>
            {QUALITY_PRESETS.map((preset) => {
              const eta = estimateMinutes(preset.key, effectiveSlideCount);
              const active = quality === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    onQualityChange(preset.key);
                    setPresetMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm transition-colors ${
                    active
                      ? "bg-white/[0.06] text-white"
                      : "text-white/70 hover:bg-white/[0.04] hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="material-symbols-outlined leading-none"
                      style={{ fontSize: 16, opacity: active ? 1 : 0 }}
                    >
                      check
                    </span>
                    <span>{preset.label}</span>
                  </span>
                  <span className="text-[11px] text-white/40" dir="ltr">
                    ~{eta} د
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
