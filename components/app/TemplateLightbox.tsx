"use client";

// Template preview lightbox.
//
// Smaller, modal-wrapped sibling of ProjectLightbox. The full-screen
// ProjectLightbox blew up the showcase PNGs to 1920-ish on a desktop
// and made the ~800 px source images look low-res. Templates also
// have only 3 slides (vs. a deck's 12-20) — so the wide stage was
// dead pixels. This component:
//
//   • Renders in a glass-popover modal (same chrome as the Bell
//     "عرض الكل" modal + SaveAsTemplateDialog) instead of taking
//     over the whole viewport.
//   • Stage is fixed at TEMPLATE_STAGE_PX wide (16:9) or tall
//     (9:16) — close to the actual rendered WebP size so the
//     image is shown at its native resolution.
//   • Keeps the ProjectLightbox interactions (← → keyboard, Esc,
//     Home/End, click thumb strip) so the muscle memory carries.
//
// Used by:
//   • /templates browse page (click a tile)
//   • Dashboard "قوالبي" widget (click a tile — same in-place
//     preview, no navigation)
//
// Both consumers just toggle `open` + pass the template data; the
// component owns the index state + scroll lock + keyboard wiring.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideFormat } from "@/lib/schema/slide";

// Stage dimensions — driven by the actual rendered showcase WebP
// width (800 px from thumbnail-render's THUMBNAIL_WIDTH_PX). 450 px
// keeps the stage close to native res (no upscaling) while leaving
// room for the modal chrome on a typical laptop viewport.
const TEMPLATE_STAGE_PX = 450;

type Props = {
  open: boolean;
  slides: string[];
  format: SlideFormat;
  title: string;
  onClose: () => void;
};

export function TemplateLightbox({ open, slides, format, title, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const total = slides.length;
  const isPortrait = format === "9:16";

  // Stage box. In 16:9 the WIDTH is fixed at TEMPLATE_STAGE_PX and
  // height derives from the aspect. In 9:16 the HEIGHT is fixed and
  // width derives — keeps vertical-template stages from blowing
  // taller than the viewport on small screens.
  const stageWidth = isPortrait
    ? Math.round(TEMPLATE_STAGE_PX * (9 / 16))
    : TEMPLATE_STAGE_PX;
  const stageHeight = isPortrait
    ? TEMPLATE_STAGE_PX
    : Math.round(TEMPLATE_STAGE_PX * (9 / 16));

  // Reset to slide 0 on each fresh open.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const goPrev = useCallback(
    () => setIndex((i) => Math.max(0, i - 1)),
    [],
  );
  const goNext = useCallback(
    () => setIndex((i) => Math.min(total - 1, i + 1)),
    [total],
  );

  // Keyboard + body-scroll lock — single effect so listeners and
  // overflow install/teardown atomically. Mirrors ProjectLightbox
  // RTL keyboard mapping (← = next, → = prev).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goNext();
      else if (e.key === "ArrowRight") goPrev();
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(Math.max(0, total - 1));
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, goPrev, goNext, total]);

  if (typeof document === "undefined") return null;

  const currentSrc = slides[index] ?? null;
  const canPrev = index > 0;
  const canNext = index < total - 1;
  const isMulti = total > 1;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          {/* Dim overlay — sibling, fade animated, NO backdrop-filter
              so the glass panel can still blur the page through it. */}
          <motion.div
            key="tpl-lbx-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            // `.modal-dim` combines a light tint + backdrop-filter
            // brightness so the panel's own backdrop-blur has actual
            // page content (darkened) to sample. See globals.css
            // for the full reasoning.
            className="modal-dim backdrop-brightness-75 fixed inset-0 z-[2000]"
          />

          {/* Panel wrapper — `motion.div` so AnimatePresence tracks
              its EXIT animation. NO entry animation (initial=1) on
              purpose: the modal needs to appear with its full glass
              blur intact, and animating opacity 0→1 on an ancestor
              of a backdrop-filter element traps the filter in a
              stacking context for the duration of the transition
              (~180 ms of "blur staggering in"). Skipping the entry
              gives us a clean macOS-style "dim fades in around a
              statically-appearing modal" effect: dim has its own
              fade, panel pops with blur ready, both fade out together
              on close.
              `pointer-events-none` so clicks fall through to the dim
              outside the panel; the panel itself opts back in via
              `pointer-events-auto`. */}
          <motion.div
            key="tpl-lbx-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[2001] flex items-center justify-center p-4"
          >
            <div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tpl-lbx-title"
              onClick={(e) => e.stopPropagation()}
              className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto flex max-h-[90vh] flex-col overflow-hidden rounded-2xl"
            >
              {/* Header */}
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
                <h2
                  id="tpl-lbx-title"
                  className="truncate text-base font-semibold text-white"
                >
                  {title}
                </h2>
                <div className="flex items-center gap-3">
                  {isMulti ? (
                    <span className="text-xs text-white/50" dir="ltr">
                      {index + 1} / {total}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="إغلاق"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </header>

              {/* Body — stage + side nav arrows. The stage box is
                  fixed-size based on the brand's format; arrows hug
                  the stage edges so they sit at a natural reach
                  distance regardless of how big the modal grows. */}
              <div className="flex items-center gap-3 px-5 py-5">
                {/* Visual-right arrow = PREV (RTL: previous lives to
                    the right of the current slide). Mapped to "right
                    arrow" key in the keyboard handler above. */}
                <ArrowButton
                  side="right"
                  enabled={canPrev}
                  onClick={goPrev}
                  ariaLabel="السابق"
                />
                <div
                  className="relative shrink-0 overflow-hidden rounded-xl bg-black/30"
                  style={{ width: stageWidth, height: stageHeight }}
                >
                  {currentSrc ? (
                    <img
                      key={currentSrc}
                      src={currentSrc}
                      alt={`${title} — ${index + 1} / ${total}`}
                      className="h-full w-full object-contain"
                      style={{
                        // Fade between slides on index change. Tiny
                        // detail — the parent's key={currentSrc}
                        // forces a remount which lets opacity animate
                        // from 0 to 1 every time.
                        animation: "tpl-lbx-fade 220ms ease-out",
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/40">
                      <span className="material-symbols-outlined text-[40px]">
                        hourglass_empty
                      </span>
                    </div>
                  )}
                </div>
                <ArrowButton
                  side="left"
                  enabled={canNext}
                  onClick={goNext}
                  ariaLabel="التالي"
                />
              </div>

              {/* Thumbnail strip — small clickable thumbs of every
                  slide, current one highlighted. Only renders when
                  there's more than one slide (single-slide templates
                  shouldn't be possible today but the guard costs
                  nothing). */}
              {isMulti ? (
                <div className="flex items-center justify-center gap-2 border-t border-white/[0.08] px-5 py-3">
                  {slides.map((src, i) => {
                    const active = i === index;
                    return (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setIndex(i)}
                        aria-label={`الشريحة ${i + 1}`}
                        aria-current={active}
                        className={`h-10 w-16 overflow-hidden rounded-md transition-opacity ${
                          active
                            ? "opacity-100 ring-2 ring-[var(--tq-blue)]"
                            : "opacity-50 hover:opacity-80"
                        }`}
                      >
                        <img
                          src={src}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* Footer CTA — "Use this template" (Phase D). Visible
                  and styled but DISABLED for now — clicking does
                  nothing. The button stays in place so the affordance
                  is greppable and the footer's vertical rhythm is
                  established for when Phase D wires this. */}
              <footer className="flex items-center justify-end border-t border-white/[0.08] px-5 py-3">
                <button
                  type="button"
                  disabled
                  className="btn-gradient inline-flex items-center gap-2 px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  >
                    dashboard_customize
                  </span>
                  استخدامه كقالب
                </button>
              </footer>
            </div>
          </motion.div>

          {/* Inline keyframes — kept here (not globals.css) because
              this is the only consumer and lifting them out makes
              this file harder to read in isolation. */}
          <style>{`
            @keyframes tpl-lbx-fade {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// ─── Arrow button ─────────────────────────────────────────────────────

function ArrowButton({
  side,
  enabled,
  onClick,
  ariaLabel,
}: {
  side: "left" | "right";
  enabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={ariaLabel}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/25"
    >
      <span className="material-symbols-outlined">
        {side === "left" ? "chevron_left" : "chevron_right"}
      </span>
    </button>
  );
}
