"use client";

// Vendored from the itshover registry
// (https://itshover.com/r/rosette-discount-check-icon.json).
// Adapted to import from `framer-motion` (the package this project
// already ships) rather than `motion/react` (same library, newer
// umbrella name) so we don't need a second copy of the runtime.
// Added `playOnMount` so state-driven moments — e.g. "text extracted
// successfully" — can fire the in-animation once on render without a
// hover gesture; the upstream hover-only behaviour is preserved when
// the prop is left off.

import { forwardRef, useEffect, useImperativeHandle, useCallback } from "react";
import { motion, useAnimate } from "framer-motion";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";

const RosetteDiscountCheckIcon = forwardRef<
  AnimatedIconHandle,
  AnimatedIconProps
>(
  (
    {
      size = 24,
      color = "currentColor",
      strokeWidth = 2,
      className = "",
      playOnMount = false,
    },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".rosette-badge",
        { rotate: [0, -5, 5, 0], scale: [1, 1.05, 1] },
        { duration: 0.5, ease: "easeInOut" },
      );
      await animate(
        ".discount-check",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.4, ease: "easeOut" },
      );
      animate(
        ".rosette-badge",
        { scale: [1.05, 0.98, 1] },
        { duration: 0.3, ease: "easeOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(".rosette-badge", { rotate: 0, scale: 1 }, { duration: 0.2 });
      animate(
        ".discount-check",
        { pathLength: 1, opacity: 1 },
        { duration: 0.2 },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    // One-shot trigger on mount. Pinned to `playOnMount` so re-mounts
    // (e.g. user retries extraction) replay the in-animation. We don't
    // depend on `start` directly — useAnimate's animate fn is stable
    // for the lifetime of the scope, and ref-tying it would cause an
    // immediate replay loop in StrictMode.
    useEffect(() => {
      if (playOnMount) void start();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playOnMount]);

    return (
      <motion.div
        ref={scope}
        className={`inline-flex items-center justify-center ${className}`}
        onHoverStart={playOnMount ? undefined : start}
        onHoverEnd={playOnMount ? undefined : stop}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ overflow: "visible" }}
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <motion.path
            className="rosette-badge"
            style={{ transformOrigin: "center" }}
            d="M5 7.2a2.2 2.2 0 0 1 2.2 -2.2h1a2.2 2.2 0 0 0 1.55 -.64l.7 -.7a2.2 2.2 0 0 1 3.12 0l.7 .7c.412 .41 .97 .64 1.55 .64h1a2.2 2.2 0 0 1 2.2 2.2v1c0 .58 .23 1.138 .64 1.55l.7 .7a2.2 2.2 0 0 1 0 3.12l-.7 .7a2.2 2.2 0 0 0 -.64 1.55v1a2.2 2.2 0 0 1 -2.2 2.2h-1a2.2 2.2 0 0 0 -1.55 .64l-.7 .7a2.2 2.2 0 0 1 -3.12 0l-.7 -.7a2.2 2.2 0 0 0 -1.55 -.64h-1a2.2 2.2 0 0 1 -2.2 -2.2v-1a2.2 2.2 0 0 0 -.64 -1.55l-.7 -.7a2.2 2.2 0 0 1 0 -3.12l.7 -.7a2.2 2.2 0 0 0 .64 -1.55v-1z"
          />
          <motion.path
            className="discount-check"
            d="M9 12l2 2l4 -4"
            pathLength={1}
          />
        </svg>
      </motion.div>
    );
  },
);

RosetteDiscountCheckIcon.displayName = "RosetteDiscountCheckIcon";
export default RosetteDiscountCheckIcon;
