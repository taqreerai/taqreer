"use client";

// The sign-up window a signed-out visitor sees on a creation tool's Create
// button (2026-10-06, owner direction). The draft is already saved (the page
// saves before opening this). Since 2026-10-07 it is the /signup page itself:
// the same SignupForm (Google, email, name + password, then the emailed code)
// inside the same `.auth-modal` panel with the same legal fine print, so the
// two never drift apart. The whole sign-up happens here, without leaving the
// tool; on finish a full load of /<flow>?resume=generate restores the setup
// and presses Create by itself. Esc and outside-click close, focus trap,
// scroll lock.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { SignupForm } from "@/components/auth/SignupForm";
import { localizedHref } from "@/lib/i18n/navigation";
import { guestLoginHref, resumePath, type GuestFlow } from "@/lib/create/guest-draft";

export function GuestSignupDialog({
  flow,
  open,
  onClose,
}: {
  flow: GuestFlow;
  open: boolean;
  onClose: () => void;
}) {
  const dict = useDict();
  const { dir, locale } = useLocale();
  const t = dict.flows.guest;
  const legal = dict.auth.legal;
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (typeof window === "undefined") return null;

  const next = resumePath(flow, locale, "generate");

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="guest-signup-dim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="modal-dim fixed inset-0 z-[1000]"
          />
          <div className="pointer-events-none fixed inset-0 z-[1001] flex items-center justify-center p-4">
            <motion.div
              ref={panelRef}
              dir={dir}
              role="dialog"
              aria-modal="true"
              aria-label={t.title}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              // Same panel as the /signup page (auth layout): `.auth-modal`
              // surface, max-w-sm, rounded-3xl, p-7. Scrolls inside on a short
              // screen (step 2 carries the password checklist + captcha).
              className="auth-modal surface-modal pointer-events-auto relative max-h-[calc(100dvh-32px)] w-full max-w-sm overflow-y-auto rounded-3xl p-7"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label={dict.common.close}
                className="absolute end-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  close
                </span>
              </button>

              <SignupForm
                nextUrl={next}
                templateId={null}
                loginHref={guestLoginHref(flow, locale, "generate")}
                googleNextUrl={next}
                hardRedirect
                title={t.title}
              />

              {/* Fine print, as on the /signup page (auth layout). */}
              <p className="mt-6 text-center text-xs text-muted">
                {legal.prefix}
                <Link
                  href={localizedHref("/terms", locale)}
                  className="underline transition-colors hover:text-foreground"
                >
                  {legal.terms}
                </Link>
                {legal.and}
                <Link
                  href={localizedHref("/privacy", locale)}
                  className="underline transition-colors hover:text-foreground"
                >
                  {legal.privacy}
                </Link>
                .
              </p>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
