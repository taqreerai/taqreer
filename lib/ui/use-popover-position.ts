"use client";

// Viewport-aware popover positioning. ONE primitive so every floating panel (the
// colour picker, the ⋯ inspector, the font search, the shapes drawer, …) can never
// clip off-screen, instead of each caller hand-guessing a flip side.
//
// What it does, every frame while open:
//   • anchors the popover to its trigger (its DOM parent — the relative wrapper),
//   • prefers `placement` (top / bottom) but FLIPS to the other side when the
//     preferred side can't fit and the other can,
//   • CLAMPS both axes inside the viewport with a margin (so even a panel taller
//     than the gap above + below still lands fully on-screen).
//
// It computes the target in VIEWPORT coordinates, then writes `position:absolute`
// + left/top expressed in the ANCHOR's local space (target − anchorRect). That is
// deliberately NOT `position:fixed`: a fixed element inside a TRANSFORMED ancestor
// (the Layers panel's collapse `translateX`, the bottom bar's entrance `translateY`)
// is positioned relative to that ancestor, not the viewport — so a fixed clamp would
// silently land off-screen. Absolute + the subtraction stays correct through any
// translated ancestor, because `getBoundingClientRect()` already folds the transform
// into the anchor's reported position. Writes styles directly (no React state → no
// per-frame re-render) so it also TRACKS a moving anchor, e.g. the in-canvas pill.
//
// Reads offsetWidth/Height (layout size, transform-independent) so a popover's own
// scale-in entrance animation doesn't throw the measurement off. The popover starts
// `visibility:hidden` (set by the caller) and is revealed here once placed — no
// first-frame flash at a stale position.

import { type RefObject, useEffect } from "react";

export type PopoverPlacement = "top" | "bottom";
export type PopoverAlign = "start" | "center" | "end";

export function usePopoverPosition(
  popoverRef: RefObject<HTMLElement | null>,
  open: boolean,
  opts: {
    placement?: PopoverPlacement;
    align?: PopoverAlign;
    gap?: number;
    margin?: number;
    dir?: "rtl" | "ltr";
  } = {},
) {
  const { placement = "bottom", align = "center", gap = 8, margin = 8, dir = "ltr" } = opts;
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const pop = popoverRef.current;
      const anchor = pop?.parentElement; // the relative wrapper = the popover's offset parent
      if (pop && anchor) {
        const a = anchor.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Horizontal: align to the anchor (start / centre / end, locale-aware), then
        // clamp inside the viewport.
        let left: number;
        if (align === "start") left = dir === "rtl" ? a.right - w : a.left;
        else if (align === "end") left = dir === "rtl" ? a.left : a.right - w;
        else left = a.left + a.width / 2 - w / 2;
        left = Math.max(margin, Math.min(left, vw - w - margin));

        // Vertical: prefer `placement`; flip to the other side only when the
        // preferred side cannot fit AND the other can; then clamp.
        const below = a.bottom + gap;
        const above = a.top - gap - h;
        const fitsBelow = below + h <= vh - margin;
        const fitsAbove = above >= margin;
        let top: number;
        if (placement === "top") top = fitsAbove || !fitsBelow ? above : below;
        else top = fitsBelow || !fitsAbove ? below : above;
        top = Math.max(margin, Math.min(top, vh - h - margin));

        // Viewport coords → offset-parent-local (transform-safe; see header). Use the
        // real offsetParent rather than assuming the anchor is positioned, so a caller
        // that forgot the `relative` wrapper still lands right.
        pop.style.position = "absolute";
        const op = (pop.offsetParent as HTMLElement | null) ?? anchor;
        const o = op.getBoundingClientRect();
        pop.style.left = `${Math.round(left - o.left)}px`;
        pop.style.top = `${Math.round(top - o.top)}px`;
        pop.style.right = "auto";
        pop.style.bottom = "auto";
        pop.style.margin = "0";
        pop.style.visibility = "visible";
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, placement, align, gap, margin, dir, popoverRef]);
}
