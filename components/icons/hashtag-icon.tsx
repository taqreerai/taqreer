"use client";

// Vendored from the itshover registry (https://itshover.com/r/hashtag-icon.json).
// Adapted to the repo convention (see camera-icon.tsx + the AnimatedIcon
// header): import from `framer-motion` (not `motion/react`), use `useCallback`
// for start/stop, and DROP the upstream onHoverStart/onHoverEnd SVG handlers.
// The animation is driven by the parent nav pill via the ref, not icon hover.
// `transform-box: fill-box` so each line scales around its own centre in place.

import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "framer-motion";

const HashtagIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(() => {
      animate(
        ".line-horizontal",
        { scaleX: 1.1, opacity: 0.7 },
        { duration: 0.3, ease: "easeOut" },
      );
      animate(
        ".line-vertical",
        { scaleY: 1.1, opacity: 0.7 },
        { duration: 0.3, delay: 0.1, ease: "easeOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".line-horizontal, .line-vertical",
        { scaleX: 1, scaleY: 1, opacity: 1 },
        { duration: 0.25, ease: "easeInOut" },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    const lineStyle = { transformBox: "fill-box", transformOrigin: "center" } as const;

    return (
      <motion.svg
        ref={scope}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`cursor-pointer ${className}`}
        style={{ overflow: "visible" }}
      >
        {/* Horizontal lines */}
        <motion.path className="line-horizontal" style={lineStyle} d="M5 9l14 0" />
        <motion.path className="line-horizontal" style={lineStyle} d="M5 15l14 0" />
        {/* Vertical lines */}
        <motion.path className="line-vertical" style={lineStyle} d="M11 4l-4 16" />
        <motion.path className="line-vertical" style={lineStyle} d="M17 4l-4 16" />
      </motion.svg>
    );
  },
);

HashtagIcon.displayName = "HashtagIcon";
export default HashtagIcon;
