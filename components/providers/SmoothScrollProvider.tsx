"use client";

import { ReactNode, useEffect } from "react";
import Lenis from "@studio-freight/lenis";

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis();

    // Scroll-gated RAF: drive Lenis ONLY while there's scroll motion, and stop
    // when it settles — no always-on idle loop. Any scroll input wakes it; the
    // loop self-stops once velocity returns to 0.
    let rafId = 0;
    let ticking = false;
    function loop(time: number) {
      lenis.raf(time);
      // `isScrolling` stays true through the whole eased animation (incl.
      // momentum); when it settles we stop and wait for the next scroll input.
      if (lenis.isScrolling) {
        rafId = requestAnimationFrame(loop);
      } else {
        ticking = false;
      }
    }
    function kick() {
      if (ticking) return;
      ticking = true;
      rafId = requestAnimationFrame(loop);
    }

    const kickEvents = [
      "wheel",
      "touchstart",
      "touchmove",
      "keydown",
      "scroll",
    ] as const;
    kickEvents.forEach((ev) =>
      window.addEventListener(ev, kick, { passive: true }),
    );

    // Handle anchor links for smooth scrolling with easing
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (href && href.startsWith("#")) {
        e.preventDefault();
        if (href === "#") {
          lenis.scrollTo(0, { duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
        } else {
          lenis.scrollTo(href, { duration: 1.2, offset: -80, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
        }
        kick(); // drive the scrollTo animation to completion
      }
    };

    document.documentElement.addEventListener("click", handleAnchorClick);

    return () => {
      document.documentElement.removeEventListener("click", handleAnchorClick);
      kickEvents.forEach((ev) => window.removeEventListener(ev, kick));
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
