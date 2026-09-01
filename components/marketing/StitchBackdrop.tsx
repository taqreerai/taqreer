"use client";

// Stitch-style landing backdrop (2026-08-30, user direction: "the gradient
// glow on stitch is animated ... let's use js to recreate it, also the dots
// on stitch react to the mouse ... let's bring it back").
//
// Two fixed canvases modeled on stitch.withgoogle.com's landing background
// (studied from their actual bg video - gweb-gemini-cdn 89e9004d...mp4 - a
// 20s fluid aurora), in OUR brand blues:
//
//   • WAVE (below): an undulating valley silhouette - a crest line that is
//     high at the viewport edges and dips past center, rippled by traveling
//     sine waves; filled beneath with a crest→deep-blue→black gradient;
//     bright blobs drift inside it and dark "cells" churn through it (the
//     video's turbulent holes); a hot highlight strokes ALONG the crest with
//     brightness that travels (the video's moving streaks). Drawn into a
//     low-res buffer and blown up under CSS blur so it reads as flowing
//     light, not geometry.
//
//   • DOTS (above): the §23 finger-in-water grid, restored from git history
//     (29f74d5, removed by the §25 CSS-only revert) with Stitch's measured
//     metrics - 16px grid, 1px-radius dots at 22% white (18% black on the
//     light theme). The cursor pushes dots away; they ease out fast and
//     settle back slow, leaving a wake.
//
// Perf contract (same as the historical component): the wave redraws every
// frame at 1/4 resolution; dots redraw only while the cursor is over the
// page or a dot is still settling; everything pauses when the tab hides;
// prefers-reduced-motion renders one static frame and disables the warp.

import { useEffect, useRef } from "react";

// ─── Wave ────────────────────────────────────────────────────────────
const WAVE_SCALE = 0.25; // low-res buffer; CSS blur + stretch → fluid light
// Brand blues (the video's violet family mapped to ours).
const DEEP: [number, number, number] = [0, 66, 224]; // #0042E0
const CORE: [number, number, number] = [0, 87, 255]; // #0057FF
const LIGHT: [number, number, number] = [51, 128, 255]; // #3380FF
const HOT: [number, number, number] = [156, 197, 255]; // #9CC5FF crest streaks
// Crest geometry (fractions of canvas height): high at the edges, dipping
// past center - measured off the video (edges ~0.28H, dip ~0.60H).
const CREST_EDGE = 0.38;
const CREST_DIP = 0.72;

// Drifting interior blobs: bright brand-blue bodies + dark cells that churn
// through the fill like the video's turbulent holes. Normalized coords are
// relative to the wave region (y 0 = crest zone, 1 = bottom).
type Blob = {
  bx: number;
  by: number;
  r: number; // fraction of buffer width
  color: [number, number, number];
  alpha: number;
  dark?: boolean;
  ax: number;
  ay: number;
  sx: number; // rad/s
  sy: number;
  px: number;
  py: number;
};
const BLOBS: Blob[] = [
  { bx: 0.18, by: 0.78, r: 0.3, color: LIGHT, alpha: 0.5, ax: 0.1, ay: 0.06, sx: 0.28, sy: 0.42, px: 0.0, py: 1.2 },
  { bx: 0.55, by: 0.9, r: 0.34, color: CORE, alpha: 0.55, ax: 0.13, ay: 0.05, sx: 0.35, sy: 0.23, px: 2.1, py: 0.4 },
  { bx: 0.86, by: 0.74, r: 0.28, color: LIGHT, alpha: 0.5, ax: 0.09, ay: 0.07, sx: 0.23, sy: 0.38, px: 3.4, py: 2.7 },
  { bx: 0.36, by: 0.7, r: 0.22, color: HOT, alpha: 0.28, ax: 0.12, ay: 0.05, sx: 0.4, sy: 0.3, px: 5.0, py: 4.1 },
  // dark churning cells (the video's holes)
  { bx: 0.3, by: 0.95, r: 0.2, color: [2, 8, 23], alpha: 0.85, dark: true, ax: 0.11, ay: 0.05, sx: 0.33, sy: 0.25, px: 1.0, py: 3.0 },
  { bx: 0.68, by: 0.8, r: 0.17, color: [2, 8, 23], alpha: 0.8, dark: true, ax: 0.1, ay: 0.06, sx: 0.25, sy: 0.4, px: 4.2, py: 0.9 },
];

// Crest line: valley parabola + tilt + two traveling ripples (speeds tuned
// up 2026-08-30, user direction: "faster more obvious").
// x in 0..1, t in seconds → y as a fraction of canvas height.
function crestY(x: number, t: number): number {
  const c = 2 * x - 1; // -1..1
  const base = CREST_DIP - (CREST_DIP - CREST_EDGE) * c * c;
  const tilt = 0.06 * Math.sin(t * 0.35) * c;
  const w1 = 0.05 * Math.sin(2 * Math.PI * 1.3 * x - t * 0.9);
  const w2 = 0.03 * Math.sin(2 * Math.PI * 2.7 * x + t * 0.55 + 1.7);
  return base + tilt + w1 + w2;
}

// ─── Dots (restored §23 finger-in-water, Stitch metrics) ─────────────
// Dot interaction ported from the Framer "Dot_Background" module
// (framerusercontent.com/modules/AItUZNfSLs1G8nuIbAiR - a three.js grid
// whose vertex shader offers Pull/Push/Twist/Lens styles), reimplemented
// on the 2d canvas since the chosen behavior has no 3D component. Owner
// direction: instead of the module's Lens zoom, the grid SHRINKS to the
// mouse - dots contract toward the pointer (the module's Pull xy term)
// and get smaller near it (inverted size term). Same mechanics
// otherwise: gaussian falloff exp(-(d/(radius*0.4))^2), the effect
// mouse LERPS toward the real pointer (12/s), and the whole effect
// fades in/out on hover (10/s).
const DOT_SPACING = 36; // px grid gap (user direction: tighter than the module's ~56)
const DOT_BASE_R = 1.5; // px dot radius (the module's dotSize 3 = diameter)
const SHRINK_RADIUS = 600; // px - the module's default influence radius
const PULL = 0.15; // fraction of the dot->mouse vector removed at full falloff
const SHRINK = 0.6; // dot radius loses up to 60% at the pointer
const MOUSE_LERP = 12; // per-second easing of the effect mouse
const ACTIVE_EASE = 10; // per-second fade of the whole interaction
// Module appearance kept as-is (its defaults are already brand blues).
const DOT_COLOR = "#4A8CFF";
const LINE_COLOR = "rgba(42,60,107,0.3)"; // #2A3C6B at lineOpacity .3
const LINE_WIDTH = 1;
// 3D parallax tilt of the whole grid, same as the module's group
// rotation: +-0.15rad toward the pointer's NDC position, eased 5/s,
// rendered as a CSS perspective transform on the (overscanned) canvas.
const TILT = 0.15; // rad
const TILT_EASE = 5; // per-second
const TILT_PERSPECTIVE = 1000; // px, the module's camera.position.z

export function StitchBackdrop() {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const waveCanvas = waveRef.current;
    const dotsCanvas = dotsRef.current;
    if (!waveCanvas || !dotsCanvas) return;
    const wctxMaybe = waveCanvas.getContext("2d");
    const dctxMaybe = dotsCanvas.getContext("2d");
    if (!wctxMaybe || !dctxMaybe) return;
    const wctx: CanvasRenderingContext2D = wctxMaybe;
    const dctx: CanvasRenderingContext2D = dctxMaybe;
    const wCanvas: HTMLCanvasElement = waveCanvas;
    const dCanvas: HTMLCanvasElement = dotsCanvas;

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let cssW = 0;
    let cssH = 0;
    let dCssW = 0; // dot canvas box (inset-0, smaller than the wave's)
    let dCssH = 0;
    let dotOffX = 0; // dot-canvas origin relative to the wave canvas
    let dotOffY = 0;
    let ww = 0; // wave buffer size
    let wh = 0;
    let dpr = 1;

    const mouse = { x: -9999, y: -9999, nx: 0, ny: 0, active: false };
    // Mouse-attracted wave bulge (user direction: the wave should react to
    // the cursor): the crest rises toward the pointer like liquid pulled by
    // a magnet. Both values ease toward their targets each frame so the
    // bulge TRAILS the cursor with a springy, liquid lag - and relaxes to
    // flat when the pointer leaves.
    let bulgeX = 0.5; // smoothed cursor x, normalized
    let bulgeS = 0; // smoothed strength, fraction of height
    // Scroll-linked reveal (user direction: "leak like water being spilled
    // slowly from the bottom, not an opacity"): at the top of the page the
    // whole wave sits BELOW the viewport; scrolling raises it into place,
    // fully risen by mid-scroll. `revealTarget` maps scrollY over half the
    // scrollable range; `reveal` eases toward it in the RAF and becomes a
    // vertical offset on the crest geometry - the fill, glow band, blobs
    // and streaks all derive from the crest, so the entire body of water
    // rises as one.
    let reveal = 0;
    let revealTarget = 0;
    const readScrollTarget = () => {
      // Spilling begins the moment scrolling starts (user direction) and
      // completes within ~1.5 viewport heights - capped by half the
      // scrollable range so short pages still reach full rise.
      const range = Math.max(
        1,
        Math.min(
          (document.documentElement.scrollHeight - window.innerHeight) * 0.5,
          window.innerHeight * 1.5,
        ),
      );
      // sqrt curve: the water's edge peeks in from the very first scrolled
      // pixels (a linear map kept it below the fold for the first ~3/4 of
      // the range, since the crest only enters the viewport late in the
      // rise), then settles toward full more gently.
      revealTarget = Math.sqrt(Math.min(1, Math.max(0, window.scrollY / range)));
    };
    let dotsDirty = true;
    let dotsAnimating = false;
    let cols = 0;
    let rows = 0;
    let offX = 0;
    let offY = 0;
    // Framer-module state: lerped effect mouse, hover fade, grid tilt.
    const fmouse = { x: -9999, y: -9999 };
    let activeSm = 0;
    let lastFrameT = 0;
    let rotX = 0;
    let rotY = 0;
    // Displaced grid node positions, rebuilt each frame while interacting.
    let nodeX = new Float32Array(0);
    let nodeY = new Float32Array(0);

    function layout() {
      const rect = wCanvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cssW = rect.width;
      cssH = rect.height;
      ww = Math.max(1, Math.round(cssW * WAVE_SCALE));
      wh = Math.max(1, Math.round(cssH * WAVE_SCALE));
      wCanvas.width = ww;
      wCanvas.height = wh;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // The dot canvas is inset-0 while the wave canvas overscans
      // -inset-12: size and address the dot grid in ITS OWN box (the old
      // shared cssW/cssH squeezed the grid ~5% and shifted the cursor
      // target 48px).
      const drect = dCanvas.getBoundingClientRect();
      dCssW = drect.width;
      dCssH = drect.height;
      dotOffX = drect.left - rect.left;
      dotOffY = drect.top - rect.top;
      dCanvas.width = Math.round(dCssW * dpr);
      dCanvas.height = Math.round(dCssH * dpr);
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(dCssW / DOT_SPACING) + 1;
      rows = Math.ceil(dCssH / DOT_SPACING) + 1;
      offX = (dCssW - (cols - 1) * DOT_SPACING) / 2;
      offY = (dCssH - (rows - 1) * DOT_SPACING) / 2;
      nodeX = new Float32Array(cols * rows);
      nodeY = new Float32Array(cols * rows);
      dotsAnimating = false;
      dotsDirty = true;
    }

    function drawWave(tMs: number) {
      const t = reduceMotion ? 0 : tMs / 1000;
      wctx.clearRect(0, 0, ww, wh);

      // The water level: 0 risen (normal position) .. sunk fully below the
      // viewport at the top of the page. 0.8 is JUST enough to clear the
      // highest crest point (edges 0.38 minus ripple + tilt + bulge
      // headroom) past y=1 - any more and the first scrolled pixels waste
      // travel before the water's edge can appear.
      const rise = (1 - reveal) * 0.8;

      // Ease the bulge toward the cursor. Strength scales with how close
      // the pointer is to the CURRENT water level (hovering near the glow
      // pulls hard; while the wave is still sunk it barely stirs).
      if (!reduceMotion) {
        let targetX = bulgeX;
        let targetS = 0;
        if (mouse.active && cssW > 0 && cssH > 0) {
          targetX = mouse.x / cssW;
          const my = mouse.y / cssH;
          const dy = Math.abs(my - (crestY(targetX, t) + rise));
          targetS = Math.max(0, 1 - dy / 0.45) * 0.11;
        }
        bulgeX += (targetX - bulgeX) * 0.07;
        bulgeS += (targetS - bulgeS) * 0.05;
      }
      // Local crest = base crest + rise, minus a gaussian bump rising
      // toward the cursor's x (negative y = up).
      const crest = (x: number): number => {
        const d = x - bulgeX;
        return (
          crestY(x, t) +
          rise -
          bulgeS * Math.exp(-(d * d) / (2 * 0.09 * 0.09))
        );
      };

      // 1. Valley body: path under the crest line, filled with a vertical
      //    crest→deep→black gradient. The crest edge stays sharp-ish (the
      //    CSS blur feathers it just enough, like the video's silhouette).
      wctx.beginPath();
      wctx.moveTo(0, wh + 2);
      for (let px = 0; px <= ww; px += 2) {
        wctx.lineTo(px, crest(px / ww) * wh);
      }
      wctx.lineTo(ww, wh + 2);
      wctx.closePath();
      const dipY = crest(0.5) * wh;
      // Dim body: in the video the interior falls to near-black fast -
      // brightness lives in the crest band + blobs, not the fill.
      const g = wctx.createLinearGradient(0, dipY - wh * 0.1, 0, wh);
      g.addColorStop(0, `rgba(${CORE[0]},${CORE[1]},${CORE[2]},0.35)`);
      g.addColorStop(0.4, `rgba(${DEEP[0]},${DEEP[1]},${DEEP[2]},0.2)`);
      // Bottom stays a VISIBLY blue navy (not near-black): the water body
      // must read as cut by the viewport edge and continuing beneath it,
      // not as fading out before it gets there.
      g.addColorStop(1, "rgba(6,24,72,0.9)");
      wctx.fillStyle = g;
      wctx.fill();

      // 2. Everything else clips to the valley path (still the current
      //    path here - the clip MUST come before any other beginPath).
      wctx.save();
      wctx.clip();

      // Crest-hugging glow band: the area between the crest and the crest
      // shifted down ~12% of the height, filled bright - this is what makes
      // the video's silhouette read as a glowing ridge rather than a flood.
      const band = wh * 0.12;
      wctx.beginPath();
      for (let px = 0; px <= ww; px += 2) {
        const y = crest(px / ww) * wh;
        if (px === 0) wctx.moveTo(px, y);
        else wctx.lineTo(px, y);
      }
      for (let px = ww; px >= 0; px -= 2) {
        wctx.lineTo(px, crest(px / ww) * wh + band);
      }
      wctx.closePath();
      wctx.fillStyle = `rgba(${LIGHT[0]},${LIGHT[1]},${LIGHT[2]},0.5)`;
      wctx.fill();

      // Interior blobs: bright bodies (lighter) then dark churning cells
      // (source-over) - the video's turbulence.
      const crestBand = wh * (CREST_DIP - CREST_EDGE);
      for (const b of BLOBS) {
        const bx = (b.bx + Math.sin(t * b.sx + b.px) * b.ax) * ww;
        const byRegion =
          crest(b.bx) * wh +
          (b.by + Math.cos(t * b.sy + b.py) * b.ay - 0.5) * crestBand * 2;
        const r = b.r * ww;
        const rg = wctx.createRadialGradient(bx, byRegion, 0, bx, byRegion, r);
        const [cr, cg, cb] = b.color;
        rg.addColorStop(0, `rgba(${cr},${cg},${cb},${b.alpha})`);
        rg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        wctx.globalCompositeOperation = b.dark ? "source-over" : "lighter";
        wctx.fillStyle = rg;
        wctx.fillRect(bx - r, byRegion - r, r * 2, r * 2);
      }
      wctx.globalCompositeOperation = "source-over";
      wctx.restore();

      // 3. Hot crest streaks: short bright segments along the crest whose
      //    intensity travels with time (the video's moving highlights).
      wctx.lineWidth = Math.max(1.5, wh * 0.012);
      wctx.lineCap = "round";
      const SEG = 24;
      for (let s = 0; s < SEG; s++) {
        const x0 = s / SEG;
        const x1 = (s + 1) / SEG;
        // brightness wave traveling along the crest (sped up with the rest),
        // plus a hot spot that glows around the cursor's x when it is near
        // the wave - the crest "heats up" under the pointer.
        const heat =
          0.5 +
          0.5 * Math.sin(2 * Math.PI * 1.1 * x0 - t * 1.4 + Math.sin(t * 0.2) * 2);
        const dxm = x0 - bulgeX;
        const cursorHeat =
          (bulgeS / 0.11) * Math.exp(-(dxm * dxm) / (2 * 0.06 * 0.06));
        const a = Math.min(0.9, 0.15 + 0.6 * heat * heat + 0.45 * cursorHeat);
        wctx.strokeStyle = `rgba(${HOT[0]},${HOT[1]},${HOT[2]},${a})`;
        wctx.beginPath();
        wctx.moveTo(x0 * ww, crest(x0) * wh);
        wctx.lineTo(x1 * ww, crest(x1) * wh);
        wctx.stroke();
      }
    }

    function drawDots(nowMs: number) {
      dctx.clearRect(0, 0, dCssW, dCssH);
      const active = mouse.active && !reduceMotion;
      const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameT) / 1000));
      lastFrameT = nowMs;
      // Cursor in dot-canvas space (mouse.x/y are wave-canvas relative).
      const mx = mouse.x - dotOffX;
      const my = mouse.y - dotOffY;

      // Hover fade + effect-mouse lerp (the module's currentActive and
      // u_mouse.lerp, converted from per-frame*delta to our clock).
      activeSm += ((active ? 1 : 0) - activeSm) * Math.min(1, ACTIVE_EASE * dt);
      if (activeSm < 0.005) activeSm = 0;
      if (active) {
        const t = Math.min(1, MOUSE_LERP * dt);
        if (fmouse.x < -5000) {
          fmouse.x = mx;
          fmouse.y = my;
        } else {
          fmouse.x += (mx - fmouse.x) * t;
          fmouse.y += (my - fmouse.y) * t;
        }
      }

      // 3D parallax tilt (the module's group rotation): rotate the whole
      // grid toward the pointer's NDC position under perspective.
      const te = Math.min(1, TILT_EASE * dt);
      const targetRotX = active ? -mouse.ny * TILT : 0;
      const targetRotY = active ? mouse.nx * TILT : 0;
      rotX += (targetRotX - rotX) * te;
      rotY += (targetRotY - rotY) * te;
      const tilting = Math.abs(rotX) > 0.0005 || Math.abs(rotY) > 0.0005;
      dCanvas.style.transform =
        reduceMotion || (!tilting && !active)
          ? ""
          : `perspective(${TILT_PERSPECTIVE}px) rotateX(${rotX}rad) rotateY(${rotY}rad)`;

      // Pass 1: displaced node positions (shared by lines AND dots, so
      // the mesh bends with the shrink exactly like the module's shader).
      const sigma = SHRINK_RADIUS * 0.4;
      const inv2s2 = 1 / (sigma * sigma);
      for (let cy = 0; cy < rows; cy++) {
        const baseY = offY + cy * DOT_SPACING;
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          const baseX = offX + cx * DOT_SPACING;
          let x = baseX;
          let y = baseY;
          if (activeSm > 0) {
            const dx = baseX - fmouse.x;
            const dy = baseY - fmouse.y;
            const k = Math.exp(-(dx * dx + dy * dy) * inv2s2) * activeSm;
            x -= dx * PULL * k;
            y -= dy * PULL * k;
          }
          nodeX[i] = x;
          nodeY[i] = y;
        }
      }

      // Pass 2: the connecting line mesh.
      dctx.strokeStyle = LINE_COLOR;
      dctx.lineWidth = LINE_WIDTH;
      dctx.beginPath();
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          if (cx + 1 < cols) {
            dctx.moveTo(nodeX[i], nodeY[i]);
            dctx.lineTo(nodeX[i + 1], nodeY[i + 1]);
          }
          if (cy + 1 < rows) {
            dctx.moveTo(nodeX[i], nodeY[i]);
            dctx.lineTo(nodeX[i + cols], nodeY[i + cols]);
          }
        }
      }
      dctx.stroke();

      // Pass 3: dots, shrinking toward the pointer.
      dctx.fillStyle = DOT_COLOR;
      dctx.beginPath();
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          let r = DOT_BASE_R;
          if (activeSm > 0) {
            const dx = offX + cx * DOT_SPACING - fmouse.x;
            const dy = offY + cy * DOT_SPACING - fmouse.y;
            const k = Math.exp(-(dx * dx + dy * dy) * inv2s2) * activeSm;
            r = Math.max(0.1, DOT_BASE_R * (1 - SHRINK * k));
          }
          dctx.moveTo(nodeX[i] + r, nodeY[i]);
          dctx.arc(nodeX[i], nodeY[i], r, 0, Math.PI * 2);
        }
      }
      dctx.fill();
      dotsAnimating = activeSm > 0 || tilting;
      dotsDirty = false;
    }

    let raf = 0;
    let waveCleared = false;
    function frame(time: number) {
      // Ease the scroll reveal (water rising, not a hard scrollbar map).
      reveal += (revealTarget - reveal) * 0.08;
      if (reveal > 0.005) {
        drawWave(time);
        waveCleared = false;
      } else if (!waveCleared) {
        // Fully sunk: one clear, then skip redraws until it rises again.
        wctx.clearRect(0, 0, ww, wh);
        waveCleared = true;
      }
      if (mouse.active || dotsAnimating || dotsDirty) drawDots(time);
      raf = requestAnimationFrame(frame);
    }
    function drawStatic() {
      // Reduced motion: no easing loop - the reveal maps directly.
      reveal = revealTarget;
      drawWave(0);
      drawDots(0);
    }

    layout();
    readScrollTarget();
    if (reduceMotion) {
      reveal = revealTarget;
      drawStatic();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => {
      layout();
      if (reduceMotion) drawStatic();
    });
    ro.observe(wCanvas);

    // Theme flips (.light on <html>) recolor the dots on the next draw.
    const mo = new MutationObserver(() => {
      dotsDirty = true;
      if (reduceMotion) drawStatic();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const onMove = (e: PointerEvent) => {
      const rect = wCanvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      mouse.active =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= 0 &&
        e.clientY <= window.innerHeight;
    };
    const onLeave = () => {
      mouse.active = false;
      dotsDirty = true; // one relax redraw
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduceMotion) {
        raf = requestAnimationFrame(frame);
      }
    };

    const onScroll = () => {
      readScrollTarget();
      // Reduced motion has no RAF to ease/apply - map directly on scroll.
      if (reduceMotion) {
        reveal = revealTarget;
        drawStatic();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      {/* Wave - blurred so the low-res buffer reads as flowing light. The
          light theme softens it via the .tq-stitch-wave-canvas override.
          -inset-12 (48px overscan, > the 26px blur radius) pushes the
          blur's transparent edge-feather OFF-SCREEN so the water is cut by
          the viewport - it reads as continuing past the edges, not as a
          vignette fading out at left/right/bottom. */}
      <canvas
        ref={waveRef}
        aria-hidden
        className="tq-stitch-wave-canvas pointer-events-none fixed -inset-12 -z-[1] h-[calc(100%+6rem)] w-[calc(100%+6rem)]"
      />
      {/* Dots - crisp, warped by the cursor. */}
      <canvas
        ref={dotsRef}
        aria-hidden
        className="pointer-events-none fixed -inset-32 -z-[1] h-[calc(100%+16rem)] w-[calc(100%+16rem)]"
      />
    </>
  );
}
