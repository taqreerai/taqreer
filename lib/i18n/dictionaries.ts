import "server-only";
import { notFound } from "next/navigation";
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
  // An un-narrowed / invalid locale reaching here is a 404, not a 500: bot
  // scanners hitting /xxx.php fall through to the [lang] segment, and the
  // landing page / generateMetadata call getDictionary with that junk segment
  // BEFORE the layout's own isLocale guard runs. notFound() is a Next
  // control-flow signal (the SDK ignores it), so these stop generating Sentry
  // noise - and the cast below no longer risks calling `undefined()`.
  if (!(locale in dictionaries)) {
    notFound();
  }
  return dictionaries[locale]() as Promise<Dictionary>;
}
