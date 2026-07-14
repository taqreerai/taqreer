"use client";

// Studio top-header Export control: ONE "تصدير" button → a portal'd glass
// dropdown with the four formats (PPTX / PDF / Google Slides / PNG). Replaces the four
// separate export buttons that used to live in the bottom toolbar — those moved
// up to the header and collapsed here (command-bar redesign, plan-editor §16).
//
// Anchoring + open/close mirror ProjectActionsMenu.tsx (portal'd .surface-popover,
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
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { isExportGated, EXPORT_GATE_TIER } from "@/lib/export/export-gating";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { GoogleSlidesReadyDialog } from "@/components/export/GoogleSlidesReadyDialog";
import { FormatIcon } from "@/components/export/FormatIcon";
import { planLabel } from "@/lib/plan";

const MENU_WIDTH = 224;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

// Fixed order (2026-07-13, user direction): PPTX → PDF → Google Slides →
// PNG. Google Slides replaced HTML and rides the same dom-to-pptx pipeline
// (BiDi fixes included); PNG moved last. Each row shows the colored
// file-type FormatIcon (2026-07-14).
const FORMATS: { kind: ExportKind }[] = [
  { kind: "pptx" },
  { kind: "pdf" },
  { kind: "gslides" },
  { kind: "png" },
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
  const dict = useDict();
  const { dir } = useLocale();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Tier-gated format clicked → upgrade modal (same pattern as the gated
  // presets in GenerateSplitButton; user direction 2026-07-13).
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const {
    states,
    busy,
    gslidesUrl,
    clearGslidesUrl,
    runPptx,
    runPdf,
    runPng,
    runGslides,
  } = useExportActions({
    projectId,
    projectTitle,
    manifest,
    formatFallback,
  });
  const run: Record<ExportKind, () => Promise<void>> = {
    pptx: runPptx,
    pdf: runPdf,
    png: runPng,
    gslides: runGslides,
  };

  // 3:4 social-post decks export as PDF/PNG only — PPTX has no sane 3:4
  // layout story and the HTML doc is presentation-shaped. Hide both.
  const effectiveFormat = manifest?.format ?? formatFallback ?? "16:9";
  const formats =
    effectiveFormat === "3:4"
      ? FORMATS.filter((f) => f.kind === "pdf" || f.kind === "png")
      : FORMATS;

  // Export tier gate: free keeps PNG only (and nothing on 3:4 social
  // decks). Gated rows stay visible with a gold crown and upsell on
  // click; the exporter's OWN plan decides, so shared/public viewers
  // gate on their plan, not the deck owner's. `credits` is null for
  // anonymous public-link viewers → gated (isExportGated treats null
  // plan as free).
  const credits = useCreditBalance();
  const gateUser = {
    plan: credits?.plan ?? null,
    isAdmin: credits?.isAdmin ?? false,
  };
  const gatedKinds = new Set(
    formats
      .filter((f) => isExportGated(f.kind, effectiveFormat, gateUser))
      .map((f) => f.kind),
  );
  // Crown the TRIGGER whenever any listed format is gated (i.e. for every
  // free user - user direction 2026-07-13): the gold crown on the Export
  // button itself signals the premium upsell before the menu even opens.
  const anyGated = gatedKinds.size > 0;

  // Esc closes. Outside-click dismissal is owned entirely by the scrim below
  // (a viewport layer above the deck <iframe>): a parent-document mousedown
  // listener can't see clicks inside the iframe, and keeping one alongside the
  // scrim just double-fired setOpen on every outside press, so it's gone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
  // Adaptive vertical side (2026-06-12): the trigger moved from the
  // slide-nav footer to the top header strip, so opening upward would
  // push the menu off-screen. Open DOWNWARD when the trigger sits in
  // the top half of the viewport, upward otherwise (covers any future
  // bottom-anchored reuse).
  const openDown = rect ? rect.top < window.innerHeight / 2 : true;
  const top = rect && openDown ? rect.bottom + ANCHOR_GAP_PX : undefined;
  const bottom =
    rect && !openDown ? window.innerHeight - rect.top + ANCHOR_GAP_PX : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={dict.editor.export.export}
        className={`btn-pill flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] ${
          disabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        <span
          className={`material-symbols-outlined text-[18px] ${busy ? "animate-spin" : ""}`}
          style={!busy && anyGated ? { color: "var(--tq-premium-gold)" } : undefined}
          aria-hidden
        >
          {busy ? "progress_activity" : anyGated ? "crown" : "ios_share"}
        </span>
        {/* Label hides on phones (icon + caret only) so Export + Share both fit
            the dense studio top bar; the aria-label keeps it accessible. (The
            caret keeps `material-symbols-outlined`, whose unlayered display beats
            Tailwind's `hidden`, so it isn't hidden here - not needed anyway.) */}
        <span className="max-md:hidden">{dict.editor.export.export}</span>
        <span className="material-symbols-outlined text-[16px] opacity-70" aria-hidden>
          expand_more
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <>
              {/* Invisible scrim (NOT a visual overlay - a dropdown must not
                  dim the studio, so no bg-overlay token): the SOLE outside-click
                  dismissal. An outside click ANYWHERE hits it, including over the
                  deck <iframe> (whose in-iframe clicks a parent-document listener
                  can't see - which is why the old document listener is gone). */}
              {open && rect ? (
                <div
                  className="fixed inset-0 z-[1099]"
                  aria-hidden
                  onMouseDown={() => setOpen(false)}
                />
              ) : null}
              <AnimatePresence>
              {open && rect ? (
                <motion.div
                  dir={dir}
                  role="menu"
                  aria-label={dict.editor.export.exportPresentation}
                  initial={{ opacity: 0, y: openDown ? -6 : 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: openDown ? -6 : 6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="surface-popover fixed z-[1100] overflow-hidden rounded-2xl"
                  // surface-popover's own border is a white alpha that vanishes in
                  // light mode; add the theme hairline so the menu always reads as a
                  // defined surface in both themes.
                  style={{ top, bottom, left, width: MENU_WIDTH, border: "1px solid var(--tq-border-hairline)" }}
                >
                  <ul className="flex flex-col p-1.5">
                    {formats.map((f) => {
                      const running = states[f.kind].status === "running";
                      const gated = gatedKinds.has(f.kind);
                      return (
                        <li key={f.kind} role="none">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              // A gated format doesn't export - it upsells.
                              if (gated) {
                                setUpgradeOpen(true);
                              } else {
                                void run[f.kind]();
                              }
                              setOpen(false);
                            }}
                            className={`dropdown-item export-menu-item ${
                              busy ? "cursor-not-allowed opacity-40 hover:bg-transparent!" : ""
                            }`}
                          >
                            {running ? (
                              <span
                                className="material-symbols-outlined animate-spin text-[26px]"
                                aria-hidden
                              >
                                progress_activity
                              </span>
                            ) : (
                              <FormatIcon kind={f.kind} size={28} />
                            )}
                            <span className="flex-1 text-start">
                              {dict.editor.export[f.kind]}
                            </span>
                            {gated ? (
                              // Gold crown = tier-gated affordance (clicking
                              // opens the upgrade modal, same as gated presets).
                              <span
                                className="material-symbols-outlined text-[16px]"
                                style={{ color: "var(--tq-premium-gold)" }}
                                aria-hidden
                              >
                                crown
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              ) : null}
              </AnimatePresence>
            </>,
            document.body,
          )
        : null}

      <GoogleSlidesReadyDialog url={gslidesUrl} onClose={clearGslidesUrl} />

      <UpgradeModal
        open={upgradeOpen}
        requiredTier={EXPORT_GATE_TIER}
        gateContext={{
          title: dict.components.creditGate.exportLockedTitle,
          body: dict.components.creditGate.exportLockedBody.replace(
            "{tier}",
            planLabel(dict.components.planUsage, EXPORT_GATE_TIER),
          ),
        }}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
