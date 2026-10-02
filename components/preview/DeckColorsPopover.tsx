"use client";

// Studio deck-colours menu (2026-10-02). Clicking a colour template previews
// it on the WHOLE deck instantly (DeckView recolors its in-memory manifest
// from the snapshot taken when the menu opened, so presets never stack);
// Apply persists it via /api/projects/[id]/recolor, Cancel / Esc restores.
// An outside click applies too: what the user sees is what they keep.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { PalettePresetGrid, PaletteStrip } from "@/components/brand/PalettePresets";
import type { PalettePreset } from "@/lib/brand/palette-presets";

const POPOVER_WIDTH = 340;
const ANCHOR_GAP_PX = 12;
const EDGE_INSET_PX = 12;

export function DeckColorsPopover({
  open,
  triggerRect,
  activeId,
  originalPalette,
  busy,
  error,
  onPick,
  onApply,
  onCancel,
}: {
  open: boolean;
  triggerRect: DOMRect | null;
  // The previewed preset id, "original", or null (nothing picked yet).
  activeId: string | null;
  // The deck's generated palette when it has been recolored before (shows
  // the "original colours" tile), else null.
  originalPalette: readonly string[] | null;
  busy: boolean;
  error: boolean;
  onPick: (preset: PalettePreset | "original") => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.editor.deckColors;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (typeof document === "undefined") return null;

  const left = triggerRect
    ? Math.max(
        EDGE_INSET_PX,
        Math.min(
          triggerRect.left + triggerRect.width / 2 - POPOVER_WIDTH / 2,
          window.innerWidth - POPOVER_WIDTH - EDGE_INSET_PX,
        ),
      )
    : 0;
  // The studio bar sits at the bottom: open upward.
  const bottom = triggerRect ? window.innerHeight - triggerRect.top + ANCHOR_GAP_PX : 0;

  return createPortal(
    <>
      {open && triggerRect ? (
        <div
          className="fixed inset-0 z-[1099]"
          aria-hidden
          onMouseDown={() => (busy ? undefined : onApply())}
        />
      ) : null}
      <AnimatePresence>
        {open && triggerRect ? (
          <motion.div
            key="deck-colors"
            dir={dir}
            role="dialog"
            aria-label={t.title}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="surface-popover fixed z-[1100] overflow-hidden rounded-2xl"
            style={{ bottom, left, width: POPOVER_WIDTH }}
          >
            <header className="border-b border-foreground/[0.08] px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground">{t.title}</p>
              <p className="mt-0.5 text-[11px] text-foreground/60">{t.hint}</p>
            </header>
            <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto p-3">
              {originalPalette ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick("original")}
                  aria-pressed={activeId === "original"}
                  className={`pick-tile flex items-center gap-2 rounded-lg p-1.5 text-start disabled:opacity-50 ${
                    activeId === "original" ? "is-active" : ""
                  }`}
                >
                  <PaletteStrip colors={originalPalette} className="h-5 w-20 shrink-0" />
                  <span className="text-[11px] font-medium text-foreground/80">{t.original}</span>
                </button>
              ) : null}
              <PalettePresetGrid
                activeId={activeId}
                onPick={onPick}
                labels
                disabled={busy}
                className="grid grid-cols-3 gap-1.5"
              />
              <p className="text-[11px] text-foreground/50">{t.photosNote}</p>
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-foreground/[0.08] px-3 py-2">
              <span className="text-[11px] text-red-400">{error ? t.failed : ""}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCancel}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={busy || activeId === null}
                  onClick={onApply}
                  className="btn-pill px-4 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy ? (
                    <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    t.apply
                  )}
                </button>
              </div>
            </footer>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>,
    document.body,
  );
}
