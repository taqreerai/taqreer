"use client";

// Studio top-header Export control: ONE "تصدير" button → a portal'd glass
// dropdown with the four formats (PPTX / PDF / PNG / HTML). Replaces the four
// separate export buttons that used to live in the bottom toolbar — those moved
// up to the header and collapsed here (command-bar redesign, plan-editor §16).
//
// Anchoring + open/close mirror ProjectActionsMenu.tsx (portal'd .glass-popover,
// position from the trigger's DOMRect, outside-click + Esc to close, own-trigger
// excluded). The menu always opens DOWNWARD — the trigger sits in the top header,
// so there's never a reason to flip above.
//
// Calls useExportActions itself: its busy flag is cross-instance (module store),
// so a standalone instance here shares the same serialisation the ShareDialog's
// Export tab uses — two exports can't run at once.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import { useExportActions, type ExportKind } from "@/lib/preview/use-export-actions";

const MENU_WIDTH = 220;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

// Fixed order (locked 2026-05-21): PPTX → PDF → PNG → HTML.
const FORMATS: { kind: ExportKind; icon: string; label: string }[] = [
  { kind: "pptx", icon: "download", label: "تصدير PPTX" },
  { kind: "pdf", icon: "picture_as_pdf", label: "تصدير PDF" },
  { kind: "png", icon: "image", label: "تصدير PNG" },
  { kind: "html", icon: "code", label: "تصدير HTML" },
];

export function ExportMenu({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
  disabled,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  formatFallback?: SlideFormat;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const { states, busy, runPptx, runPdf, runPng, runHtml } = useExportActions({
    projectId,
    projectTitle,
    manifest,
    formatFallback,
  });
  const run: Record<ExportKind, () => Promise<void>> = {
    pptx: runPptx,
    pdf: runPdf,
    png: runPng,
    html: runHtml,
  };

  // Outside-click + Esc to close; own trigger excluded so its click toggles via
  // this component rather than instantly reopening (the ProjectActionsMenu bug).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (surfaceRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect() ?? null;
    setRect(r);
    setOpen(true);
  };

  // Right-aligned under the trigger (RTL: the menu's right edge meets the
  // trigger's right edge, so it drops down-and-to-the-left). Clamp to viewport.
  const left = rect
    ? Math.max(
        VIEWPORT_EDGE_INSET_PX,
        Math.min(
          rect.right - MENU_WIDTH,
          window.innerWidth - MENU_WIDTH - VIEWPORT_EDGE_INSET_PX,
        ),
      )
    : 0;
  const top = rect ? rect.bottom + ANCHOR_GAP_PX : 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="تصدير"
        className={`btn-pill flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] ${
          disabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        <span
          className={`material-symbols-outlined text-[18px] ${busy ? "animate-spin" : ""}`}
          aria-hidden
        >
          {busy ? "progress_activity" : "ios_share"}
        </span>
        <span>تصدير</span>
        <span className="material-symbols-outlined text-[16px] opacity-70" aria-hidden>
          expand_more
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && rect ? (
                <motion.div
                  ref={surfaceRef}
                  dir="rtl"
                  role="menu"
                  aria-label="تصدير العرض"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed z-[1100] overflow-hidden rounded-2xl shadow-2xl"
                  style={{ top, left, width: MENU_WIDTH }}
                >
                  <ul className="flex flex-col p-1.5">
                    {FORMATS.map((f) => {
                      const running = states[f.kind].status === "running";
                      return (
                        <li key={f.kind} role="none">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              void run[f.kind]();
                              setOpen(false);
                            }}
                            className={`dropdown-item ${
                              busy ? "cursor-not-allowed opacity-40 hover:bg-transparent!" : ""
                            }`}
                          >
                            <span
                              className={`material-symbols-outlined text-[18px] ${running ? "animate-spin" : ""}`}
                              aria-hidden
                            >
                              {running ? "progress_activity" : f.icon}
                            </span>
                            <span className="flex-1 text-start">{f.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
