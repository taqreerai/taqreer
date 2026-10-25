// Teaser paywall "ghost" slide (2026-10-15). A locked slot of a free deck is
// WITHHELD (never generated), so there is no real slide to show. Instead of a
// blurred copy of a visible slide (recognisable as a duplicate), this draws an
// invented layout in the DECK's own colours - title + bullets, three cards, a
// big number, image + text, a bar chart, a quote - and blurs it, so each locked
// tile reads as different, real-looking content behind frosted glass.
//
// Pure client drawing: no model call, no credits, nothing leaks (there is no
// content). The blur is an SVG filter in viewBox units, so it scales with the
// tile: the same slide is equally unreadable as a 200px thumbnail and as the
// full canvas.

import { useId } from "react";

export const TEASER_GHOST_VARIANTS = 6;

// Palette shapes stay faint: at full strength, blurred, a gold or grey card
// washed the whole tile in a colour the deck's slides do not have, so locked
// slides looked fake (owner, 2026-10-25). The deck background must dominate.
const TINT = 0.28;

type Props = {
  // Layout to draw, 0..TEASER_GHOST_VARIANTS-1 (stable per locked slot).
  variant: number;
  // Root background of the deck's slides (any CSS colour / gradient).
  background: string;
  // Deck text colour (theme.text) - used when it contrasts with the background.
  text: string;
  palette: readonly string[];
  direction: "rtl" | "ltr";
  width: number;
  height: number;
};

// First colour in a CSS background value -> relative luminance (0..1), or null.
function luminance(css: string): number | null {
  let r: number, g: number, b: number;
  const hex = css.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const rgb = css.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (!rgb) return null;
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Ink for the drawn text lines: the deck's own text colour when it reads on
// the background, else a near-black / near-white (deck-agnostic fallback).
function inkFor(background: string, text: string): string {
  const bg = luminance(background);
  const tx = luminance(text);
  if (bg == null) return text;
  if (tx != null && Math.abs(bg - tx) > 0.3) return text;
  return bg > 0.45 ? "#111827" : "#F8FAFC";
}

export function TeaserGhostSlide({
  variant,
  background,
  text,
  palette,
  direction,
  width: W,
  height: H,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ink = inkFor(background, text);
  const pal = palette.length > 0 ? palette : [ink];
  const c = (i: number) => pal[i % pal.length];
  const portrait = H > W;
  const m = Math.min(W, H) * 0.08; // outer margin
  const iw = W - 2 * m; // inner width
  const lineH = Math.min(W, H) * 0.035;
  const r = Math.min(W, H) * 0.025; // card corner radius

  // A "text line": a rounded bar in the ink colour.
  const line = (x: number, y: number, w: number, o = 0.75, h = lineH) => (
    <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={ink} opacity={o} />
  );
  const title = (y: number, w = iw * 0.6) => (
    <>
      {line(m, y, w, 0.95, lineH * 2)}
      {line(m, y + lineH * 3, w * 0.55, 0.5)}
    </>
  );

  let body: React.ReactNode;
  switch (((variant % TEASER_GHOST_VARIANTS) + TEASER_GHOST_VARIANTS) % TEASER_GHOST_VARIANTS) {
    case 0: {
      // Title + bullets
      const top = m + lineH * 7;
      body = (
        <>
          {title(m)}
          {[0.82, 0.64, 0.74, 0.55].map((f, i) => (
            <g key={i}>
              <circle cx={m + lineH * 0.6} cy={top + i * lineH * 3.4 + lineH / 2} r={lineH * 0.6} fill={c(i)} opacity={TINT} />
              {line(m + lineH * 2.2, top + i * lineH * 3.4, iw * f * 0.85)}
            </g>
          ))}
        </>
      );
      break;
    }
    case 1: {
      // Three cards
      const top = m + lineH * 7;
      const n = portrait ? 2 : 3;
      const gap = m * 0.4;
      const cw = (iw - gap * (n - 1)) / n;
      const ch = H - top - m;
      body = (
        <>
          {title(m)}
          {Array.from({ length: n }, (_, i) => {
            const x = m + i * (cw + gap);
            return (
              <g key={i}>
                <rect x={x} y={top} width={cw} height={ch} rx={r} fill={c(i)} opacity={TINT} />
                <circle cx={x + cw * 0.22} cy={top + ch * 0.2} r={Math.min(cw, ch) * 0.1} fill={ink} opacity={0.35} />
                <rect x={x + cw * 0.12} y={top + ch * 0.45} width={cw * 0.76} height={lineH * 1.3} rx={lineH * 0.65} fill={ink} opacity={0.4} />
                <rect x={x + cw * 0.12} y={top + ch * 0.45 + lineH * 2.6} width={cw * 0.6} height={lineH} rx={lineH / 2} fill={ink} opacity={0.25} />
              </g>
            );
          })}
        </>
      );
      break;
    }
    case 2: {
      // Big number + caption
      const nw = portrait ? iw * 0.7 : iw * 0.42;
      const nh = portrait ? H * 0.22 : H * 0.42;
      const ny = portrait ? m + lineH * 6 : (H - nh) / 2;
      const tx = portrait ? m : m + nw + m;
      const ty = portrait ? ny + nh + m : H / 2 - lineH * 3;
      const tw = portrait ? iw : iw - nw - m;
      body = (
        <>
          {portrait ? title(m) : null}
          <rect x={m} y={ny} width={nw * 0.42} height={nh} rx={nh * 0.2} fill={c(0)} opacity={TINT} />
          <rect x={m + nw * 0.52} y={ny} width={nw * 0.42} height={nh} rx={nh * 0.2} fill={c(0)} opacity={TINT} />
          {line(tx, ty, tw * 0.9, 0.95, lineH * 1.6)}
          {line(tx, ty + lineH * 3, tw * 0.75)}
          {line(tx, ty + lineH * 5.2, tw * 0.6)}
        </>
      );
      break;
    }
    case 3: {
      // Image + text
      const imgW = portrait ? W : W * 0.46;
      const imgH = portrait ? H * 0.45 : H;
      const tx = portrait ? m : imgW + m;
      const ty = portrait ? imgH + m : H / 2 - lineH * 5;
      const tw = portrait ? iw : W - imgW - 2 * m;
      body = (
        <>
          <defs>
            <linearGradient id={`${uid}-img`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={c(1)} />
              <stop offset="1" stopColor={c(2)} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={imgW} height={imgH} fill={`url(#${uid}-img)`} opacity={TINT} />
          <circle cx={imgW * 0.62} cy={imgH * 0.4} r={Math.min(imgW, imgH) * 0.18} fill={c(0)} opacity={TINT} />
          {line(tx, ty, tw * 0.85, 0.95, lineH * 2)}
          {line(tx, ty + lineH * 3.6, tw * 0.95)}
          {line(tx, ty + lineH * 5.8, tw * 0.8)}
          {line(tx, ty + lineH * 8, tw * 0.65)}
        </>
      );
      break;
    }
    case 4: {
      // Bar chart
      const top = m + lineH * 7;
      const base = H - m;
      const heights = [0.45, 0.7, 0.55, 0.9, 0.75];
      const n = portrait ? 4 : 5;
      const gap = iw * 0.05;
      const bw = (iw - gap * (n - 1)) / n;
      body = (
        <>
          {title(m)}
          {heights.slice(0, n).map((f, i) => {
            const h = (base - top) * f;
            return <rect key={i} x={m + i * (bw + gap)} y={base - h} width={bw} height={h} rx={r * 0.6} fill={c(i)} opacity={TINT} />;
          })}
          <rect x={m} y={base} width={iw} height={lineH * 0.3} fill={ink} opacity={0.4} />
        </>
      );
      break;
    }
    default: {
      // Quote
      const cy = H / 2;
      const qr = Math.min(W, H) * 0.07;
      body = (
        <>
          <circle cx={m + qr} cy={cy - lineH * 6} r={qr} fill={c(0)} opacity={TINT} />
          <circle cx={m + qr * 3.4} cy={cy - lineH * 6} r={qr} fill={c(0)} opacity={TINT} />
          {line(m, cy, iw * 0.95, 0.95, lineH * 1.7)}
          {line(m, cy + lineH * 3, iw * 0.85, 0.95, lineH * 1.7)}
          {line(m, cy + lineH * 6, iw * 0.5, 0.95, lineH * 1.7)}
          <rect x={m} y={cy + lineH * 10} width={iw * 0.08} height={lineH * 0.5} fill={c(1)} opacity={TINT} />
          {line(m + iw * 0.11, cy + lineH * 9.75, iw * 0.25, 0.6)}
        </>
      );
    }
  }

  // σ ≈ 8% of the shorter side: lines melt away, cards and bars survive only
  // as soft coloured shapes. Grain + a light veil make it read as frosted glass.
  const blur = Math.min(W, H) * 0.08;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <filter id={`${uid}-blur`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={blur} />
          </filter>
          <filter id={`${uid}-grain`}>
            <feTurbulence type="fractalNoise" baseFrequency={0.9 * (1920 / W)} numOctaves={2} stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.6 0" />
          </filter>
        </defs>
        <g
          filter={`url(#${uid}-blur)`}
          transform={direction === "rtl" ? `translate(${W} 0) scale(-1 1)` : undefined}
        >
          {body}
        </g>
        <rect width={W} height={H} fill={ink} opacity={0.03} />
        <rect width={W} height={H} filter={`url(#${uid}-grain)`} opacity={0.05} />
      </svg>
    </div>
  );
}
