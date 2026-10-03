"use client";

// Studio deck-font menu (2026-10-03): the same Google Fonts picker as /create,
// applied to a finished deck. Picking a family previews it on the WHOLE deck
// (DeckView refonts its in-memory manifest from the snapshot taken when the
// menu opened); Apply persists it via /api/projects/[id]/font, Cancel / Esc
// restores. An outside click applies, like the colours menu.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import { HEADING_SAMPLE_AR, HEADING_SAMPLE_LATIN } from "@/lib/brand/fonts";

const WIDTH = 320;
const GAP = 12;
const EDGE = 12;

export function DeckFontPopover({
  open,
  triggerRect,
  family,
  deckLanguage,
  hadUploadedFont,
  busy,
  error,
  onPick,
  onApply,
  onCancel,
}: {
  open: boolean;
  triggerRect: DOMRect | null;
  // The previewed (or current) family.
  family: string | null;
  deckLanguage: "ar" | "en";
  // The deck uses an uploaded brand font: picking a Google family replaces it.
  hadUploadedFont: boolean;
  busy: boolean;
  error: boolean;
  onPick: (family: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.editor.deckFont;

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
        EDGE,
        Math.min(
          triggerRect.left + triggerRect.width / 2 - WIDTH / 2,
          window.innerWidth - WIDTH - EDGE,
        ),
      )
    : 0;
  const bottom = triggerRect ? window.innerHeight - triggerRect.top + GAP : 0;

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
            key="deck-font"
            dir={dir}
            role="dialog"
            aria-label={t.title}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="surface-popover fixed z-[1100] rounded-2xl"
            style={{ bottom, left, width: WIDTH }}
          >
            <header className="border-b border-foreground/[0.08] px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground">{t.title}</p>
              <p className="mt-0.5 text-[11px] text-foreground/60">{t.hint}</p>
            </header>
            <div className="flex flex-col gap-2 p-3">
              <GoogleFontSlot
                selected={family}
                sampleText={deckLanguage === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR}
                sampleSizeClass="text-sm"
                onSelect={(f) => (f ? onPick(f) : undefined)}
                hideSample
                compact
                dropUp
              />
              {hadUploadedFont ? (
                <p className="text-[11px] text-foreground/50">{t.uploadedNote}</p>
              ) : null}
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
                  {dict.editor.deckColors.cancel}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onApply}
                  className="btn-pill px-4 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy ? (
                    <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    dict.editor.deckColors.apply
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
