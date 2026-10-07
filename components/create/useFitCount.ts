"use client";

// How many grid tiles fit a fixed-height box WITHOUT scrolling (/create's
// viewport-fit Design card, 2026-10-07): whole rows only, the rest goes behind
// "Show all". Measured, not guessed: the grid's resolved column count, its
// tallest tile and row gap, against the box's height.
//
// The box only limits while it is actually clipped (`overflow: hidden`, set by
// the `stage:` variant). On phones / short viewports the box grows with its
// content, so the count is null and every tile renders.

import { useEffect, useRef, useState } from "react";

export function useFitCount(enabled: boolean, total: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!enabled || !box || !grid) return;
    const measure = () => {
      if (getComputedStyle(box).overflowY !== "hidden") {
        setCount(null);
        return;
      }
      const gs = getComputedStyle(grid);
      const cols = gs.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      let tileH = 0;
      for (const el of Array.from(grid.children)) {
        tileH = Math.max(tileH, el.getBoundingClientRect().height);
      }
      // A hidden tab measures 0: keep the last count until it shows again
      // (the ResizeObserver fires then).
      if (tileH === 0 || box.clientHeight === 0) return;
      const gap = parseFloat(gs.rowGap) || 0;
      const rows = Math.max(1, Math.floor((box.clientHeight + gap) / (tileH + gap)));
      setCount(rows * cols);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    return () => ro.disconnect();
  }, [enabled, total]);

  return { boxRef, gridRef, count: enabled ? count : null };
}
