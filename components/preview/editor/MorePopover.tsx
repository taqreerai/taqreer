"use client";

// I2 — the "⋯ more" inspector popover. Opens below the ⋯ button on the StylePill
// and surfaces the property-panel controls we deliberately kept OFF the inline
// pill (the pill carries only the quick ones: size / bold / italic / colour /
// align). Every row writes a single export-safe CSS prop on the selected leaf via
// the pill's `setStyle`, so a run of tweaks commits as ONE SlideVersion.
//
// Surface: same recipe as ColorPickerPopover — a glass `motion.div` that animates
// scale + y ONLY (never opacity, which would suppress backdrop-filter mid-fade)
// and lives as a sibling of the pill's blur layer, so it blurs the slide directly
// rather than the pill's flat interior. (memory: reference_backdrop_filter_traps)

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Kind = "text" | "image" | "svg";

const WIDTH = 232;

const WEIGHTS: { value: string; label: string }[] = [
  { value: "100", label: "Thin" },
  { value: "200", label: "Extra Light" },
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi Bold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra Bold" },
  { value: "900", label: "Black" },
];

const TRANSFORMS: { value: string; label: string }[] = [
  { value: "none", label: "—" },
  { value: "uppercase", label: "AA" },
  { value: "lowercase", label: "aa" },
  { value: "capitalize", label: "Aa" },
];

const DECORATIONS: { value: string; label: string }[] = [
  { value: "none", label: "—" },
  { value: "underline", label: "U" },
  { value: "line-through", label: "S" },
];

export function MorePopover({
  open,
  target,
  kind,
  flipUp = false,
  setStyle,
  onClose,
}: {
  open: boolean;
  target: HTMLElement;
  kind: Kind;
  // When the pill sits low in the viewport, open the menu UPWARD (above the
  // pill) instead of down, so it never runs off the bottom edge.
  flipUp?: boolean;
  setStyle: (prop: string, value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc. mousedown (not click) so it dismisses before
  // the pill's own outside-mousedown handler runs.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Live values read off computed style every render (the pill re-renders this on
  // each setStyle, so the controls always reflect the element's real state).
  const cs = getComputedStyle(target);
  const fontPx = parseFloat(cs.fontSize) || 16;
  const weight = String(Math.round((parseInt(cs.fontWeight, 10) || 400) / 100) * 100);
  // line-height → unitless multiplier (CSS-idiomatic + survives font-size changes).
  const lhPx = parseFloat(cs.lineHeight);
  const lineMul = Number.isFinite(lhPx) ? lhPx / fontPx : 1.2;
  const opacityPct = Math.round((parseFloat(cs.opacity) || 1) * 100);
  const transform = cs.textTransform || "none";
  const decoration = decorationOf(cs.textDecorationLine || cs.textDecoration);
  const radiusPx = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          dir="ltr"
          className={`glass-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation) absolute z-30 rounded-2xl px-3.5 py-3.5 shadow-2xl ${
            flipUp ? "bottom-full mb-3.5" : "top-full mt-3.5"
          }`}
          style={{ right: 0, width: WIDTH }}
          initial={{ scale: 0.96, y: flipUp ? 4 : -4 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: flipUp ? 4 : -4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          {kind === "text" ? (
            <>
              <Row label="Weight">
                <Select
                  value={weight}
                  options={WEIGHTS}
                  onChange={(v) => setStyle("font-weight", v)}
                />
              </Row>
              <Row label="Line">
                <Slider
                  value={lineMul}
                  min={0.8}
                  max={3}
                  step={0.05}
                  digits={2}
                  onChange={(n) => setStyle("line-height", String(n))}
                />
              </Row>
              <Row label="Transform">
                <Seg
                  value={transform}
                  options={TRANSFORMS}
                  onChange={(v) => setStyle("text-transform", v)}
                />
              </Row>
              <Row label="Decoration">
                <Seg
                  value={decoration}
                  options={DECORATIONS}
                  onChange={(v) => setStyle("text-decoration", v)}
                />
              </Row>
              <Row label="Opacity">
                <Slider
                  value={opacityPct}
                  min={0}
                  max={100}
                  step={1}
                  digits={0}
                  unit="%"
                  onChange={(n) => setStyle("opacity", String(n / 100))}
                />
              </Row>
            </>
          ) : (
            <>
              <Row label="Opacity">
                <Slider
                  value={opacityPct}
                  min={0}
                  max={100}
                  step={1}
                  digits={0}
                  unit="%"
                  onChange={(n) => setStyle("opacity", String(n / 100))}
                />
              </Row>
              <Row label="Rounding">
                <Slider
                  value={radiusPx}
                  min={0}
                  max={120}
                  step={1}
                  digits={0}
                  unit="px"
                  onChange={(n) => setStyle("border-radius", `${n}px`)}
                />
              </Row>
            </>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// `text-decoration-line` can come back as a multi-keyword string ("underline
// line-through"); collapse to the single value our 3-way control understands.
function decorationOf(raw: string): string {
  if (/line-through/.test(raw)) return "line-through";
  if (/underline/.test(raw)) return "underline";
  return "none";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="w-[64px] shrink-0 text-[12px] text-white/55">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

// Slider = a range input + a compact read-only value, matching the reference
// inspector. accent-color themes the native thumb/track cross-browser.
function Slider({
  value,
  min,
  max,
  step,
  digits,
  unit = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  digits: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <>
      <span className="w-[40px] shrink-0 text-right text-[12px] tabular-nums text-white">
        {value.toFixed(digits)}
        {unit}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer"
        style={{ accentColor: "var(--tq-violet)" }}
      />
    </>
  );
}

// Compact dark native select (only used for the 9-option weight list). Styled
// closed-state; the open list is OS-native, fine for one control.
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full cursor-pointer appearance-none rounded-md border px-2 py-1.5 text-[12px] text-white outline-none"
      style={{
        borderColor: "var(--tq-border-glass)",
        background: "var(--tq-bg-glass)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: "#15151c", color: "#fff" }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Segmented button row (transform / decoration) — same muted/active feel as the
// pill's align buttons; avoids a nested dropdown (and its backdrop-filter trap).
function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-7 min-w-[26px] items-center justify-center rounded-md px-1 text-[12px] transition-colors ${
              active ? "text-white" : "text-white/55 hover:text-white"
            }`}
            style={
              active
                ? { background: "var(--tq-bg-glass)" }
                : undefined
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
