"use client";

// The sign-up window a signed-out visitor sees on /create's Create button
// (2026-10-06, owner direction). The draft is already saved (the page saves
// before opening this), so both paths come back to /<flow>?resume=generate,
// where the page restores the setup and presses Create by itself. Same
// dialog shell as SlideCapUpsellDialog (modal-dim + surface-modal, Esc and
// outside-click close, focus trap, scroll lock). Google signs in right here;
// email goes through the normal /signup page (confirmation link included).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import {
  guestLoginHref,
  guestSignupHref,
  resumePath,
  type GuestFlow,
} from "@/lib/create/guest-draft";

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
              aria-labelledby="guest-signup-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal pointer-events-auto relative flex w-[min(100vw-24px,420px)] flex-col items-center gap-4 rounded-2xl px-6 pb-6 pt-8 text-center"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label={dict.common.close}
                className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  close
                </span>
              </button>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--tq-brand-blue)]/15 text-[var(--tq-brand-blue)]">
                <span className="material-symbols-outlined" style={{ fontSize: 26 }} aria-hidden>
                  auto_awesome
                </span>
              </span>
              <div className="flex flex-col gap-1.5">
                <h2 id="guest-signup-title" className="text-lg font-semibold text-foreground">
                  {t.title}
                </h2>
                <p className="text-sm leading-6 text-foreground/65">{t.body}</p>
              </div>

              <div className="flex w-full flex-col gap-2.5">
                <GoogleAuthButton
                  nextUrl={resumePath(flow, locale, "generate")}
                  disabled={busy}
                  onBusyChange={setBusy}
                  onError={setError}
                />
                <div className="flex items-center gap-2 text-[11px] text-foreground/40">
                  <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                  <span>{dict.flows.or}</span>
                  <div className="h-px flex-1 bg-[var(--tq-border-hairline)]" />
                </div>
                <Link
                  href={guestSignupHref(flow, locale, "generate")}
                  className="btn-gradient flex h-11 items-center justify-center gap-2 text-sm font-medium"
                  style={{ borderRadius: 9999 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                    mail
                  </span>
                  {t.email}
                </Link>
              </div>

              {error ? (
                <p className="text-xs text-red-400" role="alert">
                  {error}
                </p>
              ) : null}

              <p className="flex items-center gap-1.5 text-xs text-foreground/50">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>
                  check_circle
                </span>
                {t.saved}
              </p>
              <p className="text-xs text-foreground/60">
                {t.haveAccount}{" "}
                <Link
                  href={guestLoginHref(flow, locale, "generate")}
                  className="font-semibold text-[var(--tq-brand-blue)] hover:underline"
                >
                  {t.login}
                </Link>
              </p>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
