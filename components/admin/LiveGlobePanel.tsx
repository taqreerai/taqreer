"use client";

// Live-online panel - replicates Cloudflare's "Requests by Country" widget: a
// COBE dot-matrix globe (the same ~5KB WebGL library Cloudflare uses, by Shu
// Ding) with each traffic country a marker whose color trends toward our brand
// blue (#3380FF) with more traffic. Follows the app theme (dark/light). Resting
// 0.10 tilt; slow idle spin that freezes while the cursor is over the globe.
// Markers fade in/out as they rotate. Hovering a country dot shows its tooltip;
// hovering a list row rotates the globe to center that country.
// Loaded ssr:false (WebGL is client-only).

import { useEffect, useMemo, useRef, useState } from "react";
import createGlobe from "cobe";
import { formatCount, type CountryVisitors } from "@/lib/admin/mock";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";
// Desktop / maximum globe size. On narrow screens the box shrinks to its
// container (see `size`/`sizeRef` below) and the canvas + projection math track
// the live pixel size, so hit-testing and tooltips stay aligned.
const GLOBE_SIZE = 420;
const R = GLOBE_SIZE / 2;
const DEG = Math.PI / 180;
const THETA = 0.1;
const AUTO_SPEED = 0.0025;
const OUR_BLUE: [number, number, number] = [0.2, 0.5, 1]; // #3380FF
// Cap the ranked list so the panel height tracks the Recent-activity card
// (the globe still plots every country as a marker; only the list is capped).
const MAX_COUNTRY_ROWS = 12;

const SHORT_NAME: Record<string, string> = {
  "United States of America": "United States",
  "United Arab Emirates": "UAE",
};

type RGB = [number, number, number];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Screen position (within the GLOBE_SIZE box) of a lat/lng given the globe's
// current phi/theta. `visible` = the point faces the camera; `z` = how much.
function project(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
  r: number = R,
) {
  const lm = lat * DEG;
  const pm = (3 * Math.PI) / 2 - lng * DEG; // cobe locationToAngles phi
  const dphi = phi - pm;
  const x = Math.cos(lm) * Math.sin(dphi);
  const y0 = Math.sin(lm);
  const z0 = Math.cos(lm) * Math.cos(dphi);
  const y = y0 * Math.cos(theta) - z0 * Math.sin(theta);
  const z = y0 * Math.sin(theta) + z0 * Math.cos(theta);
  return { x: r + r * x, y: r - r * y, z, visible: z > 0.08 };
}

type Tip = { name: string; count: number; x: number; y: number };

// Follow the app theme (the `.light` class the ThemeToggle puts on <html>).
function useIsLight() {
  const [light, setLight] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setLight(el.classList.contains("light")),
    );
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

// Render the interactive WebGL globe only on wide screens (lg+). On phones and
// tablets the canvas is never mounted, so its per-frame repaint (which flickers
// content below it on iOS Safari) and its battery cost are gone; the stat strip
// + ranked country list carry the data there. This component is loaded ssr:false
// so reading matchMedia in the initializer is safe (no hydration mismatch).
function useIsWide() {
  const [wide, setWide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function LiveGlobePanel({
  visitors,
  onlineNow,
  uniqueVisitors,
  pageviews,
}: {
  visitors: CountryVisitors[];
  onlineNow: number;
  uniqueVisitors: number;
  pageviews: number;
}) {
  const isLight = useIsLight();
  const isWide = useIsWide();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live pixel size of the (square) globe box; the box is CSS-responsive and a
  // ResizeObserver keeps this in sync so projection / hit-testing use real px.
  const sizeRef = useRef(GLOBE_SIZE);
  const phiRef = useRef(4.4);
  const thetaRef = useRef(THETA);
  const pointerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const pausedRef = useRef(false); // frozen while the cursor is over the globe
  const focusRef = useRef<{ phi: number; theta: number } | null>(null);
  const hitRef = useRef<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const sorted = useMemo(
    () => [...visitors].sort((a, b) => b.count - a.count),
    [visitors],
  );
  const max = sorted[0]?.count ?? 1;

  // One marker per country; its color trends from a soft blue toward our brand
  // blue (#3380FF) as traffic rises.
  const markers = useMemo(
    () =>
      visitors.map((v) => {
        const t = Math.sqrt(v.count / max);
        return {
          location: [v.lat, v.lng] as [number, number],
          size: 0.03 + t * 0.03,
          color: [
            lerp(0.36, OUR_BLUE[0], t),
            lerp(0.52, OUR_BLUE[1], t),
            lerp(0.78, OUR_BLUE[2], t),
          ] as RGB,
        };
      }),
    [visitors, max],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let width = canvas.offsetWidth;
    sizeRef.current = width;
    // Track the canvas' rendered CSS width (it fills the responsive box), so the
    // globe re-renders at the right resolution and projection uses live px.
    const ro = new ResizeObserver(() => {
      width = canvas.offsetWidth;
      sizeRef.current = width;
    });
    ro.observe(canvas);

    // cobe shades the land dots dark and the ocean light from one baseColor, so
    // a near-white base gives dark continents on a white sphere; a neutral-gray
    // base gives a grayscale sphere on dark. Both spheres are tint-free: only
    // the per-country markers carry our blue.
    const base: RGB = isLight ? [0.92, 0.92, 0.92] : [0.26, 0.26, 0.26];

    let raf = 0;
    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 4.4,
      theta: THETA,
      dark: isLight ? 0 : 0.67,
      diffuse: isLight ? 1.4 : 1.2,
      mapSamples: 26000,
      // dark: muted continents (mapBrightness) over a dim ocean
      // (mapBaseBrightness) kept darker than the card so the globe recedes into
      // the surface, Cloudflare-style.
      mapBrightness: isLight ? 6 : 4,
      mapBaseBrightness: isLight ? 0 : 0.05,
      baseColor: base,
      markerColor: OUR_BLUE,
      glowColor: isLight ? [1, 1, 1] : [0.08, 0.08, 0.08],
      markers,
    });

    const tick = () => {
      const focus = focusRef.current;
      if (focus) {
        phiRef.current += (focus.phi - phiRef.current) * 0.08;
        thetaRef.current += (focus.theta - thetaRef.current) * 0.08;
      } else {
        thetaRef.current += (THETA - thetaRef.current) * 0.08;
        if (
          !stoppedRef.current &&
          !pausedRef.current &&
          pointerRef.current === null
        ) {
          phiRef.current += AUTO_SPEED;
        }
      }
      // Fade each marker in/out as it rotates: shrink the size to 0 and dim the
      // color toward the sphere base near the limb (f = facing fraction, 0 at
      // the limb / back, 1 facing the camera). Size alone guarantees it vanishes
      // regardless of how bright the base is, so no dots float at the edge.
      const faded = markers.map((m) => {
        const f = clamp(
          project(m.location[0], m.location[1], phiRef.current, thetaRef.current)
            .z / 0.25,
          0,
          1,
        );
        return {
          location: m.location,
          size: m.size * f,
          color: [
            lerp(base[0], m.color[0], f),
            lerp(base[1], m.color[1], f),
            lerp(base[2], m.color[2], f),
          ] as RGB,
        };
      });
      globe.update({
        phi: phiRef.current,
        theta: thetaRef.current,
        width: width * 2,
        height: width * 2,
        markers: faded,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      globe.destroy();
      ro.disconnect();
    };
    // isWide gates whether the canvas is mounted at all; re-run so the globe is
    // created when crossing into lg+ and torn down when leaving it.
  }, [markers, isLight, isWide]);

  // List row hover: rotate + tilt so the country is centered, then tooltip.
  const focusCountry = (v: CountryVisitors) => {
    const raw = Math.PI - (v.lng * DEG - Math.PI / 2);
    const k = Math.round((phiRef.current - raw) / (2 * Math.PI));
    const ft = clamp(v.lat * DEG, -0.35, 0.72);
    focusRef.current = { phi: raw + k * 2 * Math.PI, theta: ft };
    hitRef.current = null;
    const r = sizeRef.current / 2;
    const cy = r - (v.lat * DEG - ft) * r; // centered marker screen Y
    setTip({ name: v.name, count: v.count, x: r, y: cy - 38 });
  };
  const unfocus = () => {
    focusRef.current = null;
    setTip(null);
  };

  const onCanvasMove = (e: React.PointerEvent) => {
    // Dragging.
    if (pointerRef.current !== null) {
      const d = e.clientX - pointerRef.current;
      pointerRef.current = e.clientX;
      phiRef.current += d * 0.005;
      return;
    }
    // Freeze the idle spin whenever the cursor is over the globe, so the dots
    // stay still and are easy to hover (no chasing).
    pausedRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit: { v: CountryVisitors; x: number; y: number } | null = null;
    let best = 16;
    for (const v of visitors) {
      const p = project(
        v.lat,
        v.lng,
        phiRef.current,
        thetaRef.current,
        sizeRef.current / 2,
      );
      if (!p.visible) continue;
      const dd = Math.hypot(p.x - mx, p.y - my);
      if (dd < best) {
        best = dd;
        hit = { v, x: p.x, y: p.y };
      }
    }
    if (hit) {
      if (hitRef.current !== hit.v.code) {
        hitRef.current = hit.v.code;
        setTip({ name: hit.v.name, count: hit.v.count, x: hit.x, y: hit.y - 30 });
      }
    } else if (hitRef.current !== null) {
      hitRef.current = null;
      if (!focusRef.current) setTip(null);
    }
  };

  const release = () => {
    pointerRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Stat strip: live presence + cumulative 30d totals, divider-separated.
          Wraps to a 3-column grid on mobile so the values never clip. */}
      <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-5">
        {[
          { label: "Users online", value: onlineNow },
          { label: "Unique visitors", value: uniqueVisitors },
          { label: "Pageviews", value: pageviews },
        ].map((s, i) => (
          <div key={s.label} className="flex items-center gap-5">
            {i > 0 ? (
              <span
                className="hidden h-8 w-px sm:block"
                style={{ background: "var(--tq-border-hairline)" }}
              />
            ) : null}
            <div className="flex flex-col gap-1">
              <span
                className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: MUTED }}
              >
                {s.label}
              </span>
              <span className="text-2xl font-bold" style={{ color: PRIMARY }}>
                {formatCount(s.value)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-6 lg:flex-row">
        {/* Globe - square box, wide screens only. Gated on isWide so the canvas
            is never mounted on phones/tablets (no per-frame repaint flicker, no
            battery drain); the ranked list carries the data there. */}
        {isWide ? (
          <div className="relative aspect-square w-full max-w-[420px] shrink-0 lg:w-[420px]">
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              onPointerDown={(e) => {
                pointerRef.current = e.clientX;
                stoppedRef.current = true;
                focusRef.current = null;
                pausedRef.current = false;
                hitRef.current = null;
                setTip(null);
                if (canvasRef.current)
                  canvasRef.current.style.cursor = "grabbing";
              }}
              onPointerEnter={() => {
                pausedRef.current = true;
              }}
              onPointerMove={onCanvasMove}
              onPointerUp={release}
              onPointerLeave={() => {
                release();
                pausedRef.current = false;
                hitRef.current = null;
                if (!focusRef.current) setTip(null);
              }}
              style={{
                cursor: "grab",
                contain: "layout paint",
              }}
            />
            {tip ? (
              <div
                className="surface-menu pointer-events-none absolute z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5"
                style={{ left: tip.x, top: tip.y }}
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: PRIMARY }}
                >
                  {tip.name}
                </span>
                <span className="text-sm" style={{ color: MUTED }}>
                  {formatCount(tip.count)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Ranked list - hovering a row rotates the globe to that country. */}
        <div className="flex w-full flex-col gap-1">
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 text-sm" style={{ color: MUTED }}>
              No visitor data yet.
            </p>
          ) : null}
          {sorted.slice(0, MAX_COUNTRY_ROWS).map((v) => (
            <div
              key={v.code}
              onMouseEnter={() => focusCountry(v)}
              onMouseLeave={unfocus}
              className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5"
              onMouseOver={(e) => {
                e.currentTarget.style.background = "var(--tq-overlay-soft)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                className="w-24 flex-shrink-0 truncate text-sm"
                style={{ color: PRIMARY }}
                title={v.name}
              >
                {SHORT_NAME[v.name] ?? v.name}
              </span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--tq-overlay-soft)" }}
              >
                <div
                  style={{
                    width: `${Math.max(3, (v.count / max) * 100)}%`,
                    height: "100%",
                    background: ACCENT,
                  }}
                />
              </div>
              <span
                className="w-11 flex-shrink-0 text-end text-sm tabular-nums"
                style={{ color: MUTED }}
              >
                {formatCount(v.count)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
