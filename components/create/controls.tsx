"use client";

// Small UI primitives used across the create flow: a Pill toggle
// (gradient-fill when active), a Toggle switch, and a PositionPicker
// (6-button corner grid). All three originally lived inline in
// `app/create/brand/page.tsx`; promoted to a shared module so the
// new `/create/output` route can render the same controls without
// duplicating ~80 lines. Every visual reads from globals.css tokens
// (`.btn-gradient`, `.tq-switch-on`) so the user's glass-preset
// continues to drive the surface chrome.

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
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`backdrop-blur-glass rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
// `.tq-switch-on` class for the active background gradient.
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
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
      <button
        type="button"
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${
          value ? "tq-switch-on" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            value ? "right-[22px]" : "right-0.5"
          }`}
        />
      </button>
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
