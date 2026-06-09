"use client";

// §23: the home/flows background — a smooth purple+blue AURORA (Stitch-style)
// plus a faint DOT field, both DISTORTED by the cursor like a black hole:
//   • dots are warped toward the pointer and vanish into a small void at its
//     centre (gravitational lens), then snap back as it passes;
//   • the aurora gets a soft dark hole punched where the pointer sits.
// The aurora does NOT follow the cursor — it just drifts; the cursor only
// distorts locally.
//
// Two canvases: the aurora is heavily blurred (low-res buffer + CSS blur) so it
// reads as flowing light, not circles; the dots stay crisp. RAF drifts the
// aurora every frame and redraws the dots only while the cursor moves; both
// pause when the tab is hidden. Reduced-motion → static, no distortion.

import { useEffect, useRef } from "react";

type AuroraBlob = {
  bx: number; // base position, normalized 0..1
  by: number;
  r: number; // radius, fraction of min dimension
  color: [number, number, number];
  alpha: number;
  ax: number; // drift amplitude
  ay: number;
  sx: number; // drift angular speed
  sy: number;
  px: number; // phase
  py: number;
};

// Saturated purples + blues only (pale lavender / pink mixed to a washed grey
// under the blur). Faster, larger drift so the aurora visibly flows (~6–10s).
const BLOBS: AuroraBlob[] = [
  { bx: 0.22, by: 0.98, r: 0.7, color: [55, 11, 244], alpha: 0.6, ax: 0.14, ay: 0.08, sx: 0.0007, sy: 0.0009, px: 0.0, py: 1.2 }, // brand blue
  { bx: 0.5, by: 1.05, r: 0.78, color: [124, 58, 237], alpha: 0.58, ax: 0.16, ay: 0.08, sx: 0.0009, sy: 0.0006, px: 2.1, py: 0.4 }, // violet
  { bx: 0.8, by: 0.96, r: 0.66, color: [147, 51, 234], alpha: 0.55, ax: 0.13, ay: 0.09, sx: 0.0006, sy: 0.001, px: 3.4, py: 2.7 }, // purple
  { bx: 0.38, by: 0.9, r: 0.55, color: [79, 70, 229], alpha: 0.5, ax: 0.17, ay: 0.08, sx: 0.001, sy: 0.0007, px: 5.0, py: 4.1 }, // indigo
  { bx: 0.65, by: 0.92, r: 0.55, color: [109, 40, 217], alpha: 0.5, ax: 0.12, ay: 0.09, sx: 0.0008, sy: 0.0008, px: 1.0, py: 3.0 }, // deep purple
];

const AURORA_SCALE = 0.5; // low-res buffer; CSS blur + stretch → smooth aurora
const DOT_SPACING = 23; // px — dense, fine grid (zoomed-out look — more dots)
const DOT_BASE_R = 0.9;
const DOT_BASE_A = 0.14;
const DOT_COLOR = "236, 238, 245"; // muted white
const WARP_RADIUS = 190; // px — the mouse's reach on the dots
// Finger-in-water: the cursor PUSHES dots away from it; each dot's offset eases
// out quickly, then flows BACK to its origin slowly — so a fast move leaves a
// wake that settles over ~1.5–2s.
const PUSH_AMOUNT = 16; // px — how far a dot is pushed at the pointer
const EASE_PUSH = 0.3; // quick displace toward the pushed position
const EASE_RETURN = 0.03; // very slow return to the origin (~3s settle)

export function MagneticGlow({
  // §23: pushes the aurora blobs further down (normalized fraction of the
  // panel) — used on the flow pages so the glow sits lower behind their cards.
  glowYOffset = 0,
  // §24: when false, render ONLY the dot field (no JS aurora) — the flow pages
  // use a static CSS bottom glow (.tq-panel-flow::before) instead, matching the
  // editor. Home keeps the animated aurora.
  aurora = true,
}: {
  glowYOffset?: number;
  aurora?: boolean;
} = {}) {
  const auroraRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  // live offset (synced via an effect so the main RAF loop doesn't re-init on
  // a route change — it reads offsetRef.current each frame).
  const offsetRef = useRef(glowYOffset);
  useEffect(() => {
    offsetRef.current = glowYOffset;
  }, [glowYOffset]);
  // live aurora-enabled flag (same reason as offsetRef: the [] effect must not
  // re-init when the prop flips on a route change).
  const auroraEnabledRef = useRef(aurora);
  useEffect(() => {
    auroraEnabledRef.current = aurora;
  }, [aurora]);

  useEffect(() => {
    const auroraCanvas = auroraRef.current;
    const dotsCanvas = dotsRef.current;
    if (!auroraCanvas || !dotsCanvas) return;
    const actxMaybe = auroraCanvas.getContext("2d");
    const dctxMaybe = dotsCanvas.getContext("2d");
    if (!actxMaybe || !dctxMaybe) return;
    const actx: CanvasRenderingContext2D = actxMaybe;
    const dctx: CanvasRenderingContext2D = dctxMaybe;
    const aCanvas: HTMLCanvasElement = auroraCanvas;
    const dCanvas: HTMLCanvasElement = dotsCanvas;

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // CSS size (shared by both canvases — they fill the viewport-height region
    // pinned to the panel top, so it's stable when the panel grows/shrinks).
    let cssW = 0;
    let cssH = 0;
    // aurora buffer size
    let aw = 0;
    let ah = 0;
    // dots DPR
    let dpr = 1;

    // pointer in CSS px relative to the panel; active when over.
    const mouse = { x: -9999, y: -9999, active: false };
    let dotsDirty = true;
    // dot grid + per-dot CURRENT displacement offset (ox/oy), allocated in
    // layout(). The offset eases toward the cursor-pushed target, then back to
    // 0 slowly — the water effect.
    let cols = 0;
    let rows = 0;
    let offX = 0;
    let offY = 0;
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let dotsAnimating = false;

    function layout() {
      const rect = aCanvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cssW = rect.width;
      cssH = rect.height;
      aw = Math.max(1, Math.round(cssW * AURORA_SCALE));
      ah = Math.max(1, Math.round(cssH * AURORA_SCALE));
      aCanvas.width = aw;
      aCanvas.height = ah;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      dCanvas.width = Math.round(cssW * dpr);
      dCanvas.height = Math.round(cssH * dpr);
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(cssW / DOT_SPACING) + 1;
      rows = Math.ceil(cssH / DOT_SPACING) + 1;
      offX = (cssW - (cols - 1) * DOT_SPACING) / 2;
      offY = (cssH - (rows - 1) * DOT_SPACING) / 2;
      ox = new Float32Array(cols * rows);
      oy = new Float32Array(cols * rows);
      dotsAnimating = false;
      dotsDirty = true;
    }

    function drawAurora(time: number) {
      actx.clearRect(0, 0, aw, ah);
      actx.globalCompositeOperation = "lighter";
      const minDim = Math.min(aw, ah);
      const yo = offsetRef.current;
      for (const b of BLOBS) {
        const by = b.by + yo;
        const dx = reduceMotion ? b.bx : b.bx + Math.sin(time * b.sx + b.px) * b.ax;
        const dy = reduceMotion ? by : by + Math.cos(time * b.sy + b.py) * b.ay;
        const gx = dx * aw;
        const gy = dy * ah;
        const gr = b.r * minDim;
        const g = actx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        const [r, gg, bb] = b.color;
        g.addColorStop(0, `rgba(${r},${gg},${bb},${b.alpha})`);
        g.addColorStop(1, `rgba(${r},${gg},${bb},0)`);
        actx.fillStyle = g;
        actx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }
      actx.globalCompositeOperation = "source-over";
    }

    function drawDots() {
      dctx.clearRect(0, 0, cssW, cssH);
      const active = mouse.active && !reduceMotion;
      const R = WARP_RADIUS;
      let anyMoved = false;
      for (let cy = 0; cy < rows; cy++) {
        const baseY = offY + cy * DOT_SPACING;
        for (let cx = 0; cx < cols; cx++) {
          const baseX = offX + cx * DOT_SPACING;
          const i = cy * cols + cx;

          // Target displacement: pushed AWAY from the cursor, 0 when away.
          let tx = 0;
          let ty = 0;
          if (active) {
            const vx = baseX - mouse.x; // away direction
            const vy = baseY - mouse.y;
            const d = Math.sqrt(vx * vx + vy * vy);
            if (d < R && d > 0.001) {
              const f = 1 - d / R; // 1 near → 0 edge
              const push = PUSH_AMOUNT * f * f;
              tx = (vx / d) * push;
              ty = (vy / d) * push;
            }
          }
          // Asymmetric ease — quick OUT (responsive), slow BACK (water settling).
          const cur = ox[i] * ox[i] + oy[i] * oy[i];
          const tgt = tx * tx + ty * ty;
          const e = tgt > cur ? EASE_PUSH : EASE_RETURN;
          let nx = ox[i] + (tx - ox[i]) * e;
          let ny = oy[i] + (ty - oy[i]) * e;
          if (nx * nx + ny * ny < 0.0025) {
            nx = 0;
            ny = 0;
          } else {
            anyMoved = true;
          }
          ox[i] = nx;
          oy[i] = ny;

          // Shrink in proportion to how far the dot is currently pushed.
          const disp = Math.sqrt(nx * nx + ny * ny);
          const r = DOT_BASE_R * (1 - Math.min(1, disp / PUSH_AMOUNT) * 0.7);
          dctx.beginPath();
          dctx.fillStyle = `rgba(${DOT_COLOR},${DOT_BASE_A})`;
          dctx.arc(baseX + nx, baseY + ny, r, 0, Math.PI * 2);
          dctx.fill();
        }
      }
      dotsAnimating = anyMoved;
      dotsDirty = false;
    }

    let raf = 0;
    function frame(time: number) {
      if (auroraEnabledRef.current) drawAurora(time);
      // Redraw the dots while the cursor is over the panel OR while any dot is
      // still easing back to its origin (the water settling), plus once on resize.
      if (mouse.active || dotsAnimating || dotsDirty) {
        drawDots();
      }
      raf = requestAnimationFrame(frame);
    }

    // One static frame — used at init + on resize under reduced-motion (no RAF).
    function drawStatic() {
      if (auroraEnabledRef.current) drawAurora(0);
      drawDots();
    }

    layout();
    if (reduceMotion) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => {
      layout();
      if (reduceMotion) drawStatic();
    });
    ro.observe(aCanvas);

    const onMove = (e: PointerEvent) => {
      const rect = aCanvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
    };
    const onLeave = () => {
      mouse.active = false;
      dotsDirty = true; // redraw once to relax the grid
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduceMotion) {
        raf = requestAnimationFrame(frame);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      {/* Aurora — heavily blurred so it flows like light, not circles. */}
      <canvas
        ref={auroraRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-[2] h-[167vh] w-full"
        style={{
          // §24: dots-only mode (flow pages) hides the JS aurora entirely.
          display: aurora ? "block" : "none",
          filter: "blur(34px) saturate(1.25)",
          // §24.1: the canvas height is VIEWPORT-relative (167vh ≈ the original
          // panel height), NOT the panel's own height. So toggling the library
          // tabs (مشاريعي ⇄ القوالب) — which changes the panel height — never
          // resizes the canvas → the dots + aurora no longer reset/breathe, while
          // the glow keeps its original look + bottom-of-viewport position.
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 40%, #000 54%, #000 60%, transparent 72%)",
          maskImage:
            "linear-gradient(to bottom, transparent 40%, #000 54%, #000 60%, transparent 72%)",
        }}
      />
      {/* Dot field — crisp; warped by the cursor. Same viewport-relative height
          as the aurora (see above) so a tab toggle never resets it. */}
      <canvas
        ref={dotsRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-[1] h-[167vh] w-full"
      />
    </>
  );
}
