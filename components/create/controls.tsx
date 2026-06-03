"use client";

// Small UI primitives used across the create flow: a Pill toggle
// (gradient-fill when active), a Toggle switch, and a PositionPicker
// (6-button corner grid). All three originally lived inline in
// `app/create/brand/page.tsx`; promoted to a shared module so the
// new `/create/output` route can render the same controls without
// duplicating ~80 lines. Every visual reads from globals.css tokens
// (`.btn-gradient`, `.tq-switch-on`) so the user's glass-preset
// continues to drive the surface chrome.

import { useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";

export type CornerPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

const CORNER_OPTIONS: { value: CornerPosition; icon: string; label: string }[] = [
  { value: "top-left", icon: "north_west", label: "أعلى يسار" },
  { value: "top-center", icon: "north", label: "أعلى الوسط" },
  { value: "top-right", icon: "north_east", label: "أعلى يمين" },
  { value: "bottom-left", icon: "south_west", label: "أسفل يسار" },
  { value: "bottom-center", icon: "south", label: "أسفل الوسط" },
  { value: "bottom-right", icon: "south_east", label: "أسفل يمين" },
];

// Canonical corner ordering used by callers that need to walk the
// 6-corner space programmatically (e.g. picking a fallback corner
// when the user's preferred one is reserved by other chrome).
// Re-exported so consumers don't have to redeclare the literal.
export const CORNER_POSITIONS: ReadonlyArray<CornerPosition> = CORNER_OPTIONS.map(
  (c) => c.value,
);

// CardHeader — title row used at the top of every card across the
// create/enhance/mimic flows. Icon + h3 title + bottom hairline.
// Promoted from /create's local definition 2026-05-26 so /enhance
// and /mimic carry the same chrome — no fork, byte-identical rendering.
export function CardHeader({ icon, title }: { icon: string; title: string }) {
  return (
    // pb-4 matches the card's p-4 TOP padding, so the title ends up the same
    // distance from the card's top edge as it is from the separator — i.e.
    // visually centred in the header region. (This balance holds regardless of
    // the row height, since the top padding above and pb-4 below are equal.)
    <header className="flex items-center gap-2 border-b border-white/[0.08] pb-4">
      <span
        className="material-symbols-outlined text-white"
        style={{ fontSize: 18 }}
      >
        {icon}
      </span>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
    </header>
  );
}

// SegmentedToggle — two-option pill switch in a single rounded
// container (active = white bg + black text, idle = white/60 text
// on glass background). Replaces the "two separate Pill buttons"
// pattern wherever a binary choice would read more clearly as one
// segmented control:
//   • /mimic font-slot mode (ملف / Google)
//   • /mimic + /create slide count (تلقائي / مخصص)
//   • /create font-slot mode (ملف / Google) [Phase 17.D]
//
// Generic over the option type so callers can use string literal
// unions ("upload" | "google", "auto" | "custom", ...) without
// extra casts. `text-[10px]` matches the previous inline ModeToggle
// dimensions exactly so adopters get byte-identical visuals.
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "default",
  size = "default",
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  // Names the control as a whole for screen readers (e.g.
  // "Font source", "Slide count mode"). Each segment's text label
  // serves as the option name.
  ariaLabel?: string;
  // Active-state colour:
  //   • "default" — white pill on glass, black text (font/slide modes)
  //   • "primary" — brand-blue pill, white text (language picker on
  //     /create where the binary AR/EN choice deserves a louder
  //     accent matching the rest of the page's --tq-blue surfaces).
  variant?: "default" | "primary";
  // Visual size variant — "default" matches the inline font-mode
  // toggle (text-[10px]); "comfortable" bumps up to text-xs + py-1.5
  // for higher-stakes choices like language where the pill needs
  // to read clearly at a glance.
  size?: "default" | "comfortable";
}) {
  const segCls =
    size === "comfortable"
      ? "px-3 py-1 text-xs font-semibold"
      : "px-2.5 py-1 text-[10px] font-semibold";
  const activeBgCls =
    variant === "primary" ? "bg-[var(--tq-blue)]" : "bg-white";
  const activeTextCls = variant === "primary" ? "text-white" : "text-black";
  // Stable layoutId so the sliding background pill is unique to THIS
  // toggle instance — without it, two SegmentedToggles on the same
  // page would share the indicator and animate from one to the other
  // when the user clicked into the second one.
  const indicatorId = useId();
  return (
    <div
      className="relative flex items-center gap-0.5 rounded-full p-0.5 bg-[var(--tq-bg-glass)]"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            // `relative` + child indicator are stacked z-wise: the
            // motion.span sits inside the active button, so framer
            // layout animates its position when the active option
            // changes (the indicator unmounts on the old button and
            // re-mounts on the new one with `layoutId` matching,
            // triggering a smooth slide).
            className={`relative rounded-full transition-colors ${segCls} ${
              active ? activeTextCls : "text-white/60 hover:text-white"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={indicatorId}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className={`absolute inset-0 rounded-full ${activeBgCls}`}
                aria-hidden
              />
            ) : null}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Pill — shared chooser primitive. Two states:
//   • idle   — matches the dashboard bell button: glass surface,
//              border-white/15, text-white/60 → border-white/40 +
//              text-white on hover.
//   • active — same glass surface (no purple gradient), but the
//              stroke turns full white and the text turns full white.
//              Reads as "selected" without competing with the brand
//              CTA gradient elsewhere on the page.
export function Pill({
  active,
  onClick,
  disabled,
  children,
  // Visual size variant.
  //   • "default" (existing): px-3 py-1.5 text-sm — used everywhere
  //     on /create + /enhance + the templates flows. Byte-identical
  //     to the original Pill behaviour.
  //   • "compact": px-2 py-0.5 text-xs — used by /mimic where the
  //     pills sit inline next to a text-xs section label, so the
  //     pill text size needs to match the label for the row to
  //     read as a single visual band.
  size = "default",
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  size?: "default" | "compact";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`backdrop-blur-glass whitespace-nowrap rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "compact" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-sm"
      } ${
        active
          ? "text-white"
          : "text-white/60 hover:text-white"
      }`}
      style={{
        background: "rgba(255, 255, 255, var(--glass-opacity))",
        borderColor: active
          ? "rgba(255, 255, 255, 1)"
          : "rgba(255, 255, 255, var(--glass-border-opacity))",
      }}
    >
      {children}
    </button>
  );
}

// PositionDropdown — same 6-corner choice as PositionPicker but
// collapsed into a single pill that opens a popover. Used by /create
// where the row needs to fit a position picker + two exclude pills
// in one line; the full 3×2 grid version was too wide. Same value /
// onChange contract as PositionPicker so it's a drop-in replacement
// at any call site where the grid is overkill.
//
// Closed state: glass pill showing the current position's Arabic
// label + a chevron icon. Open state: popover below the button with
// the 3×2 grid (PositionPicker's exact markup, no fork).
export function PositionDropdown({
  value,
  onChange,
  disabled,
  disabledValues,
  disabledTooltip,
  // Stretch the trigger to the full width of its container (label on the
  // reading edge, chevron on the far edge). Used by the stacked LogoRow
  // where the position pill sits full-width UNDER the logo dropzone.
  fullWidth = false,
}: {
  value: CornerPosition;
  onChange: (next: CornerPosition) => void;
  disabled?: boolean;
  disabledValues?: CornerPosition[];
  disabledTooltip?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentLabel =
    CORNER_OPTIONS.find((c) => c.value === value)?.label ?? "الموضع";

  // Outside-click + ESC close. Same shape as the rest of the
  // popover-style controls in this file (ColorPickerPopover, etc).
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        // `whitespace-nowrap` prevents the chevron and label from
        // wrapping to a second line when the parent row is tight
        // (the row has flex-wrap which would otherwise break the
        // button itself across rows).
        className={`backdrop-blur-glass flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          fullWidth ? "w-full justify-between" : "shrink-0"
        } ${
          open ? "border-white/40" : "border-white/15 hover:border-white/30"
        }`}
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
        }}
      >
        <span
          className={`material-symbols-outlined transition-transform ${
            open ? "rotate-180" : ""
          }`}
          style={{ fontSize: 14 }}
        >
          expand_more
        </span>
        <span>{currentLabel}</span>
      </button>
      {open ? (
        <div
          // Exact same surface recipe as GoogleFontSlot's dropdown
          // popover (see components/brand/GoogleFontSlot.tsx) so the
          // two read as the same chrome family: backdrop-blur-glass
          // for the frosted-blur, bg-[var(--tq-bg-glass)] for the
          // translucent fill, border-[var(--tq-border-glass)] for
          // the hairline, shadow-2xl for the lift off the page.
          className="absolute top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-xl border p-2 shadow-2xl backdrop-blur-glass bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
          role="listbox"
          aria-label="موضع"
        >
          <div className="grid grid-cols-3 gap-1.5" dir="ltr">
            {CORNER_OPTIONS.map((option) => {
              const active = value === option.value;
              const lockedByValue =
                disabledValues?.includes(option.value) ?? false;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={lockedByValue}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  title={
                    lockedByValue && disabledTooltip
                      ? disabledTooltip
                      : option.label
                  }
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "border-white text-white"
                      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                  style={{
                    background: "rgba(255, 255, 255, var(--glass-opacity))",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {option.icon}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 6-button corner picker. `dir="ltr"` is INTENTIONAL: it locks the
// grid so the visually-rightmost button always maps to the canvas's
// right side, regardless of the surrounding RTL page. Without this
// the array's first entry (top-left) ends up on the visual right in
// RTL, silently flipping the mapping.
export function PositionPicker({
  value,
  onChange,
  disabled,
  disabledValues,
  disabledTooltip,
}: {
  value: CornerPosition;
  onChange: (next: CornerPosition) => void;
  disabled?: boolean;
  // Per-button exclusions. Used when a picker shares the 6-corner
  // space with another chrome element — e.g. on /create/brand the
  // logo position picker disables whatever corner the persistent
  // overlay text already claimed on /create/content, so the two
  // never overlap visually. Each entry renders that specific
  // button in the disabled visual treatment, independent of the
  // whole-picker `disabled` flag.
  disabledValues?: CornerPosition[];
  // Optional tooltip text shown when hovering a button disabled by
  // `disabledValues` (NOT the whole-picker `disabled` case — that
  // already keeps the button's default option label as the title).
  // Lets the caller say WHY the corner is reserved.
  disabledTooltip?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {CORNER_OPTIONS.map((option) => {
        const active = value === option.value;
        const lockedByValue = disabledValues?.includes(option.value) ?? false;
        const isDisabled = disabled || lockedByValue;
        return (
          <button
            key={option.value}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            // Per-button title: when value-locked + the caller passed
            // a tooltip, use it. Otherwise fall back to the corner's
            // own label (default behavior for all other states).
            title={
              lockedByValue && disabledTooltip ? disabledTooltip : option.label
            }
            // Same idle/active vocabulary as `Pill`: glass surface
            // always, stroke + text bump to full-white when active
            // (no purple gradient).
            className={`backdrop-blur-glass flex h-11 items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? "text-white" : "text-white/60 hover:text-white"
            }`}
            style={{
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              borderColor: active
                ? "rgba(255, 255, 255, 1)"
                : "rgba(255, 255, 255, var(--glass-border-opacity))",
            }}
          >
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: "18px" }}
            >
              {option.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// RTL-aware switch — knob anchored to the right edge in the OFF
// state, slides to the left edge when ON. Wraps the global
// Canonical switch style (revised 2026-05-26 per user direction):
// solid white track when on, glass (white/10) when off. The knob
// inverts so it picks up the OTHER side's surface color:
//   • OFF — track white/10, knob white       (visible on dark glass)
//   • ON  — track white,    knob white/10    (visible on white track)
// Net effect: the knob always "trades" its colour with the track on
// toggle. Pure-white active retired the brand-blue active state
// because the latter competed visually with the brand-blue CTAs
// across the page.
//
// New consumers: use this component when you have a label inline;
// for layouts where the label needs more freedom (label + description
// block stacked vertically) the markup is small enough to inline —
// keep the className strings IDENTICAL to the markup below so visual
// consistency stays automatic.
//
// Discriminated union — EITHER `label` is provided (renders inline
// text next to the switch + uses it as the aria-label) OR `ariaLabel`
// is required (parent renders the visible label externally). The
// type system makes an unlabeled switch impossible (a11y requirement:
// every role="switch" needs a non-empty accessible name).
type ToggleSharedProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};
type ToggleProps =
  | (ToggleSharedProps & { label: string; ariaLabel?: string })
  | (ToggleSharedProps & { label?: undefined; ariaLabel: string });

export function Toggle({
  label,
  ariaLabel,
  value,
  onChange,
  disabled,
}: ToggleProps) {
  // After the discriminated union both branches guarantee a non-empty
  // accessible name — ariaLabel when no label, label otherwise.
  const accessibleLabel = ariaLabel ?? label ?? "";
  const switchEl = (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      role="switch"
      aria-checked={value}
      aria-label={accessibleLabel}
      className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-50 ${
        value ? "bg-[var(--tq-violet)]" : "bg-white/10"
      }`}
    >
      {/* Knob — framer-motion spring matches the SegmentedToggle's
          sliding indicator (stiffness 500, damping 35). `right` is
          animated rather than `transform: translateX` because the
          knob is positioned via the `right` CSS property in both
          states (the track is LTR-positioned even inside an RTL
          page so the visual travel is identical regardless of dir).
          `initial={false}` skips the first-paint slide. */}
      <motion.span
        initial={false}
        animate={{ right: value ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white"
      />
    </button>
  );
  if (!label) return switchEl;
  // `inline-flex` (not `flex`) so the Toggle takes natural width when
  // placed in a parent that uses `justify-between` (e.g. the
  // pagination ↔ language-pills row on /create/content). With
  // plain `flex`, justify-between inside this component spread the
  // label and switch to opposite ends of whatever space the parent
  // gave it — leaving a large empty gap when the parent was wider
  // than the toggle's natural content.
  return (
    <div className="inline-flex items-center justify-between gap-3">
      <span className="text-sm text-white">{label}</span>
      {switchEl}
    </div>
  );
}

// Two-pill segmented control for content language. The Middle East
// audience consumes mixed Arabic + English content naturally, so a
// dedicated "bilingual" bucket added complexity without a meaningful
// user-facing difference — the existing prompt already handles
// inline mixed-script runs under either RTL or LTR root. Scope locked
// to two options 2026-05-20.
//
// Active pill = brighter border + white text (matches `.btn-pill:hover`).
// Idle pill = `.btn-pill` resting state.
//
// Why we INLINE the pill styles instead of using `.btn-pill`:
// `.btn-pill` lives OUTSIDE `@layer utilities` in globals.css and
// beats any Tailwind `text-white`/`border-white/40` utility we'd add
// to flip the active state. Already burned by this with `.text-muted`
// — sidestepping the layer-cascade fight is cheaper than re-shuffling
// globals.css for a 2-button control.
export type LanguageCode = "ar" | "en";

const LANGUAGE_OPTIONS: ReadonlyArray<{ code: LanguageCode; label: string }> = [
  { code: "ar", label: "العربية" },
  { code: "en", label: "الإنجليزية" },
];

export function LanguagePills({
  value,
  onChange,
}: {
  value: LanguageCode;
  onChange: (next: LanguageCode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="لغة المحتوى"
      className="inline-flex items-center gap-1"
    >
      {LANGUAGE_OPTIONS.map((opt) => {
        const isActive = value === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.code)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "border-white/40 text-white"
                : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// ExclusionDropdown — pill button that opens a popover with two
// checkbox-style toggles (exclude cover, exclude closing). Same
// chrome as PositionDropdown so the two read as a pair: identical
// h-8 trigger, identical glass popover. Single-pill replacement for
// the legacy two-pill "استثناء الغلاف / استثناء الشريحة الأخيرة" layout.
//
// Promoted from /create/page.tsx (2026-05-27) so /brand-kits/new
// and any future brand-config page can reuse the same primitive
// rather than fork. Visual recipe byte-identical to the original.
// ───────────────────────────────────────────────────────────────────
export function ExclusionDropdown({
  excludeCover,
  excludeClosing,
  onCoverChange,
  onClosingChange,
  disabled,
}: {
  excludeCover: boolean;
  excludeClosing: boolean;
  onCoverChange: (next: boolean) => void;
  onClosingChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const count = (excludeCover ? 1 : 0) + (excludeClosing ? 1 : 0);
  const label = count > 0 ? `استثناء (${count})` : "استثناء";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`backdrop-blur-glass flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-white/40" : "border-white/15 hover:border-white/30"
        }`}
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
        }}
      >
        <span
          className={`material-symbols-outlined transition-transform ${
            open ? "rotate-180" : ""
          }`}
          style={{ fontSize: 14 }}
        >
          expand_more
        </span>
        <span className="whitespace-nowrap">{label}</span>
      </button>
      {open ? (
        <div
          // Same glass-popover recipe as PositionDropdown +
          // GoogleFontSlot — backdrop-blur-glass + bg-glass + glass
          // border + shadow-2xl. Keeps the dropdown family visually
          // consistent across /create.
          // ARIA: this is a group of independent checkbox toggles
          // (cover + closing), not a single-select listbox — `listbox`
          // / `option` / `aria-selected` would mislead screen readers
          // into announcing one-of-many semantics. Switched to
          // `group` so the inner `checkbox`-role buttons read as
          // independent toggles (CR #41 finding, 2026-05-28).
          className="absolute top-full z-30 mt-1 min-w-[200px] overflow-hidden rounded-xl border p-1 shadow-2xl backdrop-blur-glass bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
          role="group"
          aria-label="استثناء"
        >
          <ExclusionItem
            label="استثناء الغلاف"
            checked={excludeCover}
            onChange={onCoverChange}
          />
          <ExclusionItem
            label="استثناء الشريحة الأخيرة"
            checked={excludeClosing}
            onChange={onClosingChange}
          />
        </div>
      ) : null}
    </div>
  );
}

// Internal row item for ExclusionDropdown. Not exported — callers
// use ExclusionDropdown directly. Kept as a separate function (not
// inlined) so the checkbox row stays a single, named primitive in
// the file.
function ExclusionItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/5"
    >
      <span className="whitespace-nowrap">{label}</span>
      <span
        className={`material-symbols-outlined transition-opacity ${
          checked ? "opacity-100 text-white" : "opacity-0"
        }`}
        style={{ fontSize: 16 }}
      >
        check
      </span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// InlinePaletteSwatch — small fixed-size swatch (h-7 w-7) used in
// the palette row where swatches sit inline next to the "الألوان"
// label. Each swatch is square; the row sizes naturally so adding
// colours grows the row's width without ever wrapping to a second
// line.
//
// Promoted from /create/page.tsx (2026-05-27) for shared use across
// /brand-kits/new. Visual recipe byte-identical to the original.
// Depends on ColorPickerPopover for the inline picker.
// ───────────────────────────────────────────────────────────────────
export function InlinePaletteSwatch({
  value,
  index,
  removable,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  removable: boolean;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-7 w-7 shrink-0 rounded-md border border-white/15 transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        aria-label={`اللون ${index + 1}`}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label="إزالة اللون"
        className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-0"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 8 }}>
          close
        </span>
      </button>
      <ColorPickerPopover
        open={pickerOpen}
        value={value}
        onChange={onChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
