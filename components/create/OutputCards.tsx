"use client";

// Output-settings cards — extracted from the old `/create/output` page
// so they can be reused INLINE on `/create/content` as the bottom-row
// (the 4-step → 3-step flow merged output settings into step 1; see
// `context/log.md` 2026-05-19). Two cards:
//   • <CanvasCard>          slide size + persistent overlay
//   • <OutputContentCard>   slide count + generation rules
// Logo placement (the third group that used to live here) was moved
// to step-2's logo card — see `<LogoPositionFields>` below.
//
// The card primitives (CardShell / SectionLabel / SlideCountStepper /
// SizeChoice) are also exported because step 1 may want to extend the
// row with bespoke cards later without copying their CSS recipes.

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Pill,
  PositionPicker,
  type CornerPosition,
} from "@/components/create/controls";

export type SlideSize = "16:9" | "9:16";
export type SlideCountMode = "auto" | "custom";
// File-local alias — used by LogoPlacementCard below. Not exported
// because no external consumer uses it (callers pass `CornerPosition`
// directly).
type LogoPosition = CornerPosition;
export type PersistentPosition = CornerPosition;

export const DESIGN_STYLE_OPTIONS = [
  "إبداعي",
  "بسيط",
  "احترافي",
  "مرح",
  "صحفي",
  "جريء",
];

// Content language — user-picked on /create/content. Drives:
//   • Project.language + Presentation.language (filter-accuracy on
//     /projects, and the Phase B/C work below)
//   • Presentation.direction (ar → rtl, en → ltr)
//   • Phase B (shipped 2026-05-20): user-message directive in
//     buildUserMessage gates output language
//   • Phase C (TBD): BiDi post-processor gating + rendered HTML dir
// Default "ar" matches the historical hardcoded value, so existing
// stored blobs without a language field keep working as-is. The "bi"
// (bilingual) bucket was retired the same day — the existing AR
// prompt already handles inline mixed-script runs cleanly, and a
// separate BI bucket added complexity without UX gain for the
// Middle East target audience.
export type StoredOutputLanguage = "ar" | "en";

export type StoredOutput = {
  slideSize?: SlideSize;
  // `mode === "match"` was the file-upload-only "match the source" pill —
  // dropped 2026-05-19 alongside the file-binary submission path (content
  // is always text now). Existing stored blobs with `mode: "match"` fall
  // back to "auto" via the readers in the consumer pages.
  slideCount?: { mode?: SlideCountMode; value?: number | null };
  language?: StoredOutputLanguage;
  logo?: {
    position?: LogoPosition;
    excludeCover?: boolean;
    excludeClosing?: boolean;
  };
  // `fixTypos` removed 2026-05-20: the toggle was retired in favor of
  // language-aware behavior (the model now respects source verbatim
  // by default; future Phase B will surface tone/correction picks per
  // language). Existing stored blobs with `rules.fixTypos` still
  // serialize fine — the field just isn't read anymore.
  rules?: {
    designStyle?: string | null;
    pagination?: boolean;
    persistent?: {
      text?: string;
      position?: PersistentPosition;
      excludeCover?: boolean;
      excludeClosing?: boolean;
    } | null;
  };
};

// ─── Card primitives (shared) ─────────────────────────────────────

// Glass-card chrome with a Framer Motion `layout` animation that
// settles in two rAFs (so the parent's sessionStorage hydration tick
// doesn't render as a "stretch on mount").
export function CardShell({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  const [layoutEnabled, setLayoutEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let id2: number | null = null;
    const id1 = window.requestAnimationFrame(() => {
      id2 = window.requestAnimationFrame(() => {
        if (!cancelled) setLayoutEnabled(true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id1);
      if (id2 !== null) window.cancelAnimationFrame(id2);
    };
  }, []);

  return (
    <motion.div
      layout={layoutEnabled}
      transition={{ layout: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
      className="glass-card flex flex-col gap-4 rounded-2xl p-5"
    >
      <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <span
          className="material-symbols-outlined text-white"
          style={{ fontSize: "18px" }}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </header>
      <motion.div
        layout={layoutEnabled}
        className="flex flex-1 flex-col gap-4"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-white/80">{children}</p>;
}

// Number stepper for the custom slide-count input. All three controls
// are h-8 so the stepper drops cleanly into the pill row.
function SlideCountStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const stepBtnClasses =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
  const stepBtnStyle = {
    background: "rgba(255, 255, 255, var(--glass-opacity))",
    borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
  } as const;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label="إنقاص"
        className={stepBtnClasses}
        style={stepBtnStyle}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          remove
        </span>
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const n = Number(event.target.value);
          onChange(Number.isFinite(n) ? clamp(n) : min);
        }}
        className="input-dark no-spinner text-center text-sm"
        style={{ width: 52, height: 32, padding: "0 8px" }}
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label="زيادة"
        className={stepBtnClasses}
        style={stepBtnStyle}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          add
        </span>
      </button>
    </div>
  );
}

function SizeChoice({
  active,
  onClick,
  label,
  sub,
  ratio,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  ratio: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="backdrop-blur-glass flex h-11 items-center justify-between gap-3 rounded-xl border px-3 transition-colors"
      style={{
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderColor: active
          ? "rgba(255, 255, 255, 1)"
          : "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      <span className="flex flex-col items-start leading-tight">
        <span
          className={`text-xs font-semibold ${active ? "text-white" : "text-white/70"}`}
        >
          {label}
        </span>
        <span className={`text-[10px] ${active ? "text-white/70" : "text-white/40"}`}>
          {sub}
        </span>
      </span>
      <span
        className="rounded-sm border border-white/30 bg-white/10"
        style={{ height: 18, aspectRatio: ratio }}
      />
    </button>
  );
}

// ─── SlideSizeFields — moved INTO the file-upload card on step 1
// ───────────────────────────────────────────────────────────────
// 2026-05-19: slide size pickers were extracted from CanvasCard so
// they can live under the file-upload zone on step 1's row 1. This
// shrinks row 2 (CanvasCard now only carries the persistent overlay)
// which lets the page hit the same total height as step 2 — required
// for the seamless cross-step Next/Previous alignment.

export function SlideSizeFields({
  slideSize,
  onSlideSize,
}: {
  slideSize: SlideSize;
  onSlideSize: (v: SlideSize) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>حجم الشريحة</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <SizeChoice
          active={slideSize === "16:9"}
          onClick={() => onSlideSize("16:9")}
          label="16:9"
          sub="أفقي"
          ratio="16 / 9"
        />
        <SizeChoice
          active={slideSize === "9:16"}
          onClick={() => onSlideSize("9:16")}
          label="9:16"
          sub="عمودي"
          ratio="9 / 16"
        />
      </div>
    </div>
  );
}

// ─── CanvasCard — persistent overlay only ─────────────────────────
// Slide size moved to SlideSizeFields (above) on 2026-05-19 — see
// the comment there. The card name + icon (الشريحة / aspect_ratio)
// stays since the persistent text is still a per-slide canvas concern.

export function CanvasCard({
  persistentText,
  persistentPosition,
  persistentExcludeCover,
  persistentExcludeClosing,
  language,
  onPersistentText,
  onPersistentPosition,
  onPersistentExcludeCover,
  onPersistentExcludeClosing,
}: {
  persistentText: string;
  persistentPosition: PersistentPosition;
  persistentExcludeCover: boolean;
  persistentExcludeClosing: boolean;
  // Optional — drives the persistent-text input's direction so the
  // typed chrome string sits on the visually-correct side. Falls
  // back to "ar" (RTL) for back-compat with any caller that
  // predates the picker.
  language?: StoredOutputLanguage;
  onPersistentText: (s: string) => void;
  onPersistentPosition: (p: PersistentPosition) => void;
  onPersistentExcludeCover: (b: boolean) => void;
  onPersistentExcludeClosing: (b: boolean) => void;
}) {
  return (
    <CardShell title="الشريحة" icon="aspect_ratio">
      <div className="space-y-2">
        <SectionLabel>عنصر ثابت على كل الشرائح</SectionLabel>
        <input
          type="text"
          value={persistentText}
          onChange={(e) => onPersistentText(e.target.value)}
          placeholder="مثل: التاريخ، الموقع الإلكتروني"
          // Direction follows the deck language pill so English
          // overlay text (e.g. "© 2026 · taqreer.ai") types LTR
          // and Arabic ("جميع الحقوق محفوظة") types RTL.
          dir={language === "en" ? "ltr" : "rtl"}
          className="input-dark"
        />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <PositionPicker
            value={persistentPosition}
            onChange={onPersistentPosition}
            disabled={!persistentText.trim()}
          />
          <div className="flex flex-col gap-1.5">
            <Pill
              active={persistentExcludeCover}
              onClick={() => onPersistentExcludeCover(!persistentExcludeCover)}
              disabled={!persistentText.trim()}
            >
              استثناء الغلاف
            </Pill>
            <Pill
              active={persistentExcludeClosing}
              onClick={() =>
                onPersistentExcludeClosing(!persistentExcludeClosing)
              }
              disabled={!persistentText.trim()}
            >
              استثناء الشكر
            </Pill>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ─── OutputContentCard — slide count + generation rules ──────────
// Renamed to avoid clash with the content/free-text "ContentCard"
// pattern names that might appear elsewhere in the codebase.

export function OutputContentCard({
  slideCountMode,
  slideCountValue,
  designStyle,
  onSlideCountMode,
  onSlideCountValue,
  onDesignStyle,
}: {
  slideCountMode: SlideCountMode;
  slideCountValue: number;
  designStyle: string | null;
  onSlideCountMode: (m: SlideCountMode) => void;
  onSlideCountValue: (n: number) => void;
  onDesignStyle: (s: string | null) => void;
}) {
  return (
    <CardShell title="المحتوى" icon="tune">
      <div className="space-y-2">
        <SectionLabel>عدد الشرائح</SectionLabel>
        <div className="flex items-center gap-1.5">
          <Pill
            active={slideCountMode === "auto"}
            onClick={() => onSlideCountMode("auto")}
          >
            تلقائي
          </Pill>
          <Pill
            active={slideCountMode === "custom"}
            onClick={() => onSlideCountMode("custom")}
          >
            مخصص
          </Pill>
          {slideCountMode === "custom" ? (
            <SlideCountStepper
              value={slideCountValue}
              onChange={onSlideCountValue}
              min={1}
              max={20}
            />
          ) : null}
        </div>
      </div>

      {/* Generation-rule toggles (تصحيح الأخطاء / ترقيم الشرائح)
          moved to row 1's free-text card on 2026-05-19 so this row 2
          card stays short and the free-text card has the matching
          height density. Only the design-style pills + slide count
          live here now. */}
      <div className="border-t border-white/[0.06] pt-3">
        <SectionLabel>قواعد التوليد</SectionLabel>
        <div className="pt-2">
          <div className="flex flex-wrap gap-1.5">
            {DESIGN_STYLE_OPTIONS.map((option) => (
              <Pill
                key={option}
                active={designStyle === option}
                onClick={() =>
                  onDesignStyle(designStyle === option ? null : option)
                }
              >
                {option}
              </Pill>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ─── LogoPositionFields — slot for step 2's logo card ────────────
// Renders a 6-corner picker + cover/closing exclude pills. Used by
// the brand page after the logo upload zone. Gated by the calling
// page (only renders when `hasLogo` is true so the card doesn't show
// "where should the logo go?" with no logo present).

export function LogoPositionFields({
  position,
  excludeCover,
  excludeClosing,
  onPosition,
  onExcludeCover,
  onExcludeClosing,
  disabled = false,
  reservedPositions,
}: {
  position: LogoPosition;
  excludeCover: boolean;
  excludeClosing: boolean;
  onPosition: (p: LogoPosition) => void;
  onExcludeCover: (b: boolean) => void;
  onExcludeClosing: (b: boolean) => void;
  // When no logo is uploaded the brand page still renders this block
  // (so the card height doesn't jump on upload) but greys it out — the
  // PositionPicker + Pills internally support `disabled`.
  disabled?: boolean;
  // Corners already claimed by other slide chrome (today: the
  // persistent overlay text from /create/content). Each entry
  // disables that specific button in the position picker so the
  // logo can't be placed in the same corner — two chrome elements
  // would otherwise overlap. Empty array / undefined → all 6
  // corners are available.
  reservedPositions?: LogoPosition[];
}) {
  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-3">
      <SectionLabel>موقع الشعار</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <PositionPicker
          value={position}
          onChange={onPosition}
          disabled={disabled}
          disabledValues={reservedPositions}
          disabledTooltip="محجوز للنص الثابت"
        />
        <div className="flex flex-col gap-1.5">
          <Pill
            active={excludeCover}
            onClick={() => onExcludeCover(!excludeCover)}
            disabled={disabled}
          >
            استثناء الغلاف
          </Pill>
          <Pill
            active={excludeClosing}
            onClick={() => onExcludeClosing(!excludeClosing)}
            disabled={disabled}
          >
            استثناء الشكر
          </Pill>
        </div>
      </div>
    </div>
  );
}
