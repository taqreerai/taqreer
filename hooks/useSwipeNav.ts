"use client";

// Touch swipe -> prev/next navigation for slide surfaces (template lightbox,
// deck viewer, project lightbox). Returns handlers to spread onto the swipeable
// element. Direction-aware: advancing follows the reading flow, so on LTR a
// leftward swipe is "next" and on RTL a rightward swipe is "next".
//
// Guards: ignores mostly-vertical drags (so page/thumbnail scroll still works),
// multi-touch (pinch-zoom), and swipes that start on an interactive/editable
// target (buttons, inputs, moveable objects) so it never fights a real control.

import { useRef } from "react";

type Options = {
  onNext: () => void;
  onPrev: () => void;
  dir?: "ltr" | "rtl";
  // Minimum horizontal travel (px) to count as a swipe.
  threshold?: number;
  // Skip the swipe when it starts on an element matching this selector (e.g.
  // draggable editor objects). Interactive controls are always skipped.
  ignoreSelector?: string;
};

const INTERACTIVE = "button, a, input, textarea, select, [role='button'], [contenteditable='true']";

export function useSwipeNav({
  onNext,
  onPrev,
  dir = "ltr",
  threshold = 45,
  ignoreSelector,
}: Options) {
  const start = useRef<{ x: number; y: number; skip: boolean } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      start.current = null;
      return;
    }
    const target = e.target as Element | null;
    const skip = Boolean(
      target &&
        (target.closest(INTERACTIVE) ||
          (ignoreSelector && target.closest(ignoreSelector))),
    );
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, skip };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.skip || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Horizontal intent only: enough travel AND more horizontal than vertical.
    if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;
    const swipedLeft = dx < 0;
    // LTR: swipe left advances. RTL: swipe right advances.
    const next = dir === "rtl" ? !swipedLeft : swipedLeft;
    if (next) onNext();
    else onPrev();
  };

  return { onTouchStart, onTouchEnd };
}
