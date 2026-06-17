"use client";

// Minimal, non-blocking cookie notice. We use essential cookies + limited
// (masked) diagnostics, so this is an informational notice with an explicit
// Accept / Reject, not a consent wall. The choice persists for a year in
// `tq_cookie_consent` (accept | reject); either value stops the banner from
// re-showing. The SERVER layout resolves whether the user has decided (this
// cookie or the legacy `tq_cookie_ack`) and passes `initialDecided`, so there's
// no first-paint flip and no client-side cookie parsing. Future analytics
// (PostHog, Phase D) gate on `accept`. Bilingual inline copy (it can render on
// the coming-soon page, outside the dictionary-fed app chrome).

import { useState } from "react";
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

export function CookieBanner({
  // Resolved on the SERVER (the cookie or the legacy `tq_cookie_ack`): undecided
  // users see the banner from first paint, decided users never do.
  initialDecided = false,
}: {
  initialDecided?: boolean;
}) {
  const { locale } = useLocale();
  const [show, setShow] = useState(!initialDecided);

  if (!show) return null;
  const t = COPY[locale];

  function choose(value: "accept" | "reject") {
    // `secure` only over HTTPS — a `secure` cookie is dropped on plain http,
    // which would break persistence on non-localhost http (prod is HTTPS).
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
    setShow(false);
    // Let the PostHogProvider boot analytics immediately on accept (no reload).
    if (value === "accept") {
      window.dispatchEvent(new CustomEvent("taqreer:cookie-consent-accept"));
    }
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
