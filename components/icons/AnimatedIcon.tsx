"use client";

// ─── AnimatedIcon resolver ────────────────────────────────────────
//
// Maps the Material-Symbol icon names the dashboard uses
// (`add_circle`, `auto_fix_high`, `home`, etc.) to the corresponding
// itshover animated SVG component. Each itshover icon is a
// `forwardRef<AnimatedIconHandle, AnimatedIconProps>` that exposes
// `startAnimation` / `stopAnimation` via `useImperativeHandle`. The
// upstream icons' own `onHoverStart` / `onHoverEnd` SVG handlers were
// stripped 2026-05-28 (user direction: "hover animation should start
// on button hover not icon hover") — animation is now driven by the
// parent card's mouseenter / mouseleave via a ref.
//
// `AnimatedIcon` itself is a forwardRef so callers can:
//
//   const iconRef = useRef<AnimatedIconHandle>(null);
//   <button
//     onMouseEnter={() => iconRef.current?.startAnimation()}
//     onMouseLeave={() => iconRef.current?.stopAnimation()}
//   >
//     <AnimatedIcon ref={iconRef} name="add_circle" size={34} />
//   </button>
//
// For icons NOT in the map we fall back to rendering a standard
// `<span class="material-symbols-outlined">` so callers that pass an
// unmapped name (e.g. the dropdown menu's edit/delete icons) keep
// working without a code change. The ref is silently dropped for the
// fallback path — `AnimatedIconHandle` doesn't make sense for a
// Material Symbol font glyph.

import { forwardRef } from "react";
import type { ComponentType } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";

import PenIcon from "./pen-icon";
import SparklesIcon from "./sparkles-icon";
import CopyIcon from "./copy-icon";
import ChartHistogramIcon from "./chart-histogram-icon";
import HomeIcon from "./home-icon";
import Stack3Icon from "./stack-3-icon";
import LibraryIcon from "./library-icon";
import PaintIcon from "./paint-icon";
import StarIcon from "./star-icon";
import GearIcon from "./gear-icon";
import CameraIcon from "./camera-icon";

// Material Symbol name → itshover animated component. Adding a new
// icon? Drop the new component into `components/icons/` and add the
// entry here.
const ICON_REGISTRY: Record<
  string,
  ComponentType<AnimatedIconProps & { ref?: React.Ref<AnimatedIconHandle> }>
> = {
  // QuickActions / sidebar action buttons
  add_circle: PenIcon, // إنشاء — pen writing a fresh document
  auto_fix_high: SparklesIcon, // تحسين — magic wand glyph
  content_copy: CopyIcon, // محاكاة — copy
  dataset: ChartHistogramIcon, // من بيانات — Excel/data → histogram with trend curve

  // Sidebar nav
  home: HomeIcon,
  folder_copy: Stack3Icon, // مشاريعي — stacked items
  grid_view: LibraryIcon, // القوالب — library
  photo_library: CameraIcon, // مكتبة الصور — camera (lens zoom on hover)
  id_card: PaintIcon, // هوية الشركة — paint roller for branding
  star: StarIcon,
  settings: GearIcon,
};

type AnimatedIconBridgeProps = {
  /** Material-Symbol-equivalent name. Falls back to a Material Symbol render if not registered. */
  name: string;
  /** Icon size in pixels. Default 24. */
  size?: number;
  /** Color — defaults to `currentColor` so the icon inherits CSS color. */
  color?: string;
  /** Stroke width (only used by SVG icons, ignored by Material fallback). Default 2. */
  strokeWidth?: number;
  /** Additional CSS classes applied to the outer SVG / span. */
  className?: string;
};

/**
 * AnimatedIcon — drop-in replacement for `<span class="material-symbols-
 * outlined">{name}</span>`. Renders the itshover animated SVG when
 * `name` matches a registered Material Symbol slug; otherwise falls
 * back to the Material Symbols font so unmapped icons keep working.
 *
 * Forwards refs through to the underlying animated icon so a parent
 * card can drive the start/stop animation via `iconRef.current?
 * .startAnimation()` from its own mouseenter / mouseleave handlers.
 */
export const AnimatedIcon = forwardRef<
  AnimatedIconHandle,
  AnimatedIconBridgeProps
>(function AnimatedIcon(
  { name, size = 24, color = "currentColor", strokeWidth = 2, className = "" },
  ref,
) {
  const Icon = ICON_REGISTRY[name];
  if (Icon) {
    return (
      <Icon
        ref={ref}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className}
      />
    );
  }
  // Fallback to Material Symbol so unmapped names (e.g. the menu
  // icons inside ProjectActionsMenu) still render. The forwarded ref
  // is silently dropped — there's nothing to animate on a font glyph.
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, color }}
    >
      {name}
    </span>
  );
});
