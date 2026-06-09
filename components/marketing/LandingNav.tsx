"use client";

// Landing top nav — "smart" reveal bar, modeled on ventriloc.ca:
//   • ALWAYS fixed (one element, no position swapping → no glitch at the top).
//   • Scrolling DOWN past the bar: slides UP out of view (translateY -100%,
//     ease-in). Transparent the whole way (bg is gated off), so no flash.
//   • Scrolling UP: slides back DOWN into view (translateY 0, ease-out) WITH a
//     dim dark background.
//   • Near the top: the background fades to 0 and the bar rests, transparent.

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";

const NAV_H = 80; // h-20 — stay shown within the first nav-height of scroll.

export function LandingNav({ isAuthed }: { isAuthed: boolean }) {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;
    if (latest <= NAV_H)
      setHidden(false); // at/near the top → shown (transparent)
    else if (latest > previous)
      setHidden(true); // scrolling down → slide up out of view
    else setHidden(false); // scrolling up → slide down into view
  });

  // Dim ramps in just below the fold (so the first nav-height stays fully
  // transparent and there's no flash on the way down), and fades back out as
  // the user returns toward the top.
  const dim = useTransform(scrollY, [NAV_H, NAV_H + 90], [0, 0.9]);

  return (
    <motion.nav
      animate={{ y: hidden ? "-100%" : "0%" }}
      // ease-in while hiding (ventriloc's curve), ease-out while revealing.
      transition={{
        duration: 0.4,
        ease: hidden ? [0.55, 0.085, 0.68, 0.53] : [0.25, 0.46, 0.45, 0.94],
      }}
      className="fixed top-0 right-0 left-0 z-50"
    >
      {/* Dim backdrop — only while the bar is on-screen and scrolled; gated to 0
          when hidden so it never shows while sliding away on scroll-down. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ opacity: hidden ? 0 : dim, backgroundColor: "var(--tq-bg)" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative flex h-20 items-center justify-between">
          <a className="flex flex-shrink-0 items-center gap-2" href="#">
            <Image
              src="/logo-light.svg"
              alt="Taqreer Logo"
              width={140}
              height={32}
              className="h-8 w-auto object-contain"
            />
          </a>

          <div className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:flex">
            <a
              className="cursor-pointer text-sm text-muted transition-colors hover:text-white"
              href="#"
            >
              الرئيسية
            </a>
            <a
              className="cursor-pointer text-sm text-muted transition-colors hover:text-white"
              href="#features"
            >
              المميزات
            </a>
            <a
              className="cursor-pointer text-sm text-muted transition-colors hover:text-white"
              href="#pricing"
            >
              الأسعار
            </a>
            <a
              className="cursor-pointer text-sm text-muted transition-colors hover:text-white"
              href="#templates"
            >
              القوالب
            </a>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            {isAuthed ? (
              <Link href="/dashboard" className="btn-gradient px-5 py-2 text-xs">
                لوحة التحكم
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-pill px-4 py-2 text-xs">
                  تسجيل الدخول
                </Link>
                <Link href="/signup" className="btn-gradient px-5 py-2 text-xs">
                  إنشاء حساب
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
