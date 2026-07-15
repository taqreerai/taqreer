"use client";

// Shared post-auth redirect resolution for the auth pages. `next` is
// user-controlled, so only internal relative paths (one leading slash, never
// "//" or an absolute URL) are honoured to avoid open-redirects; anything else
// falls back to the localized /dashboard. Used by the login + signup email
// flows and GoogleAuthButton so the guard lives in exactly one place.

import { useSearchParams } from "next/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export function useAuthNext(): { nextUrl: string; templateId: string | null } {
  const { locale } = useLocale();
  const searchParams = useSearchParams();

  const rawNext = searchParams.get("next");
  const nextUrl =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : localizedHref("/dashboard", locale);
  const templateId = searchParams.get("template");

  return { nextUrl, templateId };
}
