"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

// global-error REPLACES the root layout when the layout itself crashes, so it
// renders its own <html> and lives OUTSIDE <LocaleProvider> — it can't use the
// dictionary. It reads the locale cookie client-side instead, with a tiny inline
// bilingual map (defaulting to Arabic) so this last-resort page still respects
// the user's chosen language.
const STRINGS = {
  ar: {
    title: "حدث خطأ غير متوقع",
    subtitle: "تم إبلاغ فريقنا تلقائياً",
    retry: "حاول مجدداً",
  },
  en: {
    title: "Something went wrong",
    subtitle: "Our team has been notified automatically",
    retry: "Try again",
  },
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Derive the locale from the cookie in the initializer (not a mount effect) so
  // the error page renders once with the right language — avoids the
  // react-hooks/set-state-in-effect cascade.
  const [locale] = useState<"ar" | "en">(() => {
    if (typeof document === "undefined") return "ar";
    const m = document.cookie.match(/(?:^|; )tq_locale=(ar|en)\b/);
    return m?.[1] === "en" ? "en" : "ar";
  });

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const t = STRINGS[locale];

  return (
    <html dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <body className="page-container flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--tq-bg)] text-foreground font-cairo">
        <h2 className="text-2xl">{t.title}</h2>
        <p className="text-muted">{t.subtitle}</p>
        <button
          onClick={reset}
          className="rounded-lg bg-[var(--tq-blue)] px-6 py-3 text-base text-foreground cursor-pointer"
        >
          {t.retry}
        </button>
      </body>
    </html>
  );
}
