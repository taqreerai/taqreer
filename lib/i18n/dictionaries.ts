import "server-only";
import type { Locale } from "./config";

// Server-only dictionary loader (Next.js i18n pattern). Each locale's JSON is a
// dynamic import so a request only ships the dictionary it needs. Because layouts
// and pages are Server Components, the translation files never reach the client
// bundle — only the resolved strings do (carried into client components via
// <LocaleProvider>).
const dictionaries = {
  ar: () => import("@/dictionaries/ar.json").then((m) => m.default),
  en: () => import("@/dictionaries/en.json").then((m) => m.default),
};

// The dictionary shape is the English file's — the reference. ar.json must stay
// structurally identical; the no-literal-string lint (Phase 2) + this single type
// keep the two in lockstep.
export type Dictionary = Awaited<ReturnType<(typeof dictionaries)["en"]>>;

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  // Runtime guard for an un-narrowed value reaching here — the cast below would
  // otherwise call `undefined()` and throw an opaque error for a bad locale.
  if (!(locale in dictionaries)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  return dictionaries[locale]() as Promise<Dictionary>;
}
