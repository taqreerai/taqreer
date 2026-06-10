// Bilingual UI config — the CHROME direction axis only.
//
// Two independent direction axes exist in this app (see the bilingual brief):
//   • Chrome direction  → parent <html dir>, driven by the UI locale below.
//   • Canvas direction  → the slide iframe's <html dir>, driven by the deck's
//                          manifest.direction. NEVER derive the canvas direction
//                          from this file — an English user editing an Arabic deck
//                          must get LTR chrome around an RTL canvas.
//
// Locale codes match the manifest enum ("ar" | "en") so nothing has to translate
// between a UI-locale vocabulary and a deck-language vocabulary.

export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

// Arabic-first product → Arabic is the default for anonymous / brand-new users
// (Phase-0 decision, 2026-06-10).
export const defaultLocale: Locale = "ar";

// Cookie the proxy reads and the language switcher writes, so a chosen UI
// language persists per-browser. Account-level persistence (Phase 5) layers on
// top of this — the cookie stays the fast path.
export const LOCALE_COOKIE = "tq_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}

// Chrome direction for a UI locale. Keep this the ONLY place chrome dir is
// decided, so adding a locale is a one-line change here.
export function dirForLocale(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
