"use client";

// ─── Feature-showcase primitives ─────────────────────────────────────
// Building blocks for the landing hero's CreateScene mini-tutorial.
// Everything derives from ONE looping clock (a framer-motion `useTime`
// -> normalised `loop` motion value in 0..1) so beats stay in sync and
// nothing owns a wall-clock timer. Motion values feed transforms and
// opacities directly, so the animation runs OFF the React render (no
// per-frame re-render storms).
//
// Tokens only (--tq-brand-*, --tq-purple, ...). Latin numerals, no
// dashes. Reduced-motion is handled by the scene (it renders its
// settled final frame; the CSS keyframes below also gate themselves).

import { useEffect, useRef } from "react";
import {
  useTime,
  useTransform,
  useMotionValueEvent,
  type MotionValue,
} from "framer-motion";

// ─── Brand cursor ────────────────────────────────────────────────────
// Redrawn from the user's reference (an upward rounded arrowhead with a
// notched base) using the brand blue gradient (--tq-brand-blue ->
// --tq-brand-purple == --tq-gradient-brand). No outline; a soft shadow
// keeps it legible over both themes. The tip points UP at rotation 0.
export function Cursor({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={(size * 52) / 48}
      viewBox="0 0 48 52"
      fill="none"
      aria-hidden
      className={className}
      style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.3))" }}
    >
      <defs>
        <linearGradient
          id="tq-cursor-grad"
          x1="24"
          y1="4"
          x2="24"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--tq-brand-blue)" />
          <stop offset="1" stopColor="var(--tq-brand-purple)" />
        </linearGradient>
      </defs>
      <path
        d="M24 4 C25.6 4 27 4.9 27.8 6.4 L41 43.6 C42.1 46.7 40.4 49 37.3 47.9 L26.4 44.1 C24.8 43.5 23.2 43.5 21.6 44.1 L10.7 47.9 C7.6 49 5.9 46.7 7 43.6 L20.2 6.4 C21 4.9 22.4 4 24 4 Z"
        fill="url(#tq-cursor-grad)"
      />
    </svg>
  );
}

// ─── The scene clock ─────────────────────────────────────────────────
// One monotonic loop in 0..1 over `durationMs`. Every element derives
// its state from this single value. `useTime` runs off-render and stops
// when the scene unmounts, so there is nothing to clean up.
export function useLoop(durationMs: number): MotionValue<number> {
  const time = useTime();
  return useTransform(time, (t) => (t % durationMs) / durationMs);
}

// ─── Typing ──────────────────────────────────────────────────────────
// Reveals `text` character by character between loop fractions
// [start, end], then holds full until the loop resets. Written to the
// DOM imperatively from a motion value (no re-render per character). A
// caret blinks via CSS. `reduced` renders the full text immediately.
export function Typing({
  text,
  loop,
  start,
  end,
  reduced = false,
  className = "",
  caret = true,
}: {
  text: string;
  loop: MotionValue<number>;
  start: number;
  end: number;
  reduced?: boolean;
  className?: string;
  caret?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Mirror `reduced` into a ref: useMotionValueEvent subscribes the
  // FIRST render's callback and never re-subscribes on prop change, so
  // guarding on the prop directly leaves a stale `reduced: false`
  // closure writing partial slices over the settled text (CR PR #193).
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  const chars = useTransform(loop, [0, start, end, 1], [0, 0, text.length, text.length]);
  useMotionValueEvent(chars, "change", (v) => {
    if (reducedRef.current) return;
    if (ref.current) ref.current.textContent = text.slice(0, Math.round(v));
  });
  return (
    <span className={className}>
      <span ref={ref}>{reduced ? text : ""}</span>
      {caret && !reduced && <span className="tq-sc-caret" aria-hidden />}
    </span>
  );
}

// ─── Shared keyframes ────────────────────────────────────────────────
// Injected once at the scene root (idempotent if rendered twice). Kept
// inline rather than in globals.css to sidestep the Turbopack
// stale-chunk gotcha and keep the showcase self-contained.
export function ShowcaseKeyframes() {
  return (
    <style>{`
      .tq-sc-caret{display:inline-block;width:2px;height:1em;margin-inline-start:3px;border-radius:1px;background:var(--tq-purple);vertical-align:-0.14em;animation:tq-sc-blink 1s steps(1) infinite;}
      @keyframes tq-sc-blink{50%{opacity:0;}}
      @media (prefers-reduced-motion: reduce){.tq-sc-caret{animation:none;}}
    `}</style>
  );
}
