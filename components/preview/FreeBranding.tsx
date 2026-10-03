"use client";

// Studio rendering of the free-plan branding (2026-10-02): the "Made with
// taqreer.ai" watermark layer over every slide and the system-appended
// branded closing slide. The markup comes from lib/export/free-branding, the
// same builders the PNG export uses, so the studio shows exactly what exports.
//
// Both are PARENT-DOCUMENT chrome (never inside the editor iframe's
// <section>, never in slideJson): no layer row, can't be selected, edited or
// deleted, and they vanish when the deck owner upgrades (load-project
// `brandingWatermark`). Clicking the badge or the closing slide opens the
// small upsell popover (WatermarkUpsellPopover).

import { useEffect, useRef, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { WatermarkUpsellPopover } from "@/components/billing/WatermarkUpsellPopover";
import {
  CAIRO_CSS_URL,
  closingSlideHtml,
  watermarkHtml,
  type BrandLang,
  type SlideDims,
} from "@/lib/export/free-branding";

const CAIRO_LINK_ID = "tq-branding-cairo";

function useCairo() {
  useEffect(() => {
    if (document.getElementById(CAIRO_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = CAIRO_LINK_ID;
    link.rel = "stylesheet";
    link.href = CAIRO_CSS_URL;
    document.head.appendChild(link);
  }, []);
}

/** Renders slide-sized static HTML scaled to fill its (same-aspect) parent. */
function ScaledSlideHtml({
  html,
  dims,
  className = "",
}: {
  html: string;
  dims: SlideDims;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / dims.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.width]);
  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: dims.width,
          height: dims.height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          visibility: scale ? "visible" : "hidden",
        }}
        // Static, trusted markup from lib/export/free-branding (no user data).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// Clicking the badge or the closing slide opens the small upsell popover next
// to it (WatermarkUpsellPopover), not the full plans modal.
function useUpsell() {
  const dict = useDict();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const popover = <WatermarkUpsellPopover anchor={anchor} onClose={() => setAnchor(null)} />;
  return { open: setAnchor, popover, title: dict.components.creditGate.watermarkTitle };
}

/**
 * The watermark layer: covers the artboard, ignores pointer events except on
 * the badge itself (click = upsell), so editing underneath is unobstructed.
 */
export function FreeWatermarkLayer({
  lang,
  dims,
  cover = false,
}: {
  lang: BrandLang;
  dims: SlideDims;
  // Slide 1: the larger badge with the slogan.
  cover?: boolean;
}) {
  useCairo();
  const { open, popover, title } = useUpsell();
  const layerRef = useRef<HTMLDivElement>(null);
  // Hit-test the badge by POSITION in a capture-phase listener (2026-10-03):
  // in the editor, overlays painted after this layer (selection / drag
  // surfaces) can swallow a plain click even though the badge is visible, so
  // a click inside the badge's rect is claimed here before anything else.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const badge = layerRef.current?.querySelector<HTMLElement>("[data-tq-badge]");
      if (!badge) return;
      const r = badge.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      e.preventDefault();
      e.stopPropagation();
      open(r);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  return (
    <>
      <div
        ref={layerRef}
        className="tq-free-wm pointer-events-none absolute inset-0 z-30"
        title={title}
      >
        <ScaledSlideHtml html={watermarkHtml(lang, dims, { cover })} dims={dims} />
      </div>
      {popover}
    </>
  );
}

/** The branded closing slide, filling its parent. `interactive` = click upsells. */
export function BrandedClosingSlide({
  lang,
  dims,
  interactive = true,
}: {
  lang: BrandLang;
  dims: SlideDims;
  interactive?: boolean;
}) {
  useCairo();
  const { open, popover, title } = useUpsell();
  return (
    <>
      <div
        className={`absolute inset-0 ${interactive ? "cursor-pointer" : ""}`}
        title={interactive ? title : undefined}
        onClick={
          interactive
            ? (e) => {
                // Anchor on the click point so the popover opens where the
                // user looked, not on the whole slide's edge.
                open(new DOMRect(e.clientX, e.clientY, 0, 0));
              }
            : undefined
        }
      >
        <ScaledSlideHtml html={closingSlideHtml(lang, dims)} dims={dims} />
      </div>
      {interactive ? popover : null}
    </>
  );
}
