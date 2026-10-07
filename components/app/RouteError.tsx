"use client";

// Route-level error screen (2026-10-07). Used by the error.tsx files of the
// app's route groups: a crash on a page now shows this INSIDE the dashboard /
// studio chrome (rail, top bar, theme and language stay usable) instead of
// the last-resort global-error page that replaces the whole document.

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export function RouteError({
  error,
  reset,
  where,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  where: string;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  useEffect(() => {
    Sentry.withScope((scope) => {
      scope.setTag("boundary", `route:${where}`);
      Sentry.captureException(error);
    });
    posthog.capture("route_error_shown", { where, message: error.message?.slice(0, 200) });
  }, [error, where]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-2xl text-foreground">{dict.globalError.title}</h2>
      <p className="text-muted">{dict.globalError.subtitle}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={reset} className="btn-gradient cursor-pointer px-6 py-3 text-base">
          {dict.globalError.retry}
        </button>
        <Link href={localizedHref("/dashboard", locale)} className="btn-pill px-6 py-3 text-base no-underline">
          {dict.nav.home}
        </Link>
      </div>
    </div>
  );
}
