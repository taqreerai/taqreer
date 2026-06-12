"use client";

// Compact avatar button + dropdown for surfaces OUTSIDE the dashboard
// rail (first consumer: the studio header strip, 2026-06-12). The
// Sidebar's full profile menu stays the dashboard's primary menu; this
// one carries only the navigation core - Home, Settings, Billing, Sign
// out - because theme / language / bell already live in the utility
// strip next to it.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";

export function UserMenu() {
  const dict = useDict();
  const { locale } = useLocale();
  const router = useRouter();
  const { user, avatarUrl, name, email } = useUser();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    await createClient().auth.signOut();
    router.push(localizedHref("/login", locale));
  };

  if (!user) return null;
  const displayName = name || email?.split("@")[0] || "User";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={displayName}
        className="block h-8 w-8 overflow-hidden rounded-full transition-transform hover:scale-105"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            className="tq-avatar-fallback flex h-8 w-8 items-center justify-center rounded-full text-xs"
            style={{
              backgroundImage: avatarGradientForSeed(user.id ?? email ?? displayName),
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="surface-menu absolute end-0 top-10 z-50 w-56 rounded-xl p-1.5"
          >
            <div className="px-3 pb-2 pt-1.5">
              <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted">{email}</p>
            </div>
            <div className="divider-dark my-1" />
            <Link
              href={localizedHref("/dashboard", locale)}
              onClick={() => setOpen(false)}
              className="dropdown-item"
            >
              <span className="material-symbols-outlined text-[18px]">home</span>
              <span>{dict.nav.home}</span>
            </Link>
            <Link
              href={localizedHref("/billing", locale)}
              onClick={() => setOpen(false)}
              className="dropdown-item"
            >
              <span className="material-symbols-outlined text-[18px]">credit_card</span>
              <span>{dict.profileMenu.billing}</span>
            </Link>
            <Link
              href={localizedHref("/settings", locale)}
              onClick={() => setOpen(false)}
              className="dropdown-item"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
              <span>{dict.profileMenu.settings}</span>
            </Link>
            <button type="button" onClick={handleLogout} className="dropdown-item w-full">
              <span className="material-symbols-outlined text-[18px]">logout</span>
              <span>{dict.profileMenu.signOut}</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
