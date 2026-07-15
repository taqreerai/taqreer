"use client";

// Shared modal for the admin console (portal + dim + surface-modal). The app's
// other dialogs are bespoke per-feature confirms, so this is the one generic
// modal the admin screens reuse. English/LTR, dark-only.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

export function AdminModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="modal-dim fixed inset-0 z-[1200]" onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 z-[1201] flex items-start justify-center p-4">
        <div
          ref={panelRef}
          dir="ltr"
          className="surface-modal pointer-events-auto mt-[18vh] w-full max-w-md rounded-2xl p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3
            className="mb-4 text-lg font-bold"
            style={{ color: "var(--tq-text-primary)" }}
          >
            {title}
          </h3>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
