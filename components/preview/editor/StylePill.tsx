"use client";

// I2 — the floating style pill. A contextual, type-aware property toolbar that
// floats over the element selected in the SlideEditor iframe. Lives in the PARENT
// document (portaled to <body>) because its controls are parent-doc React
// primitives — but it anchors to the in-iframe element via
// `target.ownerDocument.defaultView.frameElement`, the <iframe> seen from inside.
//
// Position is driven by a requestAnimationFrame LOOP (not React state): every frame
// it reads the live selection box (.tqe-sel) and writes the pill's left/top. So the
// pill ALWAYS tracks the current selection — switching elements, resizing via the
// size control, aligning, or any reflow leaves it glued, never stuck on the old one.
//
// Model (decided 2026-06-05): WHOLE-ELEMENT styling — one inline style on the
// element, never a <span> wrapper. Saving is deferred to "you're done": writes are
// live, but the serialize → I3 save (onCommit) fires once, on DESELECT (the pill
// unmounts / re-targets) — a run of tweaks is ONE version, not one-per-keystroke.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { MorePopover } from "./MorePopover";
import { serializeSlideSection } from "@/lib/editor/serialize";

type Props = {
  target: HTMLElement;
  slideId: string;
  onCommit: (slideId: string, html: string) => void;
  // Clears the selection (→ unmounts the pill). Fired on a click outside the pill
  // AND outside the slide canvas (clicks inside the iframe go through SlideEditor).
  onDismiss: () => void;
};

type Kind = "text" | "image" | "svg";
function kindOf(el: HTMLElement): Kind {
  if (el.tagName === "IMG") return "image";
  if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) return "svg";
  return "text";
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  const [r, g, b] = m
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

type Align = "left" | "center" | "right" | "justify";

function AlignIcon({ a }: { a: Align }) {
  const widths = [11, 7, 10, 6];
  return (
    <svg width="17" height="14" viewBox="0 0 14 12" aria-hidden>
      {[1, 4, 7, 10].map((y, i) => {
        const w = widths[i];
        const x =
          a === "left" || a === "justify"
            ? 1.5
            : a === "right"
              ? 12.5 - w
              : (14 - w) / 2;
        return (
          <rect key={i} x={x} y={y} width={w} height={1.4} rx={0.7} fill="currentColor" />
        );
      })}
    </svg>
  );
}

const SIZE_MIN = 4;
const SIZE_MAX = 1200;

// Free-typing font-size control: type any value (no per-keystroke clamp — the
// shared InlineStepper clamps every change, so "700" snaps to its min), commit on
// blur / Enter, ± buttons nudge by 1. Range spans the decorative 700px+ numbers.
function SizeStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const clamp = (n: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
  const commitText = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onChange(clamp(n));
    setText(String(Number.isFinite(n) ? clamp(n) : value));
  };
  return (
    <div
      className="flex items-center rounded-full border"
      style={{
        height: 30,
        padding: "0 4px",
        borderColor: "var(--tq-border-glass)",
        background: "var(--tq-bg-glass)",
      }}
    >
      <button
        type="button"
        aria-label="Smaller"
        className="flex h-[24px] w-[24px] items-center justify-center text-lg leading-none text-white/55 transition-colors hover:text-white"
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        value={text}
        inputMode="numeric"
        aria-label="Font size"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="no-spinner w-[40px] border-none bg-transparent text-center text-[13px] text-white outline-none"
      />
      <button
        type="button"
        aria-label="Bigger"
        className="flex h-[24px] w-[24px] items-center justify-center text-lg leading-none text-white/55 transition-colors hover:text-white"
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function StylePill({ target, slideId, onCommit, onDismiss }: Props) {
  const kind = kindOf(target);
  const pillRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dirty = useRef(false);

  // ── position: a rAF loop reads the live selection box (.tqe-sel) and writes the
  // pill's left/top every frame, so it always tracks the current selection. ──
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = pillRef.current;
      const win = target.ownerDocument.defaultView;
      const iframeEl = (win?.frameElement as HTMLElement | null) ?? null;
      if (el && iframeEl && target.isConnected) {
        const ir = iframeEl.getBoundingClientRect();
        const selBox = target.ownerDocument.querySelector(".tqe-sel") as HTMLElement | null;
        const box =
          selBox && selBox.style.display !== "none"
            ? selBox.getBoundingClientRect()
            : target.getBoundingClientRect();
        const cx = ir.left + box.left + box.width / 2;
        const topY = ir.top + box.top;
        const botY = ir.top + box.bottom;
        const pw = el.offsetWidth;
        const ph = el.offsetHeight;
        let top = topY - 10 - ph;
        if (top < 8) top = Math.min(botY + 10, window.innerHeight - ph - 8);
        const left = Math.max(8, Math.min(cx - pw / 2, window.innerWidth - pw - 8));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = "visible";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // ── dismiss on a click outside the pill (and outside the canvas — clicks inside
  // the iframe live in a separate document and never reach this listener). ──
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pillRef.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);

  // ── commit ONCE on deselect/re-target (cleanup captures the OLD target). ──
  useEffect(() => {
    const el = target;
    const sid = slideId;
    return () => {
      if (!dirty.current) return;
      dirty.current = false;
      const sec = el.closest("section");
      if (sec && el.isConnected) onCommit(sid, serializeSlideSection(sec));
    };
  }, [target, slideId, onCommit]);

  const setStyle = useCallback(
    (prop: string, value: string) => {
      target.style.setProperty(prop, value);
      dirty.current = true;
      force((n) => n + 1);
    },
    [target],
  );

  if (!target.isConnected) return null;

  const cs = getComputedStyle(target);
  const fontPx = Math.round(parseFloat(cs.fontSize) || 16);
  const isBold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
  const isItalic = cs.fontStyle === "italic";
  const color = rgbToHex(cs.color);
  const align = (target.style.textAlign || cs.textAlign || "right") as Align;
  const aligns: Align[] = ["left", "center", "right"];

  return createPortal(
    <div
      ref={pillRef}
      dir="ltr"
      style={{
        position: "fixed",
        left: -9999,
        top: -9999,
        visibility: "hidden",
        zIndex: 2147483600,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* The blurred glass sits on a SIBLING layer BEHIND the controls, not as
          their ancestor. A backdrop-filter element is a "backdrop root" for its
          descendants — so if the pill's blur wrapped the controls, the colour
          picker (which pops out below the controls) would be nested inside it
          and could only blur the pill's flat interior, never the slide. With the
          blur on a sibling layer, the picker's only backdrop-filter ancestor is
          none → it blurs the slide directly, exactly like the pill. */}
      <div
        className="glass-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation) rounded-full shadow-2xl"
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 9px",
        }}
      >
      {kind === "text" && (
        <>
          <SizeStepper value={fontPx} onChange={(n) => setStyle("font-size", `${n}px`)} />
          <Btn active={isBold} onClick={() => setStyle("font-weight", isBold ? "400" : "700")} label="Bold">
            <span style={{ fontWeight: 800, fontSize: 15 }}>B</span>
          </Btn>
          <Btn active={isItalic} onClick={() => setStyle("font-style", isItalic ? "normal" : "italic")} label="Italic">
            <span style={{ fontStyle: "italic", fontWeight: 600, fontSize: 15, fontFamily: "Georgia, serif" }}>I</span>
          </Btn>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Text colour"
              onClick={() => setColorOpen((o) => !o)}
              style={{
                display: "block",
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "1px solid var(--tq-border-glass)",
                background: color,
                cursor: "pointer",
              }}
            />
            <ColorPickerPopover
              open={colorOpen}
              value={color}
              onChange={(hex) => setStyle("color", hex)}
              onClose={() => setColorOpen(false)}
              align="center"
              // Match the pill exactly: same dark glass + the modal-strength
              // boost blur (not the default white-tint card) so the picker
              // reads as frosted glass over a slide.
              surfaceClassName="glass-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation)"
            />
          </div>
          <Divider />
          <div style={{ display: "flex", gap: 2 }}>
            {aligns.map((a) => (
              <Btn key={a} active={align === a} onClick={() => setStyle("text-align", a)} label={`Align ${a}`}>
                <AlignIcon a={a} />
              </Btn>
            ))}
          </div>
        </>
      )}
      {kind !== "text" && (
        <span style={{ fontSize: 12, color: "var(--tq-text-muted)", padding: "0 6px" }}>
          {kind === "image" ? "Image — swap coming (I2.5)" : "Graphic — recolor coming (I2.4)"}
        </span>
      )}
      {/* "⋯ more" — the rest of the inspector (weight/line/spacing/transform/
          decoration/opacity for text; opacity/rounding for image+graphic). */}
      <Divider />
      <div style={{ position: "relative" }}>
        <Btn active={moreOpen} onClick={() => setMoreOpen((o) => !o)} label="More options">
          <MoreIcon />
        </Btn>
        <MorePopover
          open={moreOpen}
          target={target}
          kind={kind}
          setStyle={setStyle}
          onClose={() => setMoreOpen(false)}
        />
      </div>
      </div>
    </div>,
    document.body,
  );
}

function MoreIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

// Icon button: muted by default, white on hover, white when active (no fill box).
function Btn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active ? "text-white" : "text-white/55 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: "var(--tq-border-glass)" }} />;
}
