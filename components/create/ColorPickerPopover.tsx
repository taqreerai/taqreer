"use client";

// Custom color-picker popover used in place of the OS-native
// `<input type="color">` for the brand-colour swatches.
//
// Why custom: the OS picker (a) opens in a separate window that
// doesn't honour our glass chrome and (b) varies wildly between
// macOS / Windows / Linux. A custom popover gives us:
//   • Single visual vocabulary (matches the create flow's glass).
//   • Inline interaction — no context shift to a system dialog.
//   • Precise hex input + curated presets right next to the picker.
//
// Layout: a 2D saturation/value square + a 1D hue slider beneath +
// hex input + 12 curated presets. Open / close animates with a
// bouncy spring (referenced from the article the user linked).
//
// Positioning: the parent renders this inside a `position: relative`
// wrapper. The popover anchors with `position: absolute` + a
// horizontal mode prop ("center" | "start" | "end") so swatches in
// the first / middle / last grid columns can each pick a sensible
// alignment that keeps the 182 px popover on screen.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const PRESETS = [
  "#000000",
  "#FFFFFF",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#370BF4",
];

// ─── Colour-space helpers ─────────────────────────────────────────
// HSV is the right space for a 2D + 1D picker: hue maps to a single
// axis, the SV plane covers the rest. We round-trip via hex on the
// public API since that's what the rest of the app speaks.

function hexToRgb(hex: string) {
  const cleaned = hex.replace(/^#/, "").padStart(6, "0").slice(0, 6);
  const n = parseInt(cleaned, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToHsv(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = v - c;
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

// ─── Component ────────────────────────────────────────────────────

// Fixed popover width (px). Shared by the width style and the "center"
// margin-left offset so the two never drift apart.
const POPOVER_WIDTH = 182;

export type ColorPickerAlign = "center" | "start" | "end";

export function ColorPickerPopover({
  open,
  value,
  onChange,
  onClose,
  align = "center",
  flipUp = false,
  instantExit = false,
  surfaceClassName = "surface-card",
}: {
  open: boolean;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  // Open ABOVE the swatch instead of below (when the trigger sits low in the
  // viewport and a downward popover would clip).
  flipUp?: boolean;
  // Unmount instantly on close (no exit fade). Used by the in-canvas style pill
  // so the popover can't linger and relocate to the next element on a switch.
  instantExit?: boolean;
  // How the popover lines up horizontally vs its swatch:
  //   • "start"  — anchored to the swatch's start edge (extends end-ward)
  //   • "center" — centered on the swatch
  //   • "end"    — anchored to the swatch's end edge (extends start-ward)
  // Use to keep the popover on-screen when the swatch sits in a
  // grid column near the page edge.
  align?: ColorPickerAlign;
  // Glass surface recipe. Defaults to the white-tint `.surface-card` used on
  // the create/brand/mimic flows' light cards. The in-canvas style pill passes
  // `.surface-popover` (dark fill) so the picker matches the pill over a slide.
  surfaceClassName?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Local HSV — kept in component state so the picker stays smooth
  // even when the parent's hex prop round-trips through HSV (avoids
  // jitter from repeated hex→hsv conversion losing precision).
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexInput, setHexInput] = useState(value.toUpperCase());

  // Re-sync local state every time the picker opens. This catches
  // the case where the parent updates the color externally (e.g.
  // sessionStorage rehydration) and re-opens the picker.
  useEffect(() => {
    if (open) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "rehydrate internal state when external prop changes" shape for a popover that gets re-opened */
      setHsv(hexToHsv(value));
      setHexInput(value.toUpperCase());
    }
  }, [open, value]);

  // Outside-click + ESC close. mousedown (not click) so dismissing
  // also un-focuses the field instantly.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // ─── Drag handlers ──────────────────────────────────────────────
  // Pointer events (not touch + mouse separately) so a single
  // handler covers mouse + trackpad + touchscreen.

  // We track HSV in a ref alongside React state so the drag handlers
  // can read the freshest hue (or s/v) without going through the
  // updater function. Side effects (onChange to parent, setHexInput)
  // MUST live outside `setHsv`'s updater — React 19 flags setState
  // calls inside an updater because the updater is supposed to be
  // pure and may run twice in StrictMode.
  const hsvRef = useRef(hsv);
  useEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);

  // Stash the currently-active drag's `pointerup` handler so we can
  // run it on unmount / popover-close. Without this, closing the
  // popover (or unmounting the parent) MID-DRAG leaves the
  // `pointermove` / `pointerup` listeners attached to `window` —
  // they keep firing against a dead React tree until the page
  // reloads. The handler removes BOTH listeners and itself.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const dragSv = (event: React.PointerEvent) => {
    event.preventDefault();
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    // If a previous drag is somehow still active (shouldn't happen
    // for the same gesture, but defensive), tear it down before
    // starting the next.
    dragCleanupRef.current?.();
    const apply = (clientX: number, clientY: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const s = x / rect.width;
      const v = 1 - y / rect.height;
      const h = hsvRef.current.h;
      const next = { h, s, v };
      const hex = hsvToHex(h, s, v);
      hsvRef.current = next;
      setHsv(next);
      setHexInput(hex);
      onChange(hex);
    };
    apply(event.clientX, event.clientY);
    const onMove = (moveEvent: PointerEvent) =>
      apply(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanupRef.current = onUp;
  };

  const dragHue = (event: React.PointerEvent) => {
    event.preventDefault();
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragCleanupRef.current?.();
    const apply = (clientX: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const h = (x / rect.width) * 360;
      const { s, v } = hsvRef.current;
      const next = { h, s, v };
      const hex = hsvToHex(h, s, v);
      hsvRef.current = next;
      setHsv(next);
      setHexInput(hex);
      onChange(hex);
    };
    apply(event.clientX);
    const onMove = (moveEvent: PointerEvent) => apply(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanupRef.current = onUp;
  };

  const onHexChange = (next: string) => {
    setHexInput(next);
    const normalised = next.trim();
    if (/^#?[0-9a-f]{6}$/i.test(normalised)) {
      const hex =
        (normalised.startsWith("#") ? normalised : `#${normalised}`).toUpperCase();
      setHsv(hexToHsv(hex));
      onChange(hex);
    }
  };

  const applyPreset = (preset: string) => {
    setHsv(hexToHsv(preset));
    setHexInput(preset.toUpperCase());
    onChange(preset);
  };

  // Positioning offsets for the anchor wrapper. "center" uses a negative
  // `margin-left` of half the fixed width rather than `translateX(-50%)`: a
  // transform here would make the anchor a backdrop root and kill the glass
  // surface's blur (the same trap that bit the Bell + History popovers). Pure
  // layout, no transform — blur intact.
  const positionStyle: React.CSSProperties = (() => {
    if (align === "start") return { left: 0 };
    if (align === "end") return { right: 0 };
    return { left: "50%", marginLeft: -POPOVER_WIDTH / 2 };
  })();

  return (
    <AnimatePresence>
      {open ? (
        // One element = glass surface + open animation. Animate scale + y only,
        // never opacity: opacity < 1 suppresses backdrop-filter mid-fade, so the
        // blur would pop in late. An element's own transform does NOT suppress its
        // own blur — but the picker must not be nested inside another
        // backdrop-filter element (the style pill keeps its blur on a sibling
        // layer for this). `surfaceClassName` is the glass recipe (default
        // `.surface-card`; the style pill passes `.surface-popover`); `mt-3.5` gaps it
        // below the trigger. Width 182 px; inner dims scale with it.
        <motion.div
          ref={wrapperRef}
          dir="ltr"
          className={`${surfaceClassName} absolute z-30 rounded-xl p-2.5 ${
            flipUp ? "bottom-full mb-3.5" : "top-full mt-3.5"
          }`}
          style={{ ...positionStyle, width: POPOVER_WIDTH }}
          initial={{ scale: 0.96, y: flipUp ? 4 : -4 }}
          animate={{ scale: 1, y: 0 }}
          // `instantExit` (the in-canvas style pill) skips the exit fade: the
          // popover is a child of the pill, so a lingering exit would relocate to
          // the next element and flash on element switch.
          exit={instantExit ? undefined : { scale: 0.96, y: flipUp ? 4 : -4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* SV plane */}
          <div
            ref={svRef}
            onPointerDown={dragSv}
            className="relative h-[94px] w-full cursor-crosshair touch-none overflow-hidden rounded-md"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
            }}
          >
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-md"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: hsvToHex(hsv.h, hsv.s, hsv.v),
              }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueRef}
            onPointerDown={dragHue}
            className="relative mt-2.5 h-2.5 w-full cursor-pointer touch-none rounded-full"
            style={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white shadow-md"
              style={{
                left: `${(hsv.h / 360) * 100}%`,
                background: `hsl(${hsv.h}, 100%, 50%)`,
              }}
            />
          </div>

          {/* Hex input + live swatch */}
          <div className="mt-2.5 flex items-center gap-2">
            <span
              className="h-6 w-6 shrink-0 rounded border border-white/15"
              style={{ background: hsvToHex(hsv.h, hsv.s, hsv.v) }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(event) => onHexChange(event.target.value)}
              spellCheck={false}
              maxLength={7}
              aria-label="رمز اللون (HEX)"
              placeholder="#RRGGBB"
              className="input-dark min-w-0 flex-1 font-mono text-[13px]"
              style={{ padding: "4px 8px", height: 26 }}
            />
          </div>

          {/* Presets */}
          <div className="mt-2.5 grid grid-cols-6 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-label={preset}
                title={preset}
                className="h-5 w-5 rounded border border-white/15 transition-transform hover:scale-110"
                style={{ background: preset }}
              />
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
