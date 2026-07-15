"use client";

// Reusable focus trap for modal dialogs. Given the dialog panel's ref and its
// open state, it:
//   - moves focus INTO the panel when it opens (first focusable, else the panel
//     itself so screen readers land on the dialog),
//   - cycles Tab / Shift+Tab within the panel (background controls stay
//     unreachable while the dialog is open),
//   - restores focus to the previously-focused element (the trigger) on close.
//
// It deliberately does NOT own Esc-to-close or the body-scroll lock — the
// dialogs already implement those; this hook only manages focus. Usage: put a
// ref on the panel element (the `surface-modal` div) and pass it here with the
// same `open` boolean the dialog renders on.

import { useEffect, type RefObject } from "react";

// Elements that can take keyboard focus. `:not([tabindex="-1"])` excludes
// programmatically-unfocusable nodes; `:not([disabled])` excludes disabled ones.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    // Visible only. display:none / visibility:hidden yield no client rects;
    // offsetParent is unreliable inside position:fixed, which the panels use.
    (el) => el.getClientRects().length > 0,
  );
}

export function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    // Remember what was focused so we can restore it (the trigger) on close.
    const restoreTo = document.activeElement as HTMLElement | null;

    // Move focus inside. If nothing is focusable yet, focus the panel itself so
    // Tab has an anchor and the dialog is announced.
    const initial = focusableWithin(panel)[0];
    if (initial) {
      initial.focus();
    } else {
      panel.setAttribute("tabindex", "-1");
      panel.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableWithin(panel);
      if (items.length === 0) {
        // Nothing focusable: pin focus to the panel, never let Tab escape.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      // Wrap at both ends, and pull focus back if it somehow left the panel.
      if (e.shiftKey) {
        if (activeEl === first || !panel.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !panel.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the trigger if it is still in the document.
      if (
        restoreTo &&
        restoreTo.isConnected &&
        typeof restoreTo.focus === "function"
      ) {
        restoreTo.focus();
      }
    };
  }, [panelRef, open]);
}
