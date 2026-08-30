"use client";

// Unified pill-shaped button used across the entire create flow.
//
// Three variants:
//   • primary   — gradient brand CTA (Next / Generate / Save).
//                 Wraps `.btn-gradient` so colour comes from the
//                 brand-gradient token, not inline hex.
//   • secondary — outline-on-glass (Previous / Cancel).
//                 Wraps `.btn-pill` for shape, swaps the muted text
//                 colour for full white to read as a real button.
//   • ghost     — text-only (small Edit / Remove links).
//
// Two sizes:
//   • md (default) — 11 × N (h-11 ≈ 44 px) used for the row-level
//                    Next / Previous + footer CTAs.
//   • sm           — 8 × N (h-8 ≈ 32 px) used for inline actions
//                    like the summary card's Edit button.
//
// Icons supported via `icon` (material-symbols glyph name). Renders
// at 18 px on md, 16 px on sm so the icon never overpowers the text.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

type PillButtonProps = {
  variant?: Variant;
  size?: Size;
  // Material-symbols glyph name (e.g. "arrow_forward"). Rendered on
  // the start side of the label.
  icon?: string;
  loading?: boolean;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function PillButton({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  children,
  disabled,
  type = "button",
  style: styleProp,
  ...rest
}: PillButtonProps) {
  // Size classes — fixed height so neighbouring buttons line up,
  // padding scales with the size so the visual weight stays right.
  const sizeClasses =
    size === "sm"
      ? "h-8 px-4 text-xs gap-1.5"
      : "h-11 px-6 text-sm gap-2";

  // Variant chrome — primary wraps `.btn-gradient`; secondary +
  // ghost wrap `.btn-pill` for the glass surface. `.btn-gradient`
  // in globals.css ships with `border-radius: 10px`, so for the
  // pill shape we set it inline (style wins over both the class
  // rule and any Tailwind utility regardless of source-order).
  const variantClasses =
    variant === "primary"
      ? "btn-gradient text-white"
      : variant === "secondary"
        ? "btn-pill text-foreground"
        : "btn-pill text-foreground/60 border-transparent hover:border-foreground/15 hover:text-foreground";
  const variantStyle =
    variant === "primary" ? { borderRadius: 9999 } : undefined;

  const iconPx = size === "sm" ? 16 : 18;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      {...rest}
      // Caller style merges OVER the variant's (previously the variant
      // style silently clobbered a passed `style` - CR-adjacent fix
      // found wiring the /create wizard nav 2026-08-30).
      style={{ ...variantStyle, ...styleProp }}
      className={`relative inline-flex items-center justify-center font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses} ${variantClasses}`}
    >
      {loading ? (
        <span className="spinner h-4 w-4 rounded-full border-2 border-foreground/30 border-t-white" />
      ) : icon ? (
        <span
          className="material-symbols-outlined leading-none"
          style={{ fontSize: `${iconPx}px` }}
        >
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
