"use client";

import { motion } from "framer-motion";
import { ReactNode, useSyncExternalStore } from "react";

type RevealDirection = "up" | "down" | "left" | "right" | "none";

// Below this width the viewport is treated as a phone: EVERY directional reveal
// collapses to a bottom->up slide. Horizontal slides (left/right) fight the
// narrow single column on a phone and read wrong, so on mobile they all come up
// from the bottom. Matches Tailwind's `md` breakpoint (768px).
const MOBILE_QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

// Lint-safe viewport read (no setState-in-effect): SSR/hydration assume desktop,
// the client corrects on commit. The reveal element is opacity:0 below the fold
// at that point, so the correction is invisible.
function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

interface ScrollRevealProps {
  children: ReactNode;
  direction?: RevealDirection;
  delay?: number;
  className?: string;
  duration?: number;
}

export function ScrollReveal({
  children,
  direction = "up",
  delay = 0,
  className = "",
  duration = 0.7,
}: ScrollRevealProps) {
  const isMobile = useIsMobile();

  const getInitial = () => {
    // Phones: all slides come up from the bottom (fade-only stays fade-only).
    if (isMobile) {
      return direction === "none" ? { opacity: 0 } : { opacity: 0, y: 40 };
    }
    switch (direction) {
      case "up": return { opacity: 0, y: 40 };
      case "down": return { opacity: 0, y: -40 };
      case "left": return { opacity: 0, x: -40 };
      case "right": return { opacity: 0, x: 40 };
      case "none": return { opacity: 0 };
    }
  };

  return (
    <motion.div
      // Key by viewport class so the post-hydration mobile/desktop correction
      // remounts with the right `initial` BEFORE the element scrolls into view.
      key={isMobile ? "m" : "d"}
      initial={getInitial()}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
