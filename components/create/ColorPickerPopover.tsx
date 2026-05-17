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
// alignment that keeps the 240 px popover on screen.

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

export type ColorPickerAlign = "center" | "start" | "end";

export function ColorPickerPopover({
  open,
  value,
  onChange,
  onClose,
  align = "center",
}: {
  open: boolean;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  // How the popover lines up horizontally vs its swatch:
  //   • "start"  — anchored to the swatch's start edge (extends end-ward)
  //   • "center" — centered on the swatch
  //   • "end"    — anchored to the swatch's end edge (extends start-ward)
  // Use to keep the popover on-screen when the swatch sits in a
  // grid column near the page edge.
  align?: ColorPickerAlign;
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

  const dragSv = (event: React.PointerEvent) => {
    event.preventDefault();
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const apply = (clientX: number, clientY: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const s = x / rect.width;
      const v = 1 - y / rect.height;
      setHsv((prev) => {
        const next = { ...prev, s, v };
        const hex = hsvToHex(next.h, s, v);
        setHexInput(hex);
        onChange(hex);
        return next;
      });
    };
    apply(event.clientX, event.clientY);
    const onMove = (moveEvent: PointerEvent) =>
      apply(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const dragHue = (event: React.PointerEvent) => {
    event.preventDefault();
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    const apply = (clientX: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const h = (x / rect.width) * 360;
      setHsv((prev) => {
        const next = { ...prev, h };
        const hex = hsvToHex(h, next.s, next.v);
        setHexInput(hex);
        onChange(hex);
        return next;
      });
    };
    apply(event.clientX);
    const onMove = (moveEvent: PointerEvent) => apply(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

  // Anchor wrapper handles positioning; the motion.div inside owns
  // animation transforms. Framer Motion's `scale` / `y` apply via
  // CSS `transform`, which would clobber `translateX(-50%)` if both
  // lived on the same element — split into two wrappers to keep
  // the centering math out of Framer's hands.
  const positionStyle: React.CSSProperties = (() => {
    if (align === "start") return { left: 0 };
    if (align === "end") return { right: 0 };
    return { left: "50%", transform: "translateX(-50%)" };
  })();

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="absolute top-full z-30 mt-2"
          style={{ ...positionStyle, width: 240 }}
        >
        {/* Solid-ish backdrop tint (not just glass-opacity) so the
            SV gradient stays readable over busy backgrounds. Border
            still uses the user's glass-border preset for cohesion. */}
        <motion.div
          ref={wrapperRef}
          initial={{ opacity: 0, scale: 0.9, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -6 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.3 }}
          dir="ltr"
          className="backdrop-blur-glass rounded-2xl border p-3 shadow-2xl"
          style={{
            background: "rgba(15, 11, 30, 0.92)",
            borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          }}
        >
          {/* SV plane — saturation on X, value on Y. The base layer
              is a solid pure-hue colour; a left-to-right white
              gradient gives the saturation axis, a top-to-bottom
              black gradient gives the value axis. */}
          <div
            ref={svRef}
            onPointerDown={dragSv}
            className="relative h-32 w-full cursor-crosshair touch-none overflow-hidden rounded-lg"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
            }}
          >
            <div
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: hsvToHex(hsv.h, hsv.s, hsv.v),
              }}
            />
          </div>

          {/* Hue slider — rainbow gradient with a draggable thumb. */}
          <div
            ref={hueRef}
            onPointerDown={dragHue}
            className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full"
            style={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-md"
              style={{
                left: `${(hsv.h / 360) * 100}%`,
                background: `hsl(${hsv.h}, 100%, 50%)`,
              }}
            />
          </div>

          {/* Hex input + live swatch */}
          <div className="mt-3 flex items-center gap-2">
            <span
              className="h-7 w-7 shrink-0 rounded-md border border-white/15"
              style={{ background: hsvToHex(hsv.h, hsv.s, hsv.v) }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(event) => onHexChange(event.target.value)}
              spellCheck={false}
              maxLength={7}
              className="input-dark min-w-0 flex-1 font-mono text-xs"
              style={{ padding: "6px 10px" }}
            />
          </div>

          {/* Curated presets — common brand-friendly tones. Clicking
              a preset writes the value directly (no save button —
              the picker is live, every interaction commits). */}
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-label={preset}
                title={preset}
                className="h-6 w-6 rounded-md border border-white/15 transition-transform hover:scale-110"
                style={{ background: preset }}
              />
            ))}
          </div>
        </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
