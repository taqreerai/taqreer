"use client";

// Per-tile actions menu for template tiles. Mirrors ProjectActionsMenu
// structurally — same surface-popover surface, same anchor + flip-above
// math, same outside-click + Esc dismissal — with a smaller item set
// tailored to templates:
//
//   1. اجعله عاما / اجعله خاصا  — toggles isPublic via PATCH
//                                   /api/templates/[id]/visibility
//   2. استخدامه كقالب              — Phase D "use this template" (wired
//                                   2026-05-22). Calls onUseAsTemplate
//                                   which seeds the create flow from
//                                   the template's BrandSnapshot and
//                                   navigates to /create/content.
//   3. حذف القالب                  — destructive. Parent opens a confirm
//                                   dialog before firing DELETE.
//
// Owner-only — community templates render no 3-dots trigger at all.
// The visibility + delete actions don't make sense on someone else's
// template, and "use as template" lives in the lightbox CTA for that
// case (community tab's primary affordance).

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

const MENU_WIDTH = 240;
// Conservative — 3 items × ~38 px + a divider + 12 px padding ≈ 150 px.
// Used only for the "would the menu overflow the bottom of the viewport"
// flip-above check; an over-estimate is harmless.
const MENU_HEIGHT_ESTIMATE_PX = 160;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

export type TemplateActionsMenuActions = {
  onToggleVisibility?: () => void;
  onUseAsTemplate?: () => void;
  onDelete?: () => void;
};

// Phase D shipped `onUseAsTemplate` on 2026-05-22. `onExitComplete`
// stays absent — it mirrored ProjectActionsMenu's contract but no
// template-menu consumer ever needed the exit-animation completion
// hook.

export function TemplateActionsMenu({
  open,
  triggerRect,
  templateId,
  reviewStatus,
  onClose,
  onToggleVisibility,
  onUseAsTemplate,
  onDelete,
}: {
  open: boolean;
  triggerRect: DOMRect | null;
  // Identifies which tile owns this menu so the outside-click handler
  // can tell its OWN trigger (legitimate toggle, ignore) apart from
  // another tile's trigger. Stamped on the trigger as
  // data-template-menu-trigger.
  templateId: string;
  // Moderation state of the owner's publish request — drives the first
  // menu item: PRIVATE => "submit for review", PENDING => "cancel request",
  // APPROVED => "make private".
  reviewStatus: "PRIVATE" | "PENDING" | "APPROVED";
  onClose: () => void;
} & TemplateActionsMenuActions) {
  const dict = useDict();
  const { dir } = useLocale();
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Outside click + Esc. Mirrors ProjectActionsMenu — clicking THIS
  // tile's trigger doesn't count as outside (the parent toggles via
  // its own click handler). Clicking another tile's trigger DOES count
  // as outside, so the other menu closes and the new one opens on the
  // same gesture.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      const trigger = target.closest?.(
        "[data-template-menu-trigger]",
      ) as HTMLElement | null;
      if (trigger?.dataset.templateMenuTrigger === templateId) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, templateId]);

  if (typeof document === "undefined") return null;

  // Right-anchored under the trigger, flip above if the bottom would
  // get cropped — same recipe as ProjectActionsMenu so menus across
  // the app share one positioning rhythm.
  const left = triggerRect
    ? Math.max(
        VIEWPORT_EDGE_INSET_PX,
        Math.min(
          triggerRect.right - MENU_WIDTH,
          window.innerWidth - MENU_WIDTH - VIEWPORT_EDGE_INSET_PX,
        ),
      )
    : 0;
  const shouldFlipAbove = !!(
    triggerRect &&
    triggerRect.bottom + ANCHOR_GAP_PX + MENU_HEIGHT_ESTIMATE_PX >
      window.innerHeight &&
    triggerRect.top - ANCHOR_GAP_PX - MENU_HEIGHT_ESTIMATE_PX >= 0
  );
  // See ProjectActionsMenu for the full reasoning — anchor `top`
  // when below, `bottom` when flipped above. Avoids tying the
  // menu's vertical position to a stale height estimate.
  const top =
    triggerRect && !shouldFlipAbove
      ? triggerRect.bottom + ANCHOR_GAP_PX
      : undefined;
  const bottom =
    triggerRect && shouldFlipAbove
      ? window.innerHeight - triggerRect.top + ANCHOR_GAP_PX
      : undefined;

  return createPortal(
    <AnimatePresence>
      {open && triggerRect ? (
        <motion.div
          key="template-actions-menu"
          ref={surfaceRef}
          dir={dir}
          role="menu"
          aria-label={dict.menus.templateActions.aria}
          initial={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="surface-popover fixed z-[1100] overflow-hidden rounded-2xl"
          style={{ top, bottom, left, width: MENU_WIDTH }}
        >
          <ul className="flex flex-col p-1.5">
            <MenuItem
              icon={
                reviewStatus === "APPROVED"
                  ? "lock"
                  : reviewStatus === "PENDING"
                    ? "hourglass_top"
                    : "public"
              }
              label={
                reviewStatus === "APPROVED"
                  ? dict.menus.templateActions.makePrivate
                  : reviewStatus === "PENDING"
                    ? dict.menus.templateActions.cancelReview
                    : dict.menus.templateActions.submitReview
              }
              onClick={onToggleVisibility}
              closeAfter
              onClose={onClose}
            />
            {/* Use-as-template (Phase D wired 2026-05-22). When the
                parent doesn't pass onUseAsTemplate, falls back to the
                disabled placeholder so the row stays greppable + the
                menu's vertical rhythm is stable. */}
            <MenuItem
              icon="dashboard_customize"
              label={dict.menus.templateActions.useAsTemplate}
              onClick={onUseAsTemplate}
              disabled={!onUseAsTemplate}
              closeAfter
              onClose={onClose}
            />
            <li aria-hidden className="my-1 h-px bg-foreground/[0.08]" />
            <MenuItem
              icon="delete"
              label={dict.menus.templateActions.delete}
              destructive
              onClick={onDelete}
              closeAfter
              onClose={onClose}
            />
          </ul>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// ─── MenuItem (local — same shape as ProjectActionsMenu's) ───────────
//
// Cloned rather than imported to keep the file standalone; if a third
// consumer ever needs the row, lift it into a shared component.

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
  closeAfter,
  onClose,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  closeAfter?: boolean;
  onClose?: () => void;
}) {
  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    if (closeAfter) onClose?.();
  };
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={handleClick}
        disabled={disabled}
        className={`dropdown-item ${
          destructive
            ? "text-red-300 hover:bg-red-500/10! hover:text-red-200!"
            : ""
        } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent! hover:text-[color:var(--tq-text-muted)]!" : ""}`}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18 }}
          aria-hidden
        >
          {icon}
        </span>
        <span className="flex-1 text-start">{label}</span>
      </button>
    </li>
  );
}
