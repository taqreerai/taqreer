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
const GLOBE_SIZE = 420;
const R = GLOBE_SIZE / 2;
const DEG = Math.PI / 180;
const THETA = 0.1;
const AUTO_SPEED = 0.0025;
const OUR_BLUE: [number, number, number] = [0.2, 0.5, 1]; // #3380FF

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
function project(lat: number, lng: number, phi: number, theta: number) {
  const lm = lat * DEG;
  const pm = (3 * Math.PI) / 2 - lng * DEG; // cobe locationToAngles phi
  const dphi = phi - pm;
  const x = Math.cos(lm) * Math.sin(dphi);
  const y0 = Math.sin(lm);
  const z0 = Math.cos(lm) * Math.cos(dphi);
  const y = y0 * Math.cos(theta) - z0 * Math.sin(theta);
  const z = y0 * Math.sin(theta) + z0 * Math.cos(theta);
  return { x: R + R * x, y: R - R * y, z, visible: z > 0.08 };
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

export function LiveGlobePanel({
  visitors,
  onlineNow,
}: {
  visitors: CountryVisitors[];
  onlineNow: number;
}) {
  const isLight = useIsLight();
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const onResize = () => {
      width = canvas.offsetWidth;
    };
    window.addEventListener("resize", onResize);

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
      window.removeEventListener("resize", onResize);
    };
  }, [markers, isLight]);

  // List row hover: rotate + tilt so the country is centered, then tooltip.
  const focusCountry = (v: CountryVisitors) => {
    const raw = Math.PI - (v.lng * DEG - Math.PI / 2);
    const k = Math.round((phiRef.current - raw) / (2 * Math.PI));
    const ft = clamp(v.lat * DEG, -0.35, 0.72);
    focusRef.current = { phi: raw + k * 2 * Math.PI, theta: ft };
    hitRef.current = null;
    const cy = R - (v.lat * DEG - ft) * R; // centered marker screen Y
    setTip({ name: v.name, count: v.count, x: R, y: cy - 38 });
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
      const p = project(v.lat, v.lng, phiRef.current, thetaRef.current);
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
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold" style={{ color: PRIMARY }}>
          {formatCount(onlineNow)}
        </span>
        <span className="text-sm" style={{ color: MUTED }}>
          users online now
        </span>
      </div>

      <div className="flex flex-col items-center gap-6 lg:flex-row">
        {/* Globe */}
        <div
          className="relative"
          style={{ width: GLOBE_SIZE, height: GLOBE_SIZE, flexShrink: 0 }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              pointerRef.current = e.clientX;
              stoppedRef.current = true;
              focusRef.current = null;
              pausedRef.current = false;
              hitRef.current = null;
              setTip(null);
              if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
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
              width: GLOBE_SIZE,
              height: GLOBE_SIZE,
              cursor: "grab",
              contain: "layout paint size",
            }}
          />
          {tip ? (
            <div
              className="surface-menu pointer-events-none absolute z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5"
              style={{ left: tip.x, top: tip.y }}
            >
              <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
                {tip.name}
              </span>
              <span className="text-sm" style={{ color: MUTED }}>
                {formatCount(tip.count)}
              </span>
            </div>
          ) : null}
        </div>

        {/* Ranked list - hovering a row rotates the globe to that country. */}
        <div className="flex w-full flex-col gap-1">
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 text-sm" style={{ color: MUTED }}>
              No visitor data yet.
            </p>
          ) : null}
          {sorted.map((v) => (
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
