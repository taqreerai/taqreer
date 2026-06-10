"use client";

// Expand-image modal for /library.
//
// Reuses the app's canonical modal chrome (same recipe as
// TemplateLightbox / TemplateDeleteConfirmDialog): a `modal-dim`
// overlay sibling + a `surface-modal` panel,
// both rendered through a portal inside AnimatePresence so the panel's
// backdrop-filter samples the page cleanly (an animated transform/
// opacity ancestor would trap the blur).
//
// Navigation: prev/next arrows + ← / → keys walk the FULL visible
// list (not just the current page), seeded at the tile that was
// clicked. RTL keyboard mapping mirrors TemplateLightbox: ← = next,
// → = prev. Esc / click-outside close.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { LibraryImage } from "@/components/app/LibraryImageCard";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function LibraryImageModal({
  open,
  images,
  initialIndex,
  onClose,
}: {
  open: boolean;
  images: LibraryImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const total = images.length;
  const [index, setIndex] = useState(initialIndex);

  // Seed at the clicked tile each time the modal opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "reset on open" shape
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setIndex((i) => Math.min(total - 1, i + 1)),
    [total],
  );

  // Keyboard + body-scroll lock — single effect so listeners and
  // overflow install/teardown atomically.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goNext(); // RTL: ← = next
      else if (e.key === "ArrowRight") goPrev(); // RTL: → = prev
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

  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, total - 1));
  const image = images[safeIndex] ?? null;
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < total - 1;
  const isMulti = total > 1;

  return createPortal(
    <AnimatePresence>
      {open && image ? (
        <>
          {/* Dim overlay — sibling of the panel; click-outside closes. */}
          <motion.div
            key="lib-img-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[2000]"
          />

          {/* Panel wrapper — NO entry opacity animation (initial=1) so the
              glass blur appears intact; pointer-events-none so clicks
              outside the panel fall through to the dim. */}
          <motion.div
            key="lib-img-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[2001] flex items-center justify-center p-4"
          >
            <div
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-label={dict.dialogs.libraryImage.imageFrom.replace("{title}", image.projectTitle)}
              onClick={(e) => e.stopPropagation()}
              className="surface-modal pointer-events-auto flex max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
                <h2 className="truncate text-base font-semibold text-white">
                  {image.projectTitle}
                </h2>
                <div className="flex items-center gap-3">
                  {isMulti ? (
                    <span className="text-xs text-white/50" dir="ltr">
                      {safeIndex + 1} / {total}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={dict.common.close}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </header>

              {/* Body — prev/next arrows flank the image. Visual-right
                  arrow = PREV (RTL), visual-left = NEXT. */}
              <div className="flex min-h-0 flex-1 items-center gap-2 px-3 py-4">
                <ArrowButton
                  side="right"
                  enabled={canPrev}
                  onClick={goPrev}
                  ariaLabel={dict.common.previous}
                />
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={image.id}
                    src={image.url}
                    alt={image.projectTitle}
                    className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
                  />
                </div>
                <ArrowButton
                  side="left"
                  enabled={canNext}
                  onClick={goNext}
                  ariaLabel={dict.common.next}
                />
              </div>

              <footer className="flex items-center justify-end border-t border-white/[0.08] px-5 py-3">
                <a
                  href={`/api/library/images/${image.id}`}
                  download
                  className="btn-gradient inline-flex items-center gap-2 px-4 py-2 text-xs font-medium no-underline"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  >
                    download
                  </span>
                  {dict.dialogs.libraryImage.downloadImage}
                </a>
              </footer>
            </div>
          </motion.div>
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
