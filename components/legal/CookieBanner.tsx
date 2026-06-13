"use client";

// Minimal, non-blocking cookie notice. We use essential cookies + limited
// (masked) diagnostics, so this is an informational notice with a single
// dismiss, not a consent wall. Sets `tq_cookie_ack` for a year on dismiss.
// Bilingual inline copy (it can render on the coming-soon page, outside the
// dictionary-fed app chrome).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

const COPY = {
  en: {
    text: "We use essential cookies to run Taqreer and limited, masked diagnostics to improve it.",
    learn: "Privacy Policy",
    ok: "Got it",
  },
  ar: {
    text: "نستخدم ملفات تعريف ارتباط أساسية لتشغيل تقرير وأدوات تشخيص محدودة ومُخفّاة لتحسينه.",
    learn: "سياسة الخصوصية",
    ok: "حسناً",
  },
} as const;

export function CookieBanner() {
  const { locale } = useLocale();
  // Start hidden (no SSR flash / no hydration mismatch); reveal after mount
  // only if the user hasn't acknowledged yet.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!document.cookie.includes("tq_cookie_ack=1")) setShow(true);
  }, []);

  if (!show) return null;
  const t = COPY[locale];

  function dismiss() {
    document.cookie = `tq_cookie_ack=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setShow(false);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1300] flex justify-center p-3">
      <div className="surface-card pointer-events-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-sm">
        <p className="min-w-0 flex-1 text-muted">
          {t.text}{" "}
          <Link
            href={localizedHref("/privacy", locale)}
            className="text-foreground underline underline-offset-2"
          >
            {t.learn}
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="btn-pill shrink-0 px-4 py-1.5 text-sm"
        >
          {t.ok}
        </button>
      </div>
    </div>
  );
}
