"use client";

// Project lightbox slider.
//
// Opens from a dashboard project tile click (RecentProjects /
// projects-page tile) and walks through every saved slide
// thumbnail. Keyboard nav, side arrows, bottom thumbnail strip,
// counter, project title in the top bar, click-outside / Esc close.
//
// STRUCTURE — mirrors `AllNotificationsModal`'s portal pattern so
// it escapes ancestor stacking contexts (the dashboard sidebar
// sits inside transformed parents and would otherwise paint over a
// non-portalled z-index):
//
//   Portal to <body>:
//     1. Dim overlay → `.modal-dim` + `backdrop-brightness-75`
//        (Tailwind utility) — darkens the page via backdrop-filter so
//        the glass strips above can still blur the page through it.
//        Click → close.
//     2. Content layer (sibling of dim) — `pointer-events-none`
//        wrapper with `pointer-events-auto` re-enabled on each
//        interactive child. Lets the dim's onClick swallow any
//        click that falls between toolbar / stage / strip.
//
// Glass discipline (memory: feedback_tw_glass_system):
//   • Top toolbar + bottom thumb strip → `.glass-popover` + Tailwind
//     `backdrop-blur-glass backdrop-saturate-(--glass-saturation)`
//     so the user's glass preset controls the blur. Raw
//     `backdrop-filter` would lose to Tailwind v4's compositional
//     rule.
//   • The dim overlay is intentionally solid (no own backdrop-
//     filter) so the toolbar/strip can still blur the page
//     underneath through it — backdrop-filter passes through
//     transparent-ish ancestors but is blocked by ancestors that
//     declare their own backdrop-filter.
//   • Glass elements have NO transform/opacity on their ancestor
//     chain. AnimatePresence sits on the dim + each glass strip
//     individually; self-opacity on the glass element doesn't trap
//     backdrop-filter (verified pattern in BellDropdown +
//     HistoryPopover).
//
// Animation:
//   • Dim fades opacity 0 → 1.
//   • Toolbar slides DOWN from the top edge.
//   • Bottom strip slides UP from the bottom edge.
//   • Slide image cross-fades on index change.
//
// Behaviour spec:
//   • ← / → step prev / next (no wrap — boundaries clamp).
//   • Home / End jump to first / last.
//   • Esc closes.
//   • Dim click closes; clicks inside toolbar / stage card / strip
//     don't propagate (each chunk stops propagation).
//   • Body scroll locked while open.
//   • Single-slide deck: arrows + thumb strip hidden.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideFormat } from "@/lib/schema/slide";

type Props = {
  open: boolean;
  slides: string[];
  format: SlideFormat;
  title: string;
  onClose: () => void;
};

export function ProjectLightbox({ open, slides, format, title, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const total = slides.length;
  const isMulti = total > 1;
  const aspectRatio = format === "9:16" ? 9 / 16 : 16 / 9;

  // Stage box dimensions — computed in JS because every pure-CSS
  // approach we tried hit an edge case:
  //   • `aspect-ratio` + `height: 100%` in a flex item leaves
  //     width at 0 (flex items default to min-content basis).
  //   • Switching to `grid place-items-center` left both dims 0
  //     (max-* constraints alone don't establish a starting size).
  //   • `width: auto` + `aspect-ratio` doesn't compute width from
  //     height when no width hint exists.
  // Measuring the stage container and computing the largest
  // aspect-correct box that fits inside is direct and survives
  // viewport resize via ResizeObserver.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // Largest box that fits both (width, height) while
      // preserving aspect ratio: pick whichever axis binds first.
      const widthBound = { width: r.width, height: r.width / aspectRatio };
      const heightBound = { height: r.height, width: r.height * aspectRatio };
      const next = widthBound.height <= r.height ? widthBound : heightBound;
      setCardSize({ width: Math.floor(next.width), height: Math.floor(next.height) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, aspectRatio]);

  // Reset to slide 0 on every fresh open. Closing + reopening the
  // same project keeps state; acceptable, costs nothing.
  //
  // `react-hooks/set-state-in-effect` flags this in strict configs
  // (the rule prefers external sync over self-driving state). It's
  // legitimate here — the index is internal to the lightbox and
  // needs to reset on the open transition; lifting it to the
  // parent would push lightbox-internal concerns into RecentProjects.
  // Document + disable for this line specifically.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);
  const goFirst = useCallback(() => setIndex(0), []);
  const goLast = useCallback(() => setIndex(Math.max(0, total - 1)), [total]);

  // Keyboard + body-scroll lock. Single effect so listeners and
  // overflow state install/remove atomically with the open flag.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // RTL keyboard mapping: visual-left = ADVANCE (because
      // Arabic reads right→left, so the next slide lives to the
      // left). ← goes forward, → goes backward. Consistent with
      // the strip + arrow layout, which both place slide 1 at
      // the visual-right edge.
      else if (e.key === "ArrowLeft") goNext();
      else if (e.key === "ArrowRight") goPrev();
      else if (e.key === "Home") goFirst();
      else if (e.key === "End") goLast();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, goPrev, goNext, goFirst, goLast]);

  if (typeof document === "undefined") return null;

  const currentSrc = slides[index] ?? null;
  const canPrev = index > 0;
  const canNext = index < total - 1;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          {/* Dim overlay — `.modal-dim` combines a light tint + a
              backdrop-filter brightness so the glass strips ABOVE this
              (toolbar, thumb strip) sample a darkened-page composite
              and their own backdrop-blur has actual page content to
              blur. The earlier "solid 0.88 dark" implementation made
              those strips' blur effect invisible. See globals.css. */}
          <motion.div
            key="dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim backdrop-brightness-75 fixed inset-0 z-[2000]"
          />

          {/* Content layer — sibling of the dim, fills the viewport
              but only the interactive chunks consume pointer events.
              Anything else falls through to the dim's onClick.
              `key` is required by React reconciliation when the
              Fragment-wrapped sibling list changes; without it,
              framer-motion's tracked motion descendants lost their
              animation state on re-render. */}
          <div
            key="content-layer"
            dir="rtl"
            className="pointer-events-none fixed inset-0 z-[2001] flex flex-col"
          >
            {/* Top toolbar — Pattern 3 (Layout surface) glass.
                Slides down on enter; chrome stays static during
                slide changes. */}
            <motion.header
              key="lbx-top"
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={stop}
              className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto flex items-center justify-between gap-4 px-6 py-3"
            >
              <h2
                className="min-w-0 flex-1 truncate text-sm font-semibold text-white"
                title={title}
              >
                {title}
              </h2>
              {isMulti ? (
                <span
                  dir="ltr"
                  className="text-muted shrink-0 text-xs font-medium tabular-nums"
                >
                  {index + 1} / {total}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                className="btn-pill inline-flex h-9 w-9 shrink-0 items-center justify-center p-0!"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </motion.header>

            {/* Slide stage — flex middle, the slide auto-fits the
                available box (capped by max-h / max-w so it never
                touches the chrome). `min-h-0` is the load-bearing
                bit: without it, flex children default to
                min-content sizing and the whole flex-col tower
                overflows the viewport (strip pushed off the
                bottom). With min-h-0 the middle compresses and
                the strip stays pinned.
                Stage itself is pointer-events-auto so the user can
                click the slide without falling through to the dim;
                the card stops propagation so only clicks OUTSIDE
                the slide rectangle reach the dim handler. */}
            <div
              ref={stageRef}
              className="pointer-events-auto flex min-h-0 flex-1 items-center justify-center px-6 py-6"
              onClick={onClose}
            >
              <motion.div
                key="lbx-card"
                className="relative"
                style={
                  cardSize
                    ? { width: cardSize.width, height: cardSize.height }
                    : { visibility: "hidden" }
                }
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onClick={stop}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.img
                    key={index}
                    src={currentSrc ?? ""}
                    alt={`${title} — ${index + 1} / ${total}`}
                    className="h-full w-full object-contain"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    draggable={false}
                  />
                </AnimatePresence>

                {isMulti ? (
                  <>
                    {/* Arrows sit OUTSIDE the card with a 40 px
                        gap from the slide edge. Positioned
                        relative to the card so the gap is
                        consistent regardless of stage width.
                        In RTL, "previous" reads as visual-right
                        (chevron_right) and "next" reads as
                        visual-left (chevron_left) — keyboard ←/→
                        still mean previous/next per OS muscle
                        memory (see effect above). */}
                    <button
                      type="button"
                      onClick={goPrev}
                      disabled={!canPrev}
                      aria-label="الشريحة السابقة"
                      className="btn-pill absolute top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center p-0! disabled:cursor-not-allowed disabled:opacity-30"
                      // chevron_right sits on the PHYSICAL right
                      // side of the card. `left: calc(100% + 40px)`
                      // pushes the button's left edge to
                      // card_right + 40 px (CSS `left` on absolute
                      // children is measured from the parent's
                      // left edge; `100%` resolves to parent width).
                      style={{ left: "calc(100% + 40px)" }}
                    >
                      <span className="material-symbols-outlined text-[22px]">
                        chevron_right
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={!canNext}
                      aria-label="الشريحة التالية"
                      className="btn-pill absolute top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center p-0! disabled:cursor-not-allowed disabled:opacity-30"
                      // chevron_left sits on the PHYSICAL left side
                      // of the card. `right: calc(100% + 40px)`
                      // pushes the button's right edge to
                      // card_left - 40 px.
                      style={{ right: "calc(100% + 40px)" }}
                    >
                      <span className="material-symbols-outlined text-[22px]">
                        chevron_left
                      </span>
                    </button>
                  </>
                ) : null}
              </motion.div>
            </div>

            {/* Bottom thumbnail strip — Pattern 3 glass; hidden for
                single-slide decks. Active thumb gets the brand
                gradient outline (compose two backgrounds: inner
                solid color in `padding-box` + outer gradient in
                `border-box`). Idle thumbs carry the standard glass
                border so the strip reads as a unified group. */}
            {isMulti ? (
              <motion.nav
                key="lbx-bottom"
                aria-label="شرائح المشروع"
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 16, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={stop}
                className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) pointer-events-auto flex justify-center gap-2 overflow-x-auto px-6 py-3"
              >
                {slides.map((src, i) => {
                  const active = i === index;
                  return (
                    <button
                      key={`${src}:${i}`}
                      type="button"
                      onClick={() => setIndex(i)}
                      aria-label={`الشريحة ${i + 1}`}
                      aria-current={active}
                      className={`tq-thumbnail relative h-14 shrink-0 overflow-hidden rounded-md transition-opacity ${
                        active ? "opacity-100" : "opacity-60 hover:opacity-90"
                      }`}
                      style={{
                        aspectRatio: format === "9:16" ? "9 / 16" : "16 / 9",
                        border: active
                          ? "1.5px solid transparent"
                          : "1px solid var(--tq-border-glass)",
                        backgroundImage: active
                          ? `linear-gradient(var(--tq-bg), var(--tq-bg)), var(--tq-gradient-brand)`
                          : undefined,
                        backgroundOrigin: active ? "border-box" : undefined,
                        backgroundClip: active
                          ? "padding-box, border-box"
                          : undefined,
                      }}
                    >
                      <img
                        src={src}
                        alt=""
                        aria-hidden
                        className={`h-full w-full ${
                          format === "9:16"
                            ? "object-cover object-top"
                            : "object-cover"
                        }`}
                        loading="lazy"
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </motion.nav>
            ) : null}
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
