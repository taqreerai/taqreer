"use client";

// Lightbox for the /free-stock-images gallery. Opens on a tile click. Layout:
// the image on the start side, and a sidebar on the end side with the prompt,
// a download button, a separator, and "more from this set" — the other images
// from the SAME deck (lazily fetched from /api/stock-images/related). Clicking
// a suggestion swaps the shown image without a re-fetch (the whole deck group
// is loaded once).
//
// The preview is the THUMBNAIL (fast, already cached from the grid) — no
// full-res load in the modal, so swapping never flashes. The download button
// still serves the full-resolution original.
//
// Reuses the app's canonical modal chrome (same recipe as LibraryImageModal):
// a `modal-dim` overlay sibling + a `surface-modal` panel, portalled inside
// AnimatePresence so the glass blur samples the page cleanly. Esc /
// click-outside close; focus trapped; body scroll locked.
//
// PRIVACY: no deck title is shown (there isn't one in the payload) — the image
// PROMPT is the only caption.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { thumbUrl } from "@/components/marketing/StockImageCard";
import {
  getCachedRelated,
  prefetchRelated,
} from "@/components/marketing/stockImagesCache";
import type { StockImage } from "@/lib/stock-images/query";

export function StockImageModal({
  image,
  openId,
  onClose,
}: {
  image: StockImage | null;
  // Increments on every tile click. Scopes `selected` to ONE open, so
  // reopening the same tile always starts on that tile's image rather than
  // resuming the suggestion you last viewed in it.
  openId: number;
  onClose: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.stockImages;
  const open = image !== null;

  // Both bits of state are TAGGED with the tile they belong to (`forId`), so a
  // new open can never inherit a previous session's selection or deck. That
  // lets everything derive during render — no reset-on-open effect.
  const [selected, setSelected] = useState<{
    forOpen: number;
    image: StockImage;
  } | null>(null);
  const [deckFor, setDeckFor] = useState<{
    forId: string;
    images: StockImage[];
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  // Fetch-only effect (no synchronous setState): warms the deck group if the
  // tile's hover/focus prefetch hasn't already, then flips state so the render
  // picks it up. The cleanup invalidates the request, so a response landing
  // after close — or after a different tile opened — is dropped.
  useEffect(() => {
    if (!image) return;
    const forId = image.id;
    if (getCachedRelated(forId)) return; // already warm — rendered from cache
    let alive = true;
    prefetchRelated(forId).then(() => {
      const group = getCachedRelated(forId);
      if (alive && group) setDeckFor({ forId, images: group });
    });
    return () => {
      alive = false;
    };
  }, [image]);

  // Esc + body-scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  // Everything derives from the current open: a deck fetched for a different
  // image, or a selection from a previous open, simply doesn't apply — so a
  // stale one can never flash in, with no reset-on-open effect.
  //
  // The cache is read during render so a prefetched group paints on the FIRST
  // frame (no pop-in, no shift). `deckFor` state exists only to re-render the
  // cold path once its fetch lands.
  const cached = image ? getCachedRelated(image.id) : undefined;
  const deck =
    deckFor?.forId === (image?.id ?? "") ? deckFor.images : (cached ?? []);
  // Cold open: no group yet, so reserve the suggestions slot with a skeleton
  // instead of letting it pop in and shove the download button up.
  const loadingSuggestions = !!image && !cached && deckFor?.forId !== image.id;
  const shown =
    selected?.forOpen === openId && deck.some((d) => d.id === selected.image.id)
      ? selected.image
      : image;
  const suggestions = shown ? deck.filter((d) => d.id !== shown.id) : [];

  return createPortal(
    <AnimatePresence>
      {open && shown ? (
        <>
          {/* Dim overlay — sibling of the panel; click-outside closes. */}
          <motion.div
            key="stock-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[2000]"
          />
          {/* Panel wrapper — no entry opacity anim so the glass blur appears
              intact; pointer-events-none so outside clicks fall through. */}
          <motion.div
            key="stock-wrapper"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-[2001] flex items-center justify-center p-4"
          >
            <div
              ref={panelRef}
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-label={t.viewFull}
              onClick={(e) => e.stopPropagation()}
              className="surface-modal pointer-events-auto relative flex max-h-[90vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl md:h-[80vh] md:flex-row"
            >
              {/* Close — floats over the image (top-end). */}
              <button
                type="button"
                onClick={onClose}
                aria-label={dict.common.close}
                className="absolute end-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>

              {/* Image (start side) — thumbnail only; NOT keyed, so a swap keeps
                  the previous frame until the new (cached) thumbnail decodes:
                  no flash, no collapse. Sits on the panel surface (no dark fill). */}
              <div className="relative flex h-[45vh] shrink-0 items-center justify-center p-4 md:h-full md:min-h-0 md:flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl(shown.url)}
                  alt={shown.prompt}
                  draggable={false}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </div>

              {/* Sidebar (end side): prompt → download → separator → suggestions. */}
              <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto border-t border-foreground/[0.08] p-5 md:h-full md:w-[340px] md:flex-none md:border-s md:border-t-0">
                {/* pe-9 keeps the first lines clear of the floating close X. */}
                <p className="pe-9 text-sm leading-6 text-muted">{shown.prompt}</p>

                {/* Download + suggestions are pinned to the bottom (mt-auto), so
                    only the prompt at the top flexes: the button and the grid
                    never move when navigating within the set (the suggestion
                    count is constant per deck). */}
                <div className="mt-auto pt-6">
                  <a
                    href={`/api/stock-images/download?id=${encodeURIComponent(shown.id)}`}
                    download
                    className="btn-gradient flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium no-underline"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                      aria-hidden
                    >
                      download
                    </span>
                    {t.download}
                  </a>

                  {loadingSuggestions ? (
                    // Reserves the slot while the group loads, so the download
                    // button is already at its final spot (the hover prefetch
                    // means this rarely shows at all).
                    <div aria-hidden>
                      <div className="my-5 border-t border-foreground/[0.08]" />
                      <div className="mb-3 h-5 w-32 rounded bg-[var(--tq-overlay-soft)]" />
                      <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className="aspect-square animate-pulse rounded-[8px] bg-[var(--tq-overlay-soft)]"
                          />
                        ))}
                      </div>
                    </div>
                  ) : suggestions.length > 0 ? (
                    <>
                      <div className="my-5 border-t border-foreground/[0.08]" />
                      <h3 className="mb-3 text-sm font-semibold text-foreground">
                        {t.moreFromSet}
                      </h3>
                      <div className="grid grid-cols-3 gap-2">
                        {suggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelected({ forOpen: openId, image: s })}
                          // The PROMPT, so each suggestion has a distinct
                          // accessible name rather than a shared generic one.
                          aria-label={`${t.viewFull}: ${s.prompt}`}
                          className="tq-thumbnail group relative aspect-square overflow-hidden rounded-[8px]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbUrl(s.url)}
                            alt={s.prompt}
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                        </button>
                      ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
