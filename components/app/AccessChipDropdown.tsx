"use client";

// Access role picker — used in the Share modal as the leading
// "Access" chip on the invite bar, and as the per-row role chip on
// each invitee row (clicked to change their role).
//
// Why a portal popover (not a native `<select>`):
// the global "no native dropdowns" rule (user feedback 2026-05-23 —
// "we already have styled ones, don't use defaults"). Same recipe as
// ProjectActionsMenu: portal'd `.glass-popover`, position derived
// from the trigger's DOMRect, flip-above when low on viewport,
// outside-click + Esc dismiss.
//
// Three rows (View / Comment / Edit). The chip trigger is a
// `.btn-pill` with a leading chevron — matches the rest of the
// pill family in the system.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export type AccessRole = "view" | "comment" | "edit";

const ROLE_LABEL: Record<AccessRole, string> = {
  view: "عرض",
  comment: "تعليق",
  edit: "تعديل",
};

const ROLE_DESCRIPTION: Record<AccessRole, string> = {
  view: "يستطيع المشاهدة فقط",
  comment: "يستطيع المشاهدة والتعليق",
  edit: "يستطيع التعديل الكامل",
};

const MENU_WIDTH = 220;
const MENU_HEIGHT_ESTIMATE_PX = 160;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

export function AccessChipDropdown({
  value,
  onChange,
  disabled,
  /** Optional override of the trigger label (used by per-row chips
   *  where the chip says "Full Access" for the owner row). */
  triggerLabel,
  /** When true, the chip renders without a chevron and is
   *  non-interactive — used for the owner row's "Full Access" badge. */
  readOnly,
}: {
  value: AccessRole;
  onChange: (next: AccessRole) => void;
  disabled?: boolean;
  triggerLabel?: string;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Trigger click TOGGLES the menu — open when closed, close when
  // open. Without this, clicking the chip while the menu was visible
  // re-fired open=true (no-op since already true) and the outside-
  // click handler couldn't see the trigger as "outside" either, so
  // there was no way to dismiss via the chip itself.
  const handleToggle = () => {
    if (readOnly || disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    if (!triggerRef.current) return;
    setTriggerRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  // Outside-click + Esc dismiss. The trigger itself is EXCLUDED from
  // outside-click (the trigger's own click handler `handleToggle`
  // owns the open↔close transition) — otherwise mousedown on the
  // trigger would close first, then the subsequent click would
  // immediately re-open, producing a flicker with no visible state
  // change. Same exclusion pattern ProjectActionsMenu uses.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
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

  // Position the popover. Right-anchored (matches RTL reading
  // direction — chip on the leading edge, popover drops below and
  // to the LTR-left which is RTL-end).
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

  const label = triggerLabel ?? ROLE_LABEL[value];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled || readOnly}
        aria-haspopup={readOnly ? undefined : "menu"}
        aria-expanded={readOnly ? undefined : open}
        // `.btn-pill` is the canonical pill primitive (PATTERN 1).
        // We tighten padding here because the chip lives inside a
        // form row; the default .btn-pill padding feels chunky in
        // that context. `!`-modifier syntax bypasses the cascade
        // for the override.
        className={`btn-pill flex items-center gap-1.5 !px-3.5 !py-2 text-xs ${
          readOnly ? "!cursor-default" : ""
        }`}
      >
        {!readOnly ? (
          <motion.span
            className="material-symbols-outlined"
            style={{ fontSize: 16 }}
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden
          >
            keyboard_arrow_down
          </motion.span>
        ) : null}
        <span>{label}</span>
      </button>
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && triggerRect ? (
                <motion.div
                  key="access-dropdown"
                  ref={surfaceRef}
                  dir="rtl"
                  role="menu"
                  aria-label="مستوى الوصول"
                  initial={{
                    opacity: 0,
                    y: shouldFlipAbove ? 6 : -6,
                    scale: 0.98,
                  }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    y: shouldFlipAbove ? 6 : -6,
                    scale: 0.98,
                  }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed z-[1200] overflow-hidden rounded-2xl shadow-2xl"
                  style={{ top, bottom, left, width: MENU_WIDTH }}
                >
                  <ul className="flex flex-col p-1.5">
                    {(["view", "comment", "edit"] as const).map((opt) => (
                      <RoleItem
                        key={opt}
                        active={value === opt}
                        label={ROLE_LABEL[opt]}
                        description={ROLE_DESCRIPTION[opt]}
                        onClick={() => {
                          onChange(opt);
                          setOpen(false);
                        }}
                      />
                    ))}
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

function RoleItem({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        className={`dropdown-item flex !items-start gap-2 !py-2 ${
          active ? "!text-white" : ""
        }`}
      >
        <span
          className="material-symbols-outlined mt-0.5"
          style={{ fontSize: 18, opacity: active ? 1 : 0 }}
          aria-hidden
        >
          check
        </span>
        <span className="flex-1 text-start">
          <div className="text-sm">{label}</div>
          <div className="text-[11px] text-white/50">{description}</div>
        </span>
      </button>
    </li>
  );
}
