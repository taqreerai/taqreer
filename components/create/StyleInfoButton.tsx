"use client";

// The small "i" on each design-style tile (2026-10-05): hover (desktop) or
// tap (touch) opens a short card explaining what the style does and which
// topics it suits. Portaled to <body> with fixed positioning so the tile
// grid's scroll box and the picker modal never clip it; clamped to the
// viewport. A sibling of the tile button (never nested inside it).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

const CARD_W = 248;
const MARGIN = 8;

export function StyleInfoButton({
  name,
  does,
  best,
  className = "",
}: {
  name: string;
  does: string;
  best: string;
  className?: string;
}) {
  const t = useDict().flows.stylePicker;
  const { dir } = useLocale();
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Align the card's inline-end with the button (mirrors for RTL), clamp.
    let left = dir === "rtl" ? r.left : r.right - CARD_W;
    left = Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN));
    const cardH = cardRef.current?.offsetHeight ?? 150;
    let top = r.bottom + 6;
    if (top + cardH > vh - MARGIN) top = Math.max(MARGIN, r.top - cardH - 6);
    setPos({ left, top });
  }, [dir]);

  const open = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    place();
  }, [place]);
  const closeSoon = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  }, []);

  // Re-measure once the card has its real height (flip above if needed).
  useEffect(() => {
    if (pos && cardRef.current) place();
    // Only on open: place() sets pos, so depending on pos would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos !== null]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!btnRef.current?.contains(n) && !cardRef.current?.contains(n)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const onScroll = () => setPos(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pos]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${t.infoAria}: ${name}`}
        aria-expanded={pos !== null}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) setPos(null);
          else open();
        }}
        // Hover only for a real mouse: a tap must not open on enter and then
        // close on the click that follows.
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") open();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") closeSoon();
        }}
        className={`flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 ${className}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>
          info
        </span>
      </button>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={cardRef}
              dir={dir}
              role="tooltip"
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") open();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") closeSoon();
              }}
              className="surface-popover fixed z-[1300] rounded-xl p-3 text-start text-foreground shadow-lg"
              style={{ left: pos.left, top: pos.top, width: CARD_W, border: "1px solid var(--tq-border-hairline)" }}
            >
              <p className="text-[13px] font-semibold">{name}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                {t.whatItDoes}
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-foreground/80">{does}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                {t.bestFor}
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-foreground/80">{best}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
