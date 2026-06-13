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
    text: "We use essential cookies to run taqreer.ai and limited, masked diagnostics to improve it.",
    learn: "Privacy Policy",
    ok: "Got it",
  },
  ar: {
    text: "نستخدم ملفات تعريف ارتباط أساسية لتشغيل taqreer.ai وأدوات تشخيص محدودة ومُخفّاة لتحسينه.",
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
    // Exact pair match (not a substring `includes`, which another cookie
    // happening to contain "tq_cookie_ack=1" could falsely satisfy).
    const acked = document.cookie
      .split("; ")
      .some((entry) => entry === "tq_cookie_ack=1");
    if (!acked) setShow(true);
  }, []);

  if (!show) return null;
  const t = COPY[locale];

  function dismiss() {
    // `secure` only over HTTPS — a `secure` cookie is dropped on plain http,
    // which would break dismissal on non-localhost http (prod is HTTPS).
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `tq_cookie_ack=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
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
