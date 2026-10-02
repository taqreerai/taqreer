"use client";

// Studio rendering of the free-plan branding (2026-10-02): the "Made with
// taqreer.ai" watermark layer over every slide and the system-appended
// branded closing slide. The markup comes from lib/export/free-branding, the
// same builders the PNG export uses, so the studio shows exactly what exports.
//
// Both are PARENT-DOCUMENT chrome (never inside the editor iframe's
// <section>, never in slideJson): no layer row, can't be selected, edited or
// deleted, and they vanish when the deck owner upgrades (load-project
// `brandingWatermark`). Clicking the badge or the closing slide upsells.

import { useEffect, useRef, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
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

function useUpgrade() {
  const dict = useDict();
  const [open, setOpen] = useState(false);
  const modal = (
    <UpgradeModal
      open={open}
      requiredTier="plus"
      gateContext={{
        title: dict.components.creditGate.watermarkTitle,
        body: dict.components.creditGate.watermarkBody,
      }}
      onClose={() => setOpen(false)}
    />
  );
  return { openUpgrade: () => setOpen(true), modal, title: dict.components.creditGate.watermarkTitle };
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
  const { openUpgrade, modal, title } = useUpgrade();
  return (
    <>
      <div
        className="tq-free-wm pointer-events-none absolute inset-0 z-30"
        title={title}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-tq-badge]")) openUpgrade();
        }}
      >
        <ScaledSlideHtml html={watermarkHtml(lang, dims, { cover })} dims={dims} />
      </div>
      {modal}
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
  const { openUpgrade, modal, title } = useUpgrade();
  return (
    <>
      <div
        className={`absolute inset-0 ${interactive ? "cursor-pointer" : ""}`}
        title={interactive ? title : undefined}
        onClick={interactive ? openUpgrade : undefined}
      >
        <ScaledSlideHtml html={closingSlideHtml(lang, dims)} dims={dims} />
      </div>
      {interactive ? modal : null}
    </>
  );
}
