"use client";

// Stitch-style landing backdrop (2026-08-30, user direction: "the gradient
// glow on stitch is animated ... let's use js to recreate it, also the dots
// on stitch react to the mouse ... let's bring it back").
//
// Two fixed canvases, in OUR brand blues:
//
//   • WAVE (below): an undulating valley silhouette modeled on
//     stitch.withgoogle.com's landing bg video - a crest line high at the
//     viewport edges dipping past center, rippled by traveling sine waves;
//     filled beneath with a crest→deep-blue→black gradient; bright blobs
//     drift inside it and dark "cells" churn through it; a hot highlight
//     strokes ALONG the crest with brightness that travels. Drawn into a
//     low-res buffer and blown up under CSS blur so it reads as flowing
//     light, not geometry.
//
//   • DOTS (above): a dot-and-line grid on the Framer "Dot_Background"
//     mechanics with a custom shrink-to-mouse interaction - see the
//     constants block below for the full contract.
//
// Perf contract: the wave redraws every frame at 1/4 resolution while
// visible; the dot grid redraws only while the interaction is actually
// changing (pointer moving, fade in/out, tilt easing) and skips entirely
// once converged on a stationary pointer; the RAF loop stops scheduling
// when both layers are idle and restarts from scroll/pointer/visibility;
// everything pauses when the tab hides; prefers-reduced-motion renders one
// static frame and disables the interaction.

import { useEffect, useRef } from "react";

// ─── Wave ────────────────────────────────────────────────────────────
const WAVE_SCALE = 0.25; // low-res buffer; CSS blur + stretch → fluid light
// Brand blues (the video's violet family mapped to ours). CORE mirrors
// globals.css --tq-brand-blue (#0057FF) and LIGHT mirrors --tq-purple
// (#3380FF) - keep in sync on a rebrand (canvas can't read CSS vars
// without runtime plumbing; these are deliberate baked copies).
const DEEP: [number, number, number] = [0, 66, 224]; // #0042E0
const CORE: [number, number, number] = [0, 87, 255]; // #0057FF
const LIGHT: [number, number, number] = [51, 128, 255]; // #3380FF
const HOT: [number, number, number] = [156, 197, 255]; // #9CC5FF crest streaks
// Crest geometry (fractions of canvas height): high at the edges, dipping
// past center - measured off the video (edges ~0.28H, dip ~0.60H).
const CREST_EDGE = 0.38;
const CREST_DIP = 0.72;
// Cursor bulge: peak crest rise as a fraction of height. bulgeS itself
// stays normalized 0..1 (the streak heat reuses it directly).
const BULGE_MAX = 0.11;

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

// ─── Dots (Framer Dot_Background mechanics, shrink-to-mouse) ─────────
// Ported from framerusercontent.com/modules/AItUZNfSLs1G8nuIbAiR - a
// three.js grid whose vertex shader offers Pull/Push/Twist/Lens styles -
// reimplemented on the 2d canvas since the chosen behavior has no 3D
// geometry. Owner direction: instead of the module's Lens zoom, the grid
// SHRINKS to the mouse - dots contract toward the pointer (the module's
// Pull xy term) and get smaller near it. Same mechanics otherwise:
// gaussian falloff exp(-(d/(radius*0.4))^2), the effect mouse LERPS
// toward the real pointer (12/s), the whole effect fades in/out on hover
// (10/s), and the connecting line mesh + 3D parallax tilt are kept.
// Grid metrics + color mirror the app dashboard's .tq-dot-grid texture
// (globals.css: --tq-dot dots, 0.9px radius, 23px cell) per user
// direction - one visual language across marketing and app. The dot
// color is READ from the --tq-dot token at layout time so it cannot
// drift from the dashboard's.
const DOT_SPACING = 23; // px grid gap (= .tq-dot-grid background-size)
const DOT_BASE_R = 0.9; // px dot radius (= .tq-dot-grid gradient stop)
const SHRINK_RADIUS = 600; // px - the module's default influence radius
const PULL = 0.15; // fraction of the dot->mouse vector removed at full falloff
const SHRINK = 0.6; // dot radius loses up to 60% at the pointer
const MOUSE_LERP = 12; // per-second easing of the effect mouse
const ACTIVE_EASE = 10; // per-second fade of the whole interaction
const DOT_FALLBACK = "rgba(236,238,245,0.14)"; // --tq-dot dark value
const LINE_ALPHA = 0.55; // line mesh = the dot color, further dimmed
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
    const waveEl = waveRef.current;
    const dotsEl = dotsRef.current;
    if (!waveEl || !dotsEl) return;
    // Re-bind to narrowed consts: the draw functions below are hoisted
    // declarations, so TS can't carry the guard's narrowing into them.
    const waveCanvas = waveEl;
    const dotsCanvas = dotsEl;
    const wctxOrNull = waveCanvas.getContext("2d");
    const dctxOrNull = dotsCanvas.getContext("2d");
    if (!wctxOrNull || !dctxOrNull) return;
    const wctx = wctxOrNull;
    const dctx = dctxOrNull;

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let cssW = 0;
    let cssH = 0;
    let waveLeft = 0; // wave-canvas origin in client coords (cached: the
    let waveTop = 0; // canvases are fixed, so it only moves on layout)
    let dCssW = 0; // dot canvas box (it overscans MORE than the wave's)
    let dCssH = 0;
    let vw2 = 0; // viewport half-extents (for the tilt coverage solve)
    let vh2 = 0;
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
    let bulgeS = 0; // smoothed strength, normalized 0..1
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
    let dotsSettled = false; // converged on a stationary pointer → skip draws
    let cols = 0;
    let rows = 0;
    let offX = 0;
    let offY = 0;
    // Dot/line paint, read from the dashboard's --tq-dot token in layout.
    let dotColor = DOT_FALLBACK;
    // Framer-module state: lerped effect mouse, hover fade, grid tilt.
    const fmouse = { x: -9999, y: -9999 };
    let activeSm = 0;
    let lastFrameT = 0;
    let rotX = 0;
    let rotY = 0;
    // Per-node scratch: displaced positions + gaussian falloff, rebuilt
    // each interactive frame and shared by the line and dot passes.
    let nodeX = new Float32Array(0);
    let nodeY = new Float32Array(0);
    let nodeK = new Float32Array(0);
    // Per-column crest ys (one entry every 2 buffer px), rebuilt each wave
    // frame and shared by the body path, glow band, and streaks.
    let crestYs = new Float32Array(0);
    // Pre-rendered layers (rebuilt in layout): the full grid at REST -
    // per frame we blit this and redraw only the influence region - and
    // one sprite per wave blob (radial gradients rasterized once instead
    // of allocated per frame).
    const staticGrid = document.createElement("canvas");
    const sctxOrNull = staticGrid.getContext("2d");
    const blobSprites: HTMLCanvasElement[] = [];
    // Region drawn dynamically last frame (css px, canvas space), so the
    // next frame knows what to restore from the static layer.
    let prevRegion: { x0: number; y0: number; x1: number; y1: number } | null =
      null;
    // Content-change tracking: the tilt is transform-only, so canvas
    // pixels only change when the fade or the effect mouse moved.
    let lastFx = -1;
    let lastFy = -1;
    let lastASm = -1;

    function layout() {
      const rect = waveCanvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cssW = rect.width;
      cssH = rect.height;
      waveLeft = rect.left;
      waveTop = rect.top;
      ww = Math.max(1, Math.round(cssW * WAVE_SCALE));
      wh = Math.max(1, Math.round(cssH * WAVE_SCALE));
      waveCanvas.width = ww;
      waveCanvas.height = wh;
      crestYs = new Float32Array(Math.floor(ww / 2) + 2);
      // Capped at 1.5: the dot layer is dim 1px texture - full retina
      // doubles the backing store + per-frame GPU upload for no visible
      // gain (at 2560px wide, dpr2 = ~57MB re-uploaded on every change).
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      // Each canvas is addressed in its OWN measured box (they overscan by
      // different amounts); the offsets convert wave-relative mouse coords
      // into the dot canvas's frame.
      const drect = dotsCanvas.getBoundingClientRect();
      dCssW = drect.width;
      dCssH = drect.height;
      vw2 = window.innerWidth / 2;
      vh2 = window.innerHeight / 2;
      dotOffX = drect.left - rect.left;
      dotOffY = drect.top - rect.top;
      dotsCanvas.width = Math.round(dCssW * dpr);
      dotsCanvas.height = Math.round(dCssH * dpr);
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(dCssW / DOT_SPACING) + 1;
      rows = Math.ceil(dCssH / DOT_SPACING) + 1;
      offX = (dCssW - (cols - 1) * DOT_SPACING) / 2;
      offY = (dCssH - (rows - 1) * DOT_SPACING) / 2;
      nodeX = new Float32Array(cols * rows);
      nodeY = new Float32Array(cols * rows);
      nodeK = new Float32Array(cols * rows);
      dotColor =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--tq-dot")
          .trim() || DOT_FALLBACK;
      paintStaticGrid();
      buildBlobSprites();
      prevRegion = null;
      lastFx = -1;
      lastFy = -1;
      lastASm = -1;
      dotsAnimating = false;
      dotsSettled = false;
      dotsDirty = true;
    }

    // The whole mesh + dots at rest, painted ONCE per layout/theme. Per
    // frame this is blitted (a GPU-side copy) instead of re-stroking
    // ~2x cols x rows path segments.
    function paintStaticGrid() {
      if (!sctxOrNull) return;
      staticGrid.width = dotsCanvas.width;
      staticGrid.height = dotsCanvas.height;
      const sctx = sctxOrNull;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, dCssW, dCssH);
      sctx.strokeStyle = dotColor;
      sctx.globalAlpha = LINE_ALPHA;
      sctx.lineWidth = LINE_WIDTH;
      sctx.beginPath();
      for (let cy = 0; cy < rows; cy++) {
        const y = offY + cy * DOT_SPACING;
        sctx.moveTo(offX, y);
        sctx.lineTo(offX + (cols - 1) * DOT_SPACING, y);
      }
      for (let cx = 0; cx < cols; cx++) {
        const x = offX + cx * DOT_SPACING;
        sctx.moveTo(x, offY);
        sctx.lineTo(x, offY + (rows - 1) * DOT_SPACING);
      }
      sctx.stroke();
      sctx.globalAlpha = 1;
      sctx.fillStyle = dotColor;
      sctx.beginPath();
      for (let cy = 0; cy < rows; cy++) {
        const y = offY + cy * DOT_SPACING;
        for (let cx = 0; cx < cols; cx++) {
          const x = offX + cx * DOT_SPACING;
          sctx.moveTo(x + DOT_BASE_R, y);
          sctx.arc(x, y, DOT_BASE_R, 0, Math.PI * 2);
        }
      }
      sctx.fill();
    }

    function buildBlobSprites() {
      blobSprites.length = 0;
      for (const b of BLOBS) {
        const r = Math.max(2, Math.ceil(b.r * ww));
        const c = document.createElement("canvas");
        c.width = r * 2;
        c.height = r * 2;
        const bctx = c.getContext("2d");
        if (bctx) {
          const rg = bctx.createRadialGradient(r, r, 0, r, r, r);
          const [cr, cg, cb] = b.color;
          rg.addColorStop(0, `rgba(${cr},${cg},${cb},${b.alpha})`);
          rg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          bctx.fillStyle = rg;
          bctx.fillRect(0, 0, r * 2, r * 2);
        }
        blobSprites.push(c);
      }
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
          targetS = Math.max(0, 1 - dy / 0.45);
        }
        bulgeX += (targetX - bulgeX) * 0.07;
        bulgeS += (targetS - bulgeS) * 0.05;
        if (bulgeS < 0.001) bulgeS = 0; // let the bulge exp shut off fully
      }
      // Local crest = base crest + rise, minus a gaussian bump rising
      // toward the cursor's x (negative y = up).
      const crest = (x: number): number => {
        const base = crestY(x, t) + rise;
        if (bulgeS === 0) return base;
        const d = x - bulgeX;
        return base - bulgeS * BULGE_MAX * Math.exp(-(d * d) / (2 * 0.09 * 0.09));
      };
      // Sample the crest once per 2-px column; every pass below indexes
      // this instead of re-evaluating the sines + bulge exp.
      const nCols = Math.floor(ww / 2);
      for (let i = 0; i <= nCols; i++) {
        crestYs[i] = crest((i * 2) / ww) * wh;
      }

      // 1. Valley body: path under the crest line, filled with a vertical
      //    crest→deep→black gradient. The crest edge stays sharp-ish (the
      //    CSS blur feathers it just enough, like the video's silhouette).
      wctx.beginPath();
      wctx.moveTo(0, wh + 2);
      for (let i = 0; i <= nCols; i++) {
        wctx.lineTo(i * 2, crestYs[i]);
      }
      wctx.lineTo(ww, wh + 2);
      wctx.closePath();
      const dipY = crestYs[nCols >> 1];
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
      wctx.moveTo(0, crestYs[0]);
      for (let i = 1; i <= nCols; i++) {
        wctx.lineTo(i * 2, crestYs[i]);
      }
      for (let i = nCols; i >= 0; i--) {
        wctx.lineTo(i * 2, crestYs[i] + band);
      }
      wctx.closePath();
      wctx.fillStyle = `rgba(${LIGHT[0]},${LIGHT[1]},${LIGHT[2]},0.5)`;
      wctx.fill();

      // Interior blobs: bright bodies (lighter) then dark churning cells
      // (source-over) - the video's turbulence.
      const crestBand = wh * (CREST_DIP - CREST_EDGE);
      for (let bi = 0; bi < BLOBS.length; bi++) {
        const b = BLOBS[bi];
        const sprite = blobSprites[bi];
        if (!sprite) continue;
        const bx = (b.bx + Math.sin(t * b.sx + b.px) * b.ax) * ww;
        const byRegion =
          crest(b.bx) * wh +
          (b.by + Math.cos(t * b.sy + b.py) * b.ay - 0.5) * crestBand * 2;
        const r = b.r * ww;
        wctx.globalCompositeOperation = b.dark ? "source-over" : "lighter";
        wctx.drawImage(sprite, bx - r, byRegion - r, r * 2, r * 2);
      }
      wctx.globalCompositeOperation = "source-over";
      wctx.restore();

      // 3. Hot crest streaks: short bright segments along the crest whose
      //    intensity travels with time (the video's moving highlights).
      //    One solid strokeStyle; per-segment brightness via globalAlpha
      //    (avoids 24 rgba string allocations per frame).
      wctx.lineWidth = Math.max(1.5, wh * 0.012);
      wctx.lineCap = "round";
      wctx.strokeStyle = `rgb(${HOT[0]},${HOT[1]},${HOT[2]})`;
      const SEG = 24;
      const colStep = nCols / SEG;
      for (let s = 0; s < SEG; s++) {
        const x0 = s / SEG;
        // brightness wave traveling along the crest (sped up with the rest),
        // plus a hot spot that glows around the cursor's x when it is near
        // the wave - the crest "heats up" under the pointer.
        const heat =
          0.5 +
          0.5 * Math.sin(2 * Math.PI * 1.1 * x0 - t * 1.4 + Math.sin(t * 0.2) * 2);
        const dxm = x0 - bulgeX;
        const cursorHeat =
          bulgeS === 0
            ? 0
            : bulgeS * Math.exp(-(dxm * dxm) / (2 * 0.06 * 0.06));
        wctx.globalAlpha = Math.min(0.9, 0.15 + 0.6 * heat * heat + 0.45 * cursorHeat);
        const i0 = Math.round(s * colStep);
        const i1 = Math.round((s + 1) * colStep);
        wctx.beginPath();
        wctx.moveTo(i0 * 2, crestYs[i0]);
        wctx.lineTo(i1 * 2, crestYs[i1]);
        wctx.stroke();
      }
      wctx.globalAlpha = 1;
    }

    function drawDots(nowMs: number) {
      // No blanket clear here: clearing is region-managed in the
      // content block below (full clear only when dotsDirty).
      const active = mouse.active && !reduceMotion;
      const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameT) / 1000));
      lastFrameT = nowMs;
      // Cursor in dot-canvas space (mouse.x/y are wave-canvas relative).
      const mx = mouse.x - dotOffX;
      const my = mouse.y - dotOffY;

      // Hover fade + effect-mouse lerp (the module's currentActive and
      // u_mouse.lerp, converted from per-frame*delta to our clock). Each
      // eased value SNAPS onto its target once close so the interaction
      // can report itself converged and stop redrawing.
      activeSm += ((active ? 1 : 0) - activeSm) * Math.min(1, ACTIVE_EASE * dt);
      if (activeSm < 0.005) activeSm = 0;
      else if (activeSm > 0.995) activeSm = 1;
      if (active) {
        const t = Math.min(1, MOUSE_LERP * dt);
        if (fmouse.x < -5000) {
          fmouse.x = mx;
          fmouse.y = my;
        } else {
          fmouse.x += (mx - fmouse.x) * t;
          fmouse.y += (my - fmouse.y) * t;
          if (Math.abs(mx - fmouse.x) < 0.05 && Math.abs(my - fmouse.y) < 0.05) {
            fmouse.x = mx;
            fmouse.y = my;
          }
        }
      }

      // 3D parallax tilt (the module's group rotation): rotate the whole
      // grid toward the pointer's NDC position under perspective.
      const te = Math.min(1, TILT_EASE * dt);
      const targetRotX = active ? -mouse.ny * TILT : 0;
      const targetRotY = active ? mouse.nx * TILT : 0;
      rotX += (targetRotX - rotX) * te;
      rotY += (targetRotY - rotY) * te;
      if (Math.abs(targetRotX - rotX) < 0.0005) rotX = targetRotX;
      if (Math.abs(targetRotY - rotY) < 0.0005) rotY = targetRotY;
      const tilting = rotX !== 0 || rotY !== 0;
      // Dynamic coverage scale: under the tilt the receding side of the
      // plane projects SMALLER, and on large screens that pulls the grid
      // edge into view no matter what fixed overscan is baked in. Solve,
      // for the CURRENT rotation and the ACTUAL canvas/viewport sizes,
      // the uniform scale k that keeps the projected far corner beyond
      // the viewport corner: projected x = k*H*cos * p/(p + k*z), with
      // z the corner's recession. k=1 at rest; only extreme corner
      // tilts scale up (a few %, invisible on 0.14-alpha dots).
      let k = 1;
      if (tilting) {
        const Hx = dCssW / 2;
        const Hy = dCssH / 2;
        const zBase = Hx * Math.abs(Math.sin(rotY)) + Hy * Math.abs(Math.sin(rotX));
        const cx = Math.cos(rotY);
        const cy = Math.cos(rotX);
        for (let it = 0; it < 3; it++) {
          const z = k * zBase;
          const kx = (vw2 * (TILT_PERSPECTIVE + z)) / (Hx * cx * TILT_PERSPECTIVE);
          const ky = (vh2 * (TILT_PERSPECTIVE + z)) / (Hy * cy * TILT_PERSPECTIVE);
          k = Math.max(1, kx, ky);
        }
        k *= 1.02; // rounding safety
        if (k < 1.005) k = 1;
      }
      dotsCanvas.style.transform =
        reduceMotion || (!tilting && !active)
          ? ""
          : `perspective(${TILT_PERSPECTIVE}px) rotateX(${rotX}rad) rotateY(${rotY}rad)${k > 1 ? ` scale(${k})` : ""}`;

      // Canvas CONTENT only changes when the fade or the effect mouse
      // moved - the tilt is transform-only. Skip all raster work when
      // nothing moved (e.g. easing the tilt after the pointer stopped).
      const contentChanged =
        dotsDirty ||
        activeSm !== lastASm ||
        fmouse.x !== lastFx ||
        fmouse.y !== lastFy;

      if (contentChanged) {
        // Dynamic region: the influence footprint around the effect
        // mouse. Beyond 2.5 sigma the falloff is invisible (<2e-3 of a
        // 0.14-alpha dot), so everything outside stays the static blit.
        const sigma = SHRINK_RADIUS * 0.4;
        const inv2s2 = 1 / (sigma * sigma);
        const reach = sigma * 2.5 + DOT_SPACING * 2;
        const cur =
          activeSm > 0
            ? {
                x0: Math.max(0, fmouse.x - reach),
                y0: Math.max(0, fmouse.y - reach),
                x1: Math.min(dCssW, fmouse.x + reach),
                y1: Math.min(dCssH, fmouse.y + reach),
              }
            : null;

        if (dotsDirty) {
          dctx.clearRect(0, 0, dCssW, dCssH);
          dctx.drawImage(staticGrid, 0, 0, dCssW, dCssH);
        } else {
          // Restore the union of last frame's region and this one from
          // the static layer, then redraw just the current region.
          const d0x = Math.min(cur?.x0 ?? Infinity, prevRegion?.x0 ?? Infinity);
          const d0y = Math.min(cur?.y0 ?? Infinity, prevRegion?.y0 ?? Infinity);
          const d1x = Math.max(cur?.x1 ?? -Infinity, prevRegion?.x1 ?? -Infinity);
          const d1y = Math.max(cur?.y1 ?? -Infinity, prevRegion?.y1 ?? -Infinity);
          if (d1x > d0x && d1y > d0y) {
            dctx.clearRect(d0x, d0y, d1x - d0x, d1y - d0y);
            dctx.drawImage(
              staticGrid,
              d0x * dpr,
              d0y * dpr,
              (d1x - d0x) * dpr,
              (d1y - d0y) * dpr,
              d0x,
              d0y,
              d1x - d0x,
              d1y - d0y,
            );
          }
        }

        if (cur) {
          // Cell range covering the region. Its EDGE nodes sit at (or
          // beyond) 2.5 sigma, i.e. effectively at rest, so segments
          // meeting the untouched static grid line up seamlessly.
          const c0 = Math.max(0, Math.floor((cur.x0 - offX) / DOT_SPACING));
          const c1 = Math.min(cols - 1, Math.ceil((cur.x1 - offX) / DOT_SPACING));
          const r0 = Math.max(0, Math.floor((cur.y0 - offY) / DOT_SPACING));
          const r1 = Math.min(rows - 1, Math.ceil((cur.y1 - offY) / DOT_SPACING));

          dctx.save();
          dctx.beginPath();
          dctx.rect(cur.x0, cur.y0, cur.x1 - cur.x0, cur.y1 - cur.y0);
          dctx.clip();
          // Clear the static pixels inside the clip - the region is
          // redrawn from scratch so lines/dots are never double-painted.
          dctx.clearRect(cur.x0, cur.y0, cur.x1 - cur.x0, cur.y1 - cur.y0);

          // Pass 1: displaced node positions + falloff for the region.
          for (let cy = r0; cy <= r1; cy++) {
            const baseY = offY + cy * DOT_SPACING;
            for (let cx = c0; cx <= c1; cx++) {
              const i = cy * cols + cx;
              const baseX = offX + cx * DOT_SPACING;
              let x = baseX;
              let y = baseY;
              const ddx = baseX - fmouse.x;
              const ddy = baseY - fmouse.y;
              const kf = Math.exp(-(ddx * ddx + ddy * ddy) * inv2s2) * activeSm;
              x -= ddx * PULL * kf;
              y -= ddy * PULL * kf;
              nodeX[i] = x;
              nodeY[i] = y;
              nodeK[i] = kf;
            }
          }

          // Pass 2: the region's line mesh (segments reaching one cell
          // past the range use rest positions - continuity with static).
          dctx.strokeStyle = dotColor;
          dctx.globalAlpha = LINE_ALPHA;
          dctx.lineWidth = LINE_WIDTH;
          dctx.beginPath();
          for (let cy = r0; cy <= r1; cy++) {
            for (let cx = c0; cx <= c1; cx++) {
              const i = cy * cols + cx;
              if (cx + 1 < cols) {
                dctx.moveTo(nodeX[i], nodeY[i]);
                if (cx + 1 <= c1) dctx.lineTo(nodeX[i + 1], nodeY[i + 1]);
                else dctx.lineTo(offX + (cx + 1) * DOT_SPACING, offY + cy * DOT_SPACING);
              }
              if (cy + 1 < rows) {
                dctx.moveTo(nodeX[i], nodeY[i]);
                if (cy + 1 <= r1) dctx.lineTo(nodeX[i + cols], nodeY[i + cols]);
                else dctx.lineTo(offX + cx * DOT_SPACING, offY + (cy + 1) * DOT_SPACING);
              }
              // segments entering from the rest grid on the low sides
              if (cx === c0 && cx > 0) {
                dctx.moveTo(offX + (cx - 1) * DOT_SPACING, offY + cy * DOT_SPACING);
                dctx.lineTo(nodeX[i], nodeY[i]);
              }
              if (cy === r0 && cy > 0) {
                dctx.moveTo(offX + cx * DOT_SPACING, offY + (cy - 1) * DOT_SPACING);
                dctx.lineTo(nodeX[i], nodeY[i]);
              }
            }
          }
          dctx.stroke();
          dctx.globalAlpha = 1;

          // Pass 3: the region's dots, shrinking toward the pointer.
          dctx.fillStyle = dotColor;
          dctx.beginPath();
          for (let cy = r0; cy <= r1; cy++) {
            for (let cx = c0; cx <= c1; cx++) {
              const i = cy * cols + cx;
              const r =
                nodeK[i] > 0
                  ? Math.max(0.1, DOT_BASE_R * (1 - SHRINK * nodeK[i]))
                  : DOT_BASE_R;
              dctx.moveTo(nodeX[i] + r, nodeY[i]);
              dctx.arc(nodeX[i], nodeY[i], r, 0, Math.PI * 2);
            }
          }
          dctx.fill();
          dctx.restore();
        }

        prevRegion = cur;
        lastFx = fmouse.x;
        lastFy = fmouse.y;
        lastASm = activeSm;
      }

      // Converged on a stationary pointer → nothing will change until the
      // next pointermove; frame() skips drawDots while settled.
      dotsSettled =
        active &&
        activeSm === 1 &&
        fmouse.x === mx &&
        fmouse.y === my &&
        rotX === targetRotX &&
        rotY === targetRotY;
      dotsAnimating = !dotsSettled && (activeSm > 0 || tilting);
      dotsDirty = false;
    }

    // RAF loop: runs only while something is actually changing. The wave
    // animates continuously while visible, so the loop can only go fully
    // idle at the top of the page (wave sunk) with the dot grid settled -
    // which is exactly the landing page's initial state.
    let raf = 0;
    let rafActive = false;
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
      if (dotsDirty || dotsAnimating || (mouse.active && !dotsSettled)) {
        drawDots(time);
      }
      const dotsIdle = !dotsDirty && !dotsAnimating && (!mouse.active || dotsSettled);
      if (waveCleared && revealTarget <= 0.005 && dotsIdle) {
        rafActive = false; // fully idle - scroll/pointer events restart us
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    const ensureRaf = () => {
      if (!rafActive && !reduceMotion && !document.hidden) {
        rafActive = true;
        raf = requestAnimationFrame(frame);
      }
    };
    function drawStatic() {
      // Reduced motion: no easing loop - the reveal maps directly.
      reveal = revealTarget;
      drawWave(0);
      drawDots(0);
    }

    layout();
    readScrollTarget();
    if (reduceMotion) drawStatic();
    else ensureRaf();

    const ro = new ResizeObserver(() => {
      layout();
      if (reduceMotion) drawStatic();
      else ensureRaf();
    });
    ro.observe(waveCanvas);

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX - waveLeft;
      mouse.y = e.clientY - waveTop;
      mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      mouse.active = true;
      dotsSettled = false;
      ensureRaf();
    };
    const onLeave = () => {
      mouse.active = false;
      dotsSettled = false;
      dotsDirty = true; // one relax redraw
      ensureRaf();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        rafActive = false;
      } else {
        ensureRaf();
      }
    };

    const onScroll = () => {
      readScrollTarget();
      // Reduced motion has no RAF to ease/apply - map directly on scroll.
      if (reduceMotion) drawStatic();
      else ensureRaf();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
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
      {/* Dots - crisp, warped by the cursor. NO tilt overscan is baked
          in: the 3D tilt's coverage is solved per-frame in drawDots (a
          dynamic scale() keeps the projected plane over any viewport).
          The small fixed bleed only hides the shrink-pull gap - an edge
          dot is dragged at most ~16px toward the pointer (max of
          0.15*d*exp(-(d/240)^2)), so 32px is 2x that. Canvas is a
          REPLACED element: the h/w calc pair must match the inset. */}
      <canvas
        ref={dotsRef}
        aria-hidden
        className="pointer-events-none fixed -inset-8 -z-[1] h-[calc(100%+4rem)] w-[calc(100%+4rem)] will-change-transform"
      />
    </>
  );
}
