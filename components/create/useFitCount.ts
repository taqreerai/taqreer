"use client";

// How many grid tiles to render WITHOUT scrolling (/create's Design card,
// 2026-10-07): whole rows only, the rest goes behind "Show all". Measured, not
// guessed: the grid's resolved column count, its tallest tile and row gap.
//
// - Height-bound box (`overflow: hidden`, set by the `stage:` variant): the
//   rows that fit its height, capped at `maxRows` (the colour templates).
// - Height-bound box that scrolls (`overflow-y: auto`, the template and style
//   grids): null = every tile renders, the box scrolls.
// - Box that grows with its content (phones, short viewports): `maxRows` rows,
//   so a long list never runs on forever (owner direction 2026-10-07: 4 rows).
//   No `maxRows` there = null = every tile renders.

import { useLayoutEffect, useRef, useState } from "react";

// The design grids' row cap (templates + styles): at most 4 rows on any screen.
export const FIT_MAX_ROWS = 4;

export function useFitCount(enabled: boolean, total: number, maxRows?: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number | null>(null);

  // Layout effect: the first measure lands before paint, so a phone never
  // flashes the full list before it is cut to `maxRows`.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!enabled || !box || !grid) return;
    const measure = () => {
      const gs = getComputedStyle(grid);
      // A hidden tab (display:none) has no columns or size: keep the last
      // count until it shows again (the ResizeObserver fires then).
      if (gs.gridTemplateColumns === "none" || box.clientWidth === 0) return;
      const cols = gs.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const overflowY = getComputedStyle(box).overflowY;
      // A box that scrolls (the design grids on a viewport-fit stage, owner
      // direction 2026-10-07: templates and styles scroll, colours don't):
      // every tile renders and the box scrolls.
      if (overflowY === "auto" || overflowY === "scroll") {
        setCount(null);
        return;
      }
      if (overflowY !== "hidden") {
        setCount(maxRows ? maxRows * cols : null);
        return;
      }
      let tileH = 0;
      for (const el of Array.from(grid.children)) {
        tileH = Math.max(tileH, el.getBoundingClientRect().height);
      }
      if (tileH === 0 || box.clientHeight === 0) return;
      const gap = parseFloat(gs.rowGap) || 0;
      const fit = Math.max(1, Math.floor((box.clientHeight + gap) / (tileH + gap)));
      setCount((maxRows ? Math.min(fit, maxRows) : fit) * cols);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    return () => ro.disconnect();
  }, [enabled, total, maxRows]);

  return { boxRef, gridRef, count: enabled ? count : null };
}
