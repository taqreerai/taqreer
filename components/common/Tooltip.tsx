"use client";

// Shared animated tooltip — the sidebar's tooltip behaviour (portalled to <body>,
// `.sidebar-tooltip` dark pill, framer-motion slide-in) generalised to any
// placement. The pill slides in FROM the side it sits on, matched to placement:
//   • bottom → slides down,  top → slides up
//   • right  → slides right, left → slides left
// so the motion always reads as "emerging from the trigger" wherever it appears.
//
// Wrap a trigger: <Tooltip label="Search" placement="bottom"><button/></Tooltip>.
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

type Placement = "top" | "bottom" | "left" | "right";

const GAP = 10;

export function Tooltip({
  label,
  placement = "bottom",
  className = "inline-flex",
  disabled = false,
  multiline = false,
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
  // default). Sets a max width + normal wrapping so a sentence-length
  // label reads as a small paragraph instead of one huge line.
  multiline?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Fixed-position anchor for the portalled pill; null when hidden. We anchor by
  // the EDGE the pill grows from (right/bottom for left/top placement) so we
  // never need to know the pill's own size to centre it.
  const [pos, setPos] = useState<React.CSSProperties | null>(null);

  const show = () => {
    if (disabled) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const s: React.CSSProperties = {};
    if (placement === "left") {
      s.right = window.innerWidth - r.left + GAP;
      s.top = r.top + r.height / 2;
    } else if (placement === "right") {
      s.left = r.right + GAP;
      s.top = r.top + r.height / 2;
    } else if (placement === "top") {
      s.bottom = window.innerHeight - r.top + GAP;
      s.left = r.left + r.width / 2;
    } else {
      s.top = r.bottom + GAP;
      s.left = r.left + r.width / 2;
    }
    setPos(s);
  };
  const hide = () => setPos(null);

  // Horizontal placements centre vertically (constant y:-50%) and slide on x;
  // vertical placements centre horizontally (constant x:-50%) and slide on y.
  const horizontal = placement === "left" || placement === "right";
  const slide = horizontal
    ? { x: placement === "left" ? 10 : -10 }
    : { y: placement === "top" ? 6 : -6 };
  const center = horizontal ? { y: "-50%" } : { x: "-50%" };
  const settled = horizontal ? { x: 0 } : { y: 0 };

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {pos && !disabled ? (
                <motion.div
                  className="sidebar-tooltip pointer-events-none fixed z-[9999]"
                  style={
                    multiline
                      ? {
                          ...pos,
                          whiteSpace: "normal",
                          maxWidth: 280,
                          textAlign: "start",
                          lineHeight: 1.5,
                        }
                      : pos
                  }
                  initial={{ opacity: 0, ...center, ...slide }}
                  animate={{ opacity: 1, ...center, ...settled }}
                  exit={{ opacity: 0, ...center, ...slide }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {label}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </span>
  );
}
