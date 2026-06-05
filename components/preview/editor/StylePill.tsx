"use client";

// I2 — the floating style pill. A contextual, type-aware property toolbar that
// floats over the element selected in the SlideEditor iframe. Lives in the PARENT
// document (portaled to <body>) because its controls are parent-doc React
// primitives (ColorPickerPopover, InlineStepper…) — but it anchors to the
// in-iframe element via `target.ownerDocument.defaultView.frameElement`, the
// <iframe> seen from inside, so iframeRect + targetRect maps the element to
// parent-page coords with no ref-threading.
//
// Model (decided 2026-06-05): WHOLE-ELEMENT styling — one inline style on the
// element, never a <span> wrapper, so the round-trip stays clean. Export-safe
// props only. Persistence is free: write the inline style live, then (debounced)
// serialize the <section> and hand it to the existing I3 save path (onCommit =
// DeckView.handleSlideEdit). The iframe is pinned, so a self-save never blows
// away the live DOM.
//
// Scope here: I2.1 (shell + positioning) + I2.2 (text core: size · bold · color ·
// align). Font dropdown + "more" = I2.3, svg recolor = I2.4, image swap = I2.5.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { InlineStepper } from "@/components/create/OutputCards";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { serializeSlideSection } from "@/lib/editor/serialize";

type Props = {
  target: HTMLElement;
  slideId: string;
  onCommit: (slideId: string, html: string) => void;
};

type Kind = "text" | "image" | "svg";
function kindOf(el: HTMLElement): Kind {
  if (el.tagName === "IMG") return "image";
  if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) return "svg";
  return "text";
}

// getComputedStyle colours come back "rgb(r, g, b)" / "rgba(…)"; the picker wants
// "#rrggbb".
function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  const [r, g, b] = m
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  return (
    "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}

type Align = "left" | "center" | "right" | "justify";

// Text-align icon: four ragged lines, flush to the active edge.
function AlignIcon({ a }: { a: Align }) {
  const widths = [11, 7, 10, 6];
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
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

export function StylePill({ target, slideId, onCommit }: Props) {
  const kind = kindOf(target);
  const pillRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Bumped after every style write so the controls re-read getComputedStyle.
  const [, force] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── anchor over the target (above it, flipping below if no room) ──
  const reposition = useCallback(() => {
    const win = target.ownerDocument.defaultView;
    const iframeEl = (win?.frameElement as HTMLElement | null) ?? null;
    if (!iframeEl || !target.isConnected) return;
    const ir = iframeEl.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const cx = ir.left + tr.left + tr.width / 2;
    const topY = ir.top + tr.top;
    const botY = ir.top + tr.bottom;
    const pillW = pillRef.current?.offsetWidth ?? 240;
    const pillH = pillRef.current?.offsetHeight ?? 40;
    const GAP = 10;
    let top = topY - GAP - pillH;
    if (top < 8) top = Math.min(botY + GAP, window.innerHeight - pillH - 8);
    const left = Math.max(8, Math.min(cx - pillW / 2, window.innerWidth - pillW - 8));
    setPos({ left, top });
  }, [target]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    const on = () => reposition();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [reposition]);

  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  // ── debounced commit through the I3 save path ──
  const commit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      const sec = target.closest("section");
      if (sec) onCommit(slideId, serializeSlideSection(sec));
    }, 400);
  }, [target, slideId, onCommit]);

  // Write one inline style live, refresh the control values, follow the element
  // if it resized, and schedule a save.
  const setStyle = useCallback(
    (prop: string, value: string) => {
      target.style.setProperty(prop, value);
      force((n) => n + 1);
      reposition();
      commit();
    },
    [target, reposition, commit],
  );

  if (!target.isConnected) return null;

  // ── current values (read fresh each render) ──
  const cs = getComputedStyle(target);
  const fontPx = Math.round(parseFloat(cs.fontSize) || 16);
  const isBold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
  const color = rgbToHex(cs.color);
  const align = (target.style.textAlign || cs.textAlign || "right") as Align;

  const aligns: Align[] = ["right", "center", "left"];

  return createPortal(
    <div
      ref={pillRef}
      dir="ltr"
      className="glass-popover"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
        zIndex: 2147483600,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 7px",
        borderRadius: 12,
      }}
      // Don't let a click inside the pill bubble to the page / deselect.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {kind === "text" && (
        <>
          <InlineStepper
            value={fontPx}
            onChange={(n) => setStyle("font-size", `${n}px`)}
            min={8}
            max={400}
          />
          <Btn active={isBold} onClick={() => setStyle("font-weight", isBold ? "400" : "700")} label="Bold">
            <span style={{ fontWeight: 800, fontSize: 13 }}>B</span>
          </Btn>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Text colour"
              onClick={() => setColorOpen((o) => !o)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                border: "1px solid var(--tq-border)",
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
    </div>,
    document.body,
  );
}

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
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 24,
        borderRadius: 7,
        border: "1px solid transparent",
        background: active ? "var(--tq-text)" : "transparent",
        color: active ? "var(--tq-bg)" : "var(--tq-text)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: "var(--tq-border)" }} />;
}
