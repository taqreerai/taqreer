"use client";

// Minimal, non-blocking cookie notice. We use essential cookies + limited
// (masked) diagnostics, so this is an informational notice with an explicit
// Accept / Reject, not a consent wall. The choice persists for a year in
// `tq_cookie_consent` (accept | reject) — either value stops the banner from
// re-showing. Future analytics (PostHog, Phase D) gate on `accept`. Bilingual
// inline copy (it can render on the coming-soon page, outside the
// dictionary-fed app chrome).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

const CONSENT_COOKIE = "tq_cookie_consent";

const COPY = {
  en: {
    text: "We use essential cookies to run taqreer.ai and limited, masked diagnostics to improve it.",
    learn: "Privacy Policy",
    accept: "Accept",
    reject: "Reject",
  },
  ar: {
    text: "نستخدم ملفات تعريف ارتباط أساسية لتشغيل taqreer.ai وأدوات تشخيص محدودة ومُخفّاة لتحسينه.",
    learn: "سياسة الخصوصية",
    accept: "موافقة",
    reject: "رفض",
  },
} as const;

export function CookieBanner() {
  const { locale } = useLocale();
  // Start hidden (no SSR flash / no hydration mismatch); reveal after mount
  // only if the user hasn't chosen yet.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const cookies = document.cookie.split("; ");
    // Either a new accept/reject choice OR a legacy `tq_cookie_ack=1` dismissal
    // counts as decided — don't re-prompt anyone who already responded.
    const decided =
      cookies.some((entry) => entry.startsWith(`${CONSENT_COOKIE}=`)) ||
      cookies.some((entry) => entry === "tq_cookie_ack=1");
    // Cookies are client-only (unreadable during SSR), so the reveal must run
    // after mount rather than in the useState initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!decided) setShow(true);
  }, []);

  if (!show) return null;
  const t = COPY[locale];

  function choose(value: "accept" | "reject") {
    // `secure` only over HTTPS — a `secure` cookie is dropped on plain http,
    // which would break persistence on non-localhost http (prod is HTTPS).
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => choose("reject")}
            className="btn-pill px-4 py-1.5 text-sm"
          >
            {t.reject}
          </button>
          <button
            type="button"
            onClick={() => choose("accept")}
            className="btn-gradient px-4 py-1.5 text-sm"
          >
            {t.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
