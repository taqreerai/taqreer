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
import { DesignStylePicker } from "@/components/create/DesignStylePicker";
import { motion } from "framer-motion";
import {
  Pill,
  PositionPicker,
  type CornerPosition,
} from "@/components/create/controls";
import { useDict } from "@/components/i18n/LocaleProvider";
import type { SlideFormat } from "@/lib/schema/slide";

// Derived from SlideFormat (the single source of truth) so the two can never
// drift when a ratio is added or removed.
export type SlideSize = SlideFormat;
export type SlideCountMode = "auto" | "custom";
// File-local alias — used by LogoPlacementCard below. Not exported
// because no external consumer uses it (callers pass `CornerPosition`
// directly).
type LogoPosition = CornerPosition;
export type PersistentPosition = CornerPosition;

// Create-flow design styles (Part B.3, 2026-06-03). English names — they
// double as the picker label, the deck-generate DESIGN_STYLE_DIRECTIVES key,
// and the in-prompt anchor, so Claude can lean on the named tradition. Ordered
// safe → expressive. Keep in sync with DESIGN_STYLE_DIRECTIVES in
// inngest/functions/deck-generate.ts.
export const DESIGN_STYLE_OPTIONS = [
  "Swiss / Grid",
  "Corporate / Data",
  "Minimal / Keynote",
  "Editorial",
  "Bold / Display",
  "Duotone / Full-bleed",
  "Playful / Dopamine",
  "Brutalist",
];

// Styles whose look leans on imagery → picking one auto-enables images mode
// (overridable — the toggle flips on but isn't disabled; turning it off uses
// the style's no-image fallback). The other four are image-averse / optional
// and leave the toggle as the user set it.
export const STYLE_REQUIRES_IMAGES = new Set<string>([
  "Duotone / Full-bleed",
  "Editorial",
  "Minimal / Keynote",
  "Playful / Dopamine",
]);

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
      className="surface-card flex flex-col gap-4 rounded-2xl p-5"
    >
      <header className="flex items-center gap-2 border-b border-foreground/[0.08] pb-3">
        <span
          className="material-symbols-outlined text-foreground"
          style={{ fontSize: "18px" }}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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
  return <p className="text-xs font-semibold text-foreground/80">{children}</p>;
}

// Number stepper for the custom slide-count input. All three controls
// are h-8 so the stepper drops cleanly into the pill row.
export function SlideCountStepper({
  value,
  onChange,
  min,
  max,
  // Visual size variant. Default keeps /create's existing
  // h-8 / w-52 dimensions (byte-identical). "compact" shrinks
  // everything ~25% for /mimic where the stepper sits beside
  // text-xs labels and inline pills.
  size = "default",
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  size?: "default" | "compact";
}) {
  const dict = useDict();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const compact = size === "compact";
  const stepBtnClasses = `flex ${
    compact ? "h-6 w-6" : "h-8 w-8"
  } shrink-0 items-center justify-center rounded-full border text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40`;
  const stepBtnStyle = {
    background: "var(--tq-overlay-soft)",
    borderColor: "var(--tq-border-hairline)",
  } as const;
  const iconSize = compact ? 14 : 16;
  const inputDims = compact
    ? { width: 40, height: 24, padding: "0 6px" }
    : { width: 52, height: 32, padding: "0 8px" };
  return (
    <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={dict.flows.output.decrease}
        className={stepBtnClasses}
        style={stepBtnStyle}
      >
        <span className="material-symbols-outlined" style={{ fontSize: iconSize }}>
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
        // a11y: screen readers announce field purpose. Custom input
        // sits between − / + buttons with no visible <label>, so the
        // programmatic name comes from aria-label.
        aria-label={dict.flows.slideCount}
        className={`input-dark no-spinner text-center ${
          compact ? "text-xs" : "text-sm"
        }`}
        style={inputDims}
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={dict.flows.output.increase}
        className={stepBtnClasses}
        style={stepBtnStyle}
      >
        <span className="material-symbols-outlined" style={{ fontSize: iconSize }}>
          add
        </span>
      </button>
    </div>
  );
}

// ─── InlineStepper — single-pill compact stepper ──────────────────
// Originally lived inline in app/create/page.tsx; promoted here
// 2026-05-26 so /mimic can use the SAME stepper + animation as
// /create (user direction: "unify عدد الشرائح, use the one at
// create on mimic, same animation and layout").
//
// Difference vs. SlideCountStepper: this is a single rounded-full
// pill containing − / number / + as flat siblings (no individual
// button borders). Total natural width ≈ 66 px (h-5 buttons + w-6
// number input + 2-px border). The compact footprint lets it sit
// next to a SegmentedToggle inside a single-row slide-count cluster
// without ever wrapping or pushing the label.
//
// Used together with framer-motion AnimatePresence + parent
// motion.div(layout) at the call site for a smooth enter/exit
// width animation. See app/create/page.tsx and app/mimic/page.tsx
// for the canonical wrapper pattern.
export function InlineStepper({
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
  const dict = useDict();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div
      // h-29 matches the SegmentedToggle default size's rendered height
      // (p-0.5 track + py-1 text-[10px] segments) so the stepper reads
      // as the same control height when they share a row. Width stays
      // ~66 px (button h-5 w-5, input w-6) — the call sites' width:66
      // mount animation depends on it. The 1-px border-glass token +
      // glass-bg match the rest of the input chrome on /create + /mimic.
      className="flex items-center rounded-full border"
      style={{
        height: 29,
        background: "var(--tq-overlay-soft)",
        borderColor: "var(--tq-border-hairline)",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={dict.flows.output.decrease}
        className="flex h-5 w-5 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 11 }}>
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
        aria-label={dict.flows.slideCount}
        className="no-spinner w-6 bg-transparent text-center text-[11px] text-foreground outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={dict.flows.output.increase}
        className="flex h-5 w-5 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 11 }}>
          add
        </span>
      </button>
    </div>
  );
}

// ─── SlideCountFields — auto/custom + stepper, exported for reuse ──
// /create's OutputContentCard ALREADY renders this exact cluster
// (SectionLabel + Pill row + conditional SlideCountStepper). The
// promotion to a standalone export keeps /mimic's "what to mimic"
// card visually byte-identical to /create's slide-count UI while
// leaving the original call site (OutputContentCard) untouched.
//
// Default copy/range matches /create: "عدد الشرائح" label, 1..20.
// `hideLabel` mirrors SlideSizeFields' option for tighter card
// layouts where the surrounding context already implies the field's
// purpose (e.g. /mimic where space is at a premium under the
// branding toggle).
export function SlideCountFields({
  mode,
  value,
  onMode,
  onValue,
  label,
  hideLabel = false,
  min = 1,
  max = 20,
}: {
  mode: SlideCountMode;
  value: number;
  onMode: (m: SlideCountMode) => void;
  onValue: (n: number) => void;
  label?: string;
  hideLabel?: boolean;
  min?: number;
  max?: number;
}) {
  const dict = useDict();
  return (
    <div className="space-y-2">
      {hideLabel ? null : <SectionLabel>{label ?? dict.flows.slideCount}</SectionLabel>}
      <div className="flex items-center gap-1.5">
        <Pill active={mode === "auto"} onClick={() => onMode("auto")}>
          {dict.flows.auto}
        </Pill>
        <Pill active={mode === "custom"} onClick={() => onMode("custom")}>
          {dict.flows.custom}
        </Pill>
        {mode === "custom" ? (
          <SlideCountStepper
            value={value}
            onChange={onValue}
            min={min}
            max={max}
          />
        ) : null}
      </div>
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
      className=" flex h-11 items-center justify-between gap-3 rounded-lg border px-3 transition-colors"
      style={{
        background: "var(--tq-overlay-soft)",
        borderColor: active
          ? "var(--tq-blue)"
          : "var(--tq-border-hairline)",
      }}
    >
      <span className="flex flex-col items-start leading-tight">
        <span
          className={`text-xs font-semibold ${active ? "text-[var(--tq-blue)]" : "text-foreground/70"}`}
        >
          {label}
        </span>
        <span className={`text-[10px] ${active ? "text-foreground/70" : "text-foreground/40"}`}>
          {sub}
        </span>
      </span>
      <span
        className="rounded-xs border border-foreground/30 bg-foreground/10"
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
  // Direction of the two SizeChoice tiles:
  //   • horizontal (default) — grid-cols-2 side-by-side. Matches the
  //     /create + /create-from-template call sites unchanged.
  //   • vertical (`stacked`) — single column, tiles stacked. Used by
  //     /mimic's compact content card where the slide-size picker
  //     shares a row with the logo slot and needs to claim less
  //     horizontal real estate.
  stacked = false,
  // Optional section label override. /create keeps the default
  // "حجم الشريحة" (slide size) when omitted, so existing call
  // sites are byte-identical.
  label,
  // Skip the SectionLabel row entirely. /mimic uses this in its
  // compact content card where the SizeChoice tiles read clearly
  // enough on their own (16:9 / 9:16) — the header word adds a
  // vertical band the card can't afford. /create keeps its label
  // since the field shares space with other section headers.
  hideLabel = false,
  // Third 3:4 "Post" tile (1080×1440 social carousel). /create only —
  // /mimic and /datasheet omit the prop and stay at the 2-tile grid,
  // and /enhance derives its format from the uploaded deck.
  withPost = false,
}: {
  slideSize: SlideSize;
  onSlideSize: (v: SlideSize) => void;
  stacked?: boolean;
  label?: string;
  hideLabel?: boolean;
  withPost?: boolean;
}) {
  const dict = useDict();
  const cols = stacked
    ? "grid grid-cols-1 gap-2"
    : withPost
      ? "grid grid-cols-3 gap-2"
      : "grid grid-cols-2 gap-2";
  return (
    <div className="space-y-2">
      {hideLabel ? null : <SectionLabel>{label ?? dict.flows.output.slideSize}</SectionLabel>}
      <div className={cols}>
        <SizeChoice
          active={slideSize === "16:9"}
          onClick={() => onSlideSize("16:9")}
          label="16:9"
          sub={dict.flows.output.landscape}
          ratio="16 / 9"
        />
        <SizeChoice
          active={slideSize === "9:16"}
          onClick={() => onSlideSize("9:16")}
          label="9:16"
          sub={dict.flows.output.portrait}
          ratio="9 / 16"
        />
        {withPost ? (
          <SizeChoice
            active={slideSize === "3:4"}
            onClick={() => onSlideSize("3:4")}
            label="3:4"
            sub={dict.flows.output.post}
            ratio="3 / 4"
          />
        ) : null}
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
  const dict = useDict();
  return (
    <CardShell title={dict.flows.output.slideCard} icon="aspect_ratio">
      <div className="space-y-2">
        <SectionLabel>{dict.flows.brand.persistentAria}</SectionLabel>
        <input
          type="text"
          value={persistentText}
          onChange={(e) => onPersistentText(e.target.value)}
          placeholder={dict.flows.output.persistentPlaceholderShort}
          // a11y: SectionLabel above is visual only; programmatic
          // name comes from aria-label so screen readers announce
          // field purpose.
          aria-label={dict.flows.output.persistentText}
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
          <div className="flex flex-col items-start gap-1.5">
            <Pill
              active={persistentExcludeCover}
              onClick={() => onPersistentExcludeCover(!persistentExcludeCover)}
              disabled={!persistentText.trim()}
            >
              {dict.flows.controls.excludeCover}
            </Pill>
            <Pill
              active={persistentExcludeClosing}
              onClick={() =>
                onPersistentExcludeClosing(!persistentExcludeClosing)
              }
              disabled={!persistentText.trim()}
            >
              {dict.flows.controls.excludeLast}
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
  const dict = useDict();
  return (
    <CardShell title={dict.flows.contentCard} icon="tune">
      <div className="space-y-2">
        <SectionLabel>{dict.flows.slideCount}</SectionLabel>
        <div className="flex items-center gap-1.5">
          <Pill
            active={slideCountMode === "auto"}
            onClick={() => onSlideCountMode("auto")}
          >
            {dict.flows.auto}
          </Pill>
          <Pill
            active={slideCountMode === "custom"}
            onClick={() => onSlideCountMode("custom")}
          >
            {dict.flows.custom}
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
      <div className="border-t border-foreground/[0.06] pt-3">
        <SectionLabel>{dict.flows.output.generationRules}</SectionLabel>
        <div className="pt-2">
          <DesignStylePicker value={designStyle} onChange={onDesignStyle} />
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
  const dict = useDict();
  return (
    <div className="space-y-2 border-t border-foreground/[0.06] pt-3">
      <SectionLabel>{dict.flows.output.logoPosition}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <PositionPicker
          value={position}
          onChange={onPosition}
          disabled={disabled}
          disabledValues={reservedPositions}
          disabledTooltip={dict.flows.output.reservedForPersistent}
        />
        <div className="flex flex-col items-start gap-1.5">
          <Pill
            active={excludeCover}
            onClick={() => onExcludeCover(!excludeCover)}
            disabled={disabled}
          >
            {dict.flows.controls.excludeCover}
          </Pill>
          <Pill
            active={excludeClosing}
            onClick={() => onExcludeClosing(!excludeClosing)}
            disabled={disabled}
          >
            {dict.flows.controls.excludeLast}
          </Pill>
        </div>
      </div>
    </div>
  );
}
