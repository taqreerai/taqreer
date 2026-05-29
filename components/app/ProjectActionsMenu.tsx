"use client";

// Per-tile actions menu opened from the 3-dots button on a
// ProjectThumbnail. Seven items (RTL order):
//
//   1. Share          — opens placeholder modal (filled in step 15)
//   2. Rename         — switches the tile into inline-edit mode
//   3. Favorites      — toggles Project.isFavorite (PATCH /favorite)
//   4. Copy link      — copies /preview/<id> to clipboard
//   5. Use as template— navigates to /use-template/project/<id>: mimic
//                       this project's design now (renders its deck to
//                       PDF + mints the Anthropic reference on the fly;
//                       nothing is saved).
//   6. Save as template — parent opens SaveAsTemplateDialog; the modal
//                       handles preview + isPublic toggle + POST
//                       /api/projects/<id>/save-as-template.
//   7. Send to trash  — destructive; parent opens TrashConfirmDialog
//
// Anchoring + open/close mirror HistoryPopover.tsx (which mirrors
// BellDropdown.tsx): portal'd .glass-popover, position derived from
// the trigger's DOMRect, closes on outside-click + Esc. The trigger
// is tagged `data-project-menu-trigger` so its own click doesn't get
// captured by the outside-click handler — without that exclusion,
// mousedown closes the menu and the subsequent click re-opens it
// (same bug we just fixed on HistoryPopover).

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

const MENU_WIDTH = 240;
// Approximate menu height — 7 items × ~38 px + divider + 12 px
// vertical padding ≈ 320 px. Used only as a conservative threshold
// for "would the menu overflow the bottom of the viewport" → flip
// above; the actual height is determined by the popover at render
// time. When flipping, we anchor with `bottom` rather than computing
// a `top` from this estimate (see `top`/`bottom` derivation below) —
// so even if this constant is off by a few pixels the menu remains
// pinned to the trigger's top edge, never cropped. Bumped from
// 260 → 320 on 2026-05-22 after a CR flagged the stale value.
const MENU_HEIGHT_ESTIMATE_PX = 320;
// Distance from the trigger button. Matches HistoryPopover's
// ANCHOR_GAP_PX so menus across the app feel like one family.
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

export type ProjectActionsMenuActions = {
  onShare?: () => void;
  onRename?: () => void;
  onToggleFavorite?: () => void;
  onCopyLink?: () => void;
  // "Use as a template" — mimic this project's design now. Navigates to
  // /use-template/project/[id] (the forked Mimic flow), which renders
  // the project's deck to a PDF + mints the Anthropic reference on the
  // fly. Nothing is persisted.
  onUseAsTemplate?: () => void;
  // "Save as a template" — parent opens SaveAsTemplateDialog (preview +
  // public/private + POST save-as-template). Lands on the templates page.
  onSaveAsTemplate?: () => void;
  onSendToTrash?: () => void;
};

export function ProjectActionsMenu({
  open,
  triggerRect,
  projectId,
  isFavorite,
  onClose,
  onShare,
  onRename,
  onToggleFavorite,
  onCopyLink,
  onUseAsTemplate,
  onSaveAsTemplate,
  onSendToTrash,
  onExitComplete,
}: {
  open: boolean;
  triggerRect: DOMRect | null;
  // Identifies WHICH tile owns this menu so the outside-click
  // handler can tell its OWN trigger (legitimate toggle, ignore)
  // apart from ANOTHER tile's trigger (genuine outside-click,
  // close). Stamped on the trigger as data-project-menu-trigger.
  projectId: string;
  isFavorite: boolean;
  onClose: () => void;
  // Fires once AnimatePresence finishes exiting. Parent uses this
  // to release any "menu is open" latch (none on the tile yet, but
  // matching HistoryPopover's contract keeps swapping cheap if we
  // need it later).
  onExitComplete?: () => void;
} & ProjectActionsMenuActions) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Outside click + Esc to close. The OWN trigger is excluded so
  // clicking it again toggles via the parent rather than instantly
  // reopening (see HistoryPopover for the bug this avoids). The
  // exclusion was previously selector-only (`closest('[data-…]')`)
  // which matched ANY tile's trigger — meaning clicking tile B's
  // 3-dots while tile A's menu was open did not close tile A. We
  // now compare the trigger's data value against THIS menu's
  // projectId, so other tiles' triggers count as genuine outside
  // clicks and trigger a close (their own click handler then opens
  // their menu on the same gesture).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      const trigger = target.closest?.(
        "[data-project-menu-trigger]",
      ) as HTMLElement | null;
      if (trigger?.dataset.projectMenuTrigger === projectId) return;
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
  }, [open, onClose, projectId]);

  if (typeof document === "undefined") return null;

  // Right-anchored under the trigger (same pattern as HistoryPopover):
  // the menu's right edge lines up with the trigger's right edge so
  // it drops "down and to the left", which reads naturally in RTL
  // where the 3-dots sit at the tile's visual-left corner. The
  // clamp keeps the menu inside the viewport at narrow widths.
  const left = triggerRect
    ? Math.max(
        VIEWPORT_EDGE_INSET_PX,
        Math.min(
          triggerRect.right - MENU_WIDTH,
          window.innerWidth - MENU_WIDTH - VIEWPORT_EDGE_INSET_PX,
        ),
      )
    : 0;
  // Vertical placement — default below the trigger; flip above when
  // there isn't enough viewport room below (e.g. bottom-row tiles on
  // the /projects grid would otherwise have the menu cropped under
  // the browser chrome, hiding the destructive "send to trash"
  // action). User-reported 2026-05-22. The MENU_HEIGHT_ESTIMATE
  // is a conservative ~260 px — slight over-estimate is harmless,
  // we just flip a few pixels earlier than strictly needed.
  const shouldFlipAbove = !!(
    triggerRect &&
    triggerRect.bottom + ANCHOR_GAP_PX + MENU_HEIGHT_ESTIMATE_PX >
      window.innerHeight &&
    // Only flip if there's room ABOVE — otherwise stick with below
    // (the clamp at the viewport edge will at least keep the top of
    // the menu visible).
    triggerRect.top - ANCHOR_GAP_PX - MENU_HEIGHT_ESTIMATE_PX >= 0
  );
  // Position the menu against the trigger:
  //   • below (default): anchor `top` to the trigger's bottom edge,
  //     `bottom` undefined. Menu grows downward.
  //   • above (flipped):  anchor `bottom` to the trigger's top edge,
  //     `top` undefined. Menu grows upward — pinned to the trigger,
  //     so the height estimate doesn't need to be exact (any
  //     additional rows just push the menu's TOP further up, never
  //     past the trigger).
  // The CR finding 2026-05-22 — anchoring `top` via the height estimate
  // could leave the menu's bottom partially off-screen when the menu
  // had more rows than the estimate predicted.
  const top =
    triggerRect && !shouldFlipAbove
      ? triggerRect.bottom + ANCHOR_GAP_PX
      : undefined;
  const bottom =
    triggerRect && shouldFlipAbove
      ? window.innerHeight - triggerRect.top + ANCHOR_GAP_PX
      : undefined;

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && triggerRect ? (
        <motion.div
          key="project-actions-menu"
          ref={surfaceRef}
          dir="rtl"
          role="menu"
          aria-label="خيارات المشروع"
          // Animation origin flips to match the menu's position:
          // when anchored ABOVE the trigger, the menu slides UP from
          // a y-offset of +6; when anchored BELOW, it slides DOWN
          // from -6. Otherwise the entry feels like it's swimming
          // against the layout when the menu is above.
          initial={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: shouldFlipAbove ? 6 : -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="glass-popover backdrop-blur-glass backdrop-saturate-(--glass-saturation) fixed z-[1100] overflow-hidden rounded-2xl shadow-2xl"
          style={{ top, bottom, left, width: MENU_WIDTH }}
        >
          <ul className="flex flex-col p-1.5">
            <MenuItem
              icon="share"
              label="مشاركة"
              onClick={onShare}
              closeAfter
              onClose={onClose}
            />
            <MenuItem
              icon="edit"
              label="إعادة تسمية"
              onClick={onRename}
              closeAfter
              onClose={onClose}
            />
            <MenuItem
              icon={isFavorite ? "star" : "star_outline"}
              iconFilled={isFavorite}
              label={isFavorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
              onClick={onToggleFavorite}
              closeAfter
              onClose={onClose}
            />
            <MenuItem
              icon="link"
              label="نسخ الرابط"
              onClick={onCopyLink}
              closeAfter
              onClose={onClose}
            />
            {/* "Use as a template" — mimic this project now. Navigates
                to /use-template/project/[id] (forked Mimic flow). */}
            <MenuItem
              icon="auto_awesome"
              label="استخدام كقالب"
              onClick={onUseAsTemplate}
              closeAfter
              onClose={onClose}
            />
            {/* "Save as a template" — opens SaveAsTemplateDialog via the
                parent's onSaveAsTemplate handler. The modal fetches
                /template-preview, renders the live brand preview, then
                POSTs save-as-template on confirm. */}
            <MenuItem
              icon="bookmark_add"
              label="حفظ كقالب"
              onClick={onSaveAsTemplate}
              closeAfter
              onClose={onClose}
            />
            {/* Divider before the destructive action so the row
                reads as visually separated from the rest. */}
            <li
              aria-hidden
              className="my-1 h-px bg-white/[0.08]"
            />
            <MenuItem
              icon="delete"
              label="نقل إلى المهملات"
              destructive
              onClick={onSendToTrash}
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

function MenuItem({
  icon,
  iconFilled,
  label,
  onClick,
  disabled,
  destructive,
  closeAfter,
  onClose,
}: {
  icon: string;
  // Optional. Forces the Material Symbols FILL axis to 1 for this
  // icon (the global rule sets FILL=0, so even glyph names like
  // `star` render as outlines without this). Used for the favorite
  // item when the project is starred — visual reinforcement that
  // the toggle is in the "ON" state.
  iconFilled?: boolean;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  // Most items dismiss the menu the moment they fire — but the
  // close callback is owned by the parent (the menu doesn't
  // know its own open state). Setting `closeAfter` + passing
  // `onClose` keeps the dismiss/fire pair atomic.
  closeAfter?: boolean;
  onClose?: () => void;
}) {
  // `.dropdown-item` provides the row layout (icon gap, padding,
  // muted → primary on hover, no border). Destructive variant
  // re-paints icon + label red; hover background tints red too.
  // Disabled keeps the muted resting state and blocks interaction.
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
          style={{
            fontSize: 18,
            ...(iconFilled
              ? { fontVariationSettings: '"FILL" 1' }
              : null),
          }}
          aria-hidden
        >
          {icon}
        </span>
        <span className="flex-1 text-start">{label}</span>
      </button>
    </li>
  );
}
