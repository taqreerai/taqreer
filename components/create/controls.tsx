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
}: {
  value: CornerPosition;
  onChange: (next: CornerPosition) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {CORNER_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            title={option.label}
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
  return (
    <div className="flex items-center justify-between gap-3">
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
