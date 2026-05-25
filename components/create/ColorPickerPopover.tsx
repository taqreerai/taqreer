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
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "rehydrate internal state when external prop changes" shape for a popover that gets re-opened */
      setHsv(hexToHsv(value));
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
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
          // Shrunk ~50 % from 240 → 140 px wide per user direction
          // (2026-05-26). All inner dimensions scaled to match: SV
          // plane 128 → 72 px tall, hue slider h-3 → h-2, swatch
          // h-7 → h-5, preset tiles h-6 → h-4. Picker is still
          // usable but a fraction of the footprint.
          className="absolute top-full z-30 mt-2"
          style={{ ...positionStyle, width: 140 }}
        >
        {/* Glass surface — `.glass-card` is the canonical white-tint
            recipe (background = rgba(255,255,255,var(--glass-opacity)),
            border = var(--tq-border-glass), backdrop-filter wired
            to the user's preset). Replaces an inline rgba pair that
            duplicated the class — same visual, design-system
            compliant. `backdrop-blur-glass` + the saturate utility
            stay on the element so the Tailwind layer wins
            composition over .glass-card's raw backdrop-filter
            (memory: feedback_tw_glass_system). */}
        <motion.div
          ref={wrapperRef}
          initial={{ opacity: 0, scale: 0.9, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 6 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.3 }}
          dir="ltr"
          className="glass-card backdrop-blur-glass backdrop-saturate-(--glass-saturation) rounded-xl p-2 shadow-2xl"
        >
          {/* SV plane */}
          <div
            ref={svRef}
            onPointerDown={dragSv}
            className="relative h-[72px] w-full cursor-crosshair touch-none overflow-hidden rounded-md"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
            }}
          >
            <div
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-md"
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
            className="relative mt-2 h-2 w-full cursor-pointer touch-none rounded-full"
            style={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white shadow-md"
              style={{
                left: `${(hsv.h / 360) * 100}%`,
                background: `hsl(${hsv.h}, 100%, 50%)`,
              }}
            />
          </div>

          {/* Hex input + live swatch */}
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="h-5 w-5 shrink-0 rounded border border-white/15"
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
              className="input-dark min-w-0 flex-1 font-mono text-[10px]"
              style={{ padding: "3px 6px", height: 20 }}
            />
          </div>

          {/* Presets */}
          <div className="mt-2 grid grid-cols-6 gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-label={preset}
                title={preset}
                className="h-4 w-4 rounded border border-white/15 transition-transform hover:scale-110"
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
