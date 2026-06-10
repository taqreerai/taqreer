"use client";

// Carries the active UI locale + its resolved dictionary into client components.
// Seeded once by the root layout (a Server Component that loads the dictionary),
// so client chrome reads strings via useDict() without any per-component fetch.
//
// This is the CHROME locale only. The slide canvas direction is independent and
// comes from the deck (manifest.direction) — never read this provider to direct
// the canvas. See the bilingual brief / lib/i18n/config.ts.
import { createContext, useContext } from "react";
import { dirForLocale, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type LocaleContextValue = { locale: Locale; dict: Dictionary };

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  dict,
  children,
}: LocaleContextValue & { children: React.ReactNode }) {
  return (
    <LocaleContext.Provider value={{ locale, dict }}>
      {children}
    </LocaleContext.Provider>
  );
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale/useDict must be used inside <LocaleProvider>");
  }
  return ctx;
}

// The active UI locale + its chrome direction.
export function useLocale(): { locale: Locale; dir: "rtl" | "ltr" } {
  const { locale } = useLocaleContext();
  return { locale, dir: dirForLocale(locale) };
}

// The resolved chrome dictionary for the active locale.
export function useDict(): Dictionary {
  return useLocaleContext().dict;
}
