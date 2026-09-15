"use client";

// Shared animated tooltip — the sidebar's tooltip behaviour (portalled to <body>,
// `.sidebar-tooltip` dark pill, framer-motion slide-in) generalised to any
// placement. The pill slides in FROM the side it sits on, matched to placement:
//   • bottom → slides down,  top → slides up
//   • right  → slides right, left → slides left
// so the motion always reads as "emerging from the trigger" wherever it appears.
//
// Wrap a trigger: <Tooltip label="Search" placement="bottom"><button/></Tooltip>.
//
// Positioning: a PLAIN wrapper div is placed via a ref callback (commit-phase
// DOM work — not an effect, not a render-time ref read, so it satisfies
// react-hooks/set-state-in-effect + react-hooks/refs). framer animates only the
// inner pill (opacity + slide), so it never fights the wrapper's fixed offsets.
// This drives both hover and the controlled `open` prop with no position state.
//
// The portal is mounted only while visible — so SSR and the first client
// render both produce nothing (no hydration mismatch), matching the original
// hidden-state DOM. Entrance is animated; hide just unmounts.
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

type Placement = "top" | "bottom" | "left" | "right";

const GAP = 10;

export function Tooltip({
  label,
  placement = "bottom",
  className = "inline-flex",
  disabled = false,
  multiline = false,
  open = false,
  id,
  role,
  children,
}: {
  label: string;
  placement?: Placement;
  // Display mode of the hover wrapper — `inline-flex` for icons, `block w-full`
  // for full-width rows (e.g. sidebar links).
  className?: string;
  // Suppress the tooltip (e.g. while the trigger's own menu/popover is open).
  disabled?: boolean;
  // Let a longer message wrap to multiple lines (the pill is nowrap by
  // default). Adds `.is-multiline` (max width + normal wrapping) so a
  // sentence-length label reads as a small paragraph, not one huge line.
  multiline?: boolean;
  // Force the pill visible regardless of hover — for a persistent message
  // (e.g. a rejection reason) that must not be hover-only. Hover/focus still
  // show it too.
  open?: boolean;
  // id on the pill so a trigger can associate it via aria-describedby.
  id?: string;
  // ARIA role on the pill (e.g. "status") so assistive tech announces a
  // persistent message the moment it appears.
  role?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [hovering, setHovering] = useState(false);
  const visible = !disabled && (hovering || open);

  // Horizontal placements centre vertically (constant y:-50%) and slide on x;
  // vertical placements centre horizontally (constant x:-50%) and slide on y.
  const horizontal = placement === "left" || placement === "right";
  const slide = horizontal
    ? { x: placement === "left" ? 10 : -10 }
    : { y: placement === "top" ? 6 : -6 };
  const center = horizontal ? { y: "-50%" } : { x: "-50%" };
  const settled = horizontal ? { x: 0 } : { y: 0 };

  // Anchor the wrapper by the EDGE the pill grows from (right/bottom for
  // left/top placement) so we never need the pill's own size to centre it.
  // Runs whenever the wrapper commits (inline identity re-runs it each render),
  // keeping the position fresh without effects or render-time ref reads.
  const positionWrapper = (el: HTMLDivElement | null) => {
    if (!el) return;
    const place = () => {
      if (!el.isConnected) return;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      el.style.top = el.style.bottom = el.style.left = el.style.right = "";
      if (placement === "left") {
        el.style.right = `${window.innerWidth - r.left + GAP}px`;
        el.style.top = `${r.top + r.height / 2}px`;
      } else if (placement === "right") {
        el.style.left = `${r.right + GAP}px`;
        el.style.top = `${r.top + r.height / 2}px`;
      } else if (placement === "top") {
        el.style.bottom = `${window.innerHeight - r.top + GAP}px`;
        el.style.left = `${r.left + r.width / 2}px`;
      } else {
        el.style.top = `${r.bottom + GAP}px`;
        el.style.left = `${r.left + r.width / 2}px`;
      }
    };
    // Immediate attempt covers the common case; the rAF re-run covers the
    // commit where the portal wrapper's ref fires before the trigger ref is
    // attached (bottom-up ref order), so the trigger rect is available.
    place();
    requestAnimationFrame(place);
  };

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      {children}
      {typeof document !== "undefined" && visible
        ? createPortal(
            <div
              ref={positionWrapper}
              className="pointer-events-none fixed z-[9999]"
            >
              <motion.div
                id={id}
                role={role}
                className={`sidebar-tooltip${multiline ? " is-multiline" : ""}`}
                initial={{ opacity: 0, ...center, ...slide }}
                animate={{ opacity: 1, ...center, ...settled }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {label}
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
