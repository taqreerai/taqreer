"use client";

// Per-tile 3-dots menu for brand-kit tiles. Same surface-popover surface
// + anchor + flip-above math + outside-click + Esc dismissal as
// `ProjectActionsMenu` and `TemplateActionsMenu`. Item set:
//
//   1. استخدام هوية الشركة         — fires `onUse` (parent opens
//                                     the flow picker dialog).
//   2. إعادة تسمية                 — fires `onRename` (parent opens
//                                     the rename dialog).
//   3. تعيين كافتراضية / إلغاء   — toggle this kit's default flag
//                                     so the four landing flows
//                                     auto-hydrate from it. Label
//                                     swaps based on `isDefault`.
//   4. حذف هوية الشركة             — destructive. Parent opens a
//                                     confirm dialog before firing
//                                     DELETE.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

const MENU_WIDTH = 240;
// Four items + divider + padding ≈ 200 px. Over-estimate is
// harmless; the value only feeds the "would the menu crop the
// viewport" flip-above check.
const MENU_HEIGHT_ESTIMATE_PX = 200;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

export type BrandKitActionsMenuActions = {
  onUse?: () => void;
  onRename?: () => void;
  onSetDefault?: () => void;
  onDelete?: () => void;
};

export function BrandKitActionsMenu({
  open,
  triggerRect,
  brandKitId,
  isDefault,
  onClose,
  onUse,
  onRename,
  onSetDefault,
  onDelete,
}: {
  open: boolean;
  triggerRect: DOMRect | null;
  // Identifies which tile owns this menu so the outside-click handler
  // can tell its OWN trigger (legitimate toggle, ignore) apart from
  // another tile's trigger. Stamped on the trigger as
  // `data-brand-kit-menu-trigger`.
  brandKitId: string;
  // Current default state of the kit this menu is opened for —
  // swaps the toggle item's label between "set" + "unset".
  isDefault?: boolean;
  onClose: () => void;
} & BrandKitActionsMenuActions) {
  const dict = useDict();
  const { dir } = useLocale();
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Outside click + Esc. Same recipe as the project + template menus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      const trigger = target.closest?.(
        "[data-brand-kit-menu-trigger]",
      ) as HTMLElement | null;
      if (trigger?.dataset.brandKitMenuTrigger === brandKitId) return;
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
  }, [open, onClose, brandKitId]);

  if (typeof document === "undefined") return null;

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
          key="brand-kit-actions-menu"
          ref={surfaceRef}
          dir={dir}
          role="menu"
          aria-label={dict.menus.brandKitActions.aria}
          initial={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="surface-popover fixed z-[1100] overflow-hidden rounded-2xl"
          style={{ top, bottom, left, width: MENU_WIDTH }}
        >
          <ul className="flex flex-col p-1.5">
            <MenuItem
              icon="auto_awesome"
              label={dict.menus.brandKitActions.use}
              onClick={onUse}
              onClose={onClose}
            />
            <MenuItem
              icon="edit"
              label={dict.common.rename}
              onClick={onRename}
              onClose={onClose}
            />
            <MenuItem
              icon={isDefault ? "star" : "star_outline"}
              label={
                isDefault
                  ? dict.menus.brandKitActions.unsetDefault
                  : dict.menus.brandKitActions.setDefault
              }
              onClick={onSetDefault}
              onClose={onClose}
            />
            <li aria-hidden className="my-1 h-px bg-white/[0.08]" />
            <MenuItem
              icon="delete"
              label={dict.menus.brandKitActions.delete}
              destructive
              onClick={onDelete}
              onClose={onClose}
            />
          </ul>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// Cloned from `TemplateActionsMenu`'s local MenuItem — same shape,
// same destructive + disabled styling. If a fourth menu lands, lift
// this into a shared component. Every click closes the menu (no
// "stay open" item exists in this menu's design).
function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
  onClose,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  onClose?: () => void;
}) {
  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    onClose?.();
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
