// Locale-aware date helpers — so dates follow the UI locale instead of being
// hardcoded to Arabic. Two flavours, because the app uses two date libraries:
//   • date-fns (format / formatDistanceToNow) → needs a date-fns Locale object.
//   • Intl.* (RelativeTimeFormat / toLocaleString) → needs a BCP-47 tag.
// See [[project_bilingual_lang_migration]]: chrome follows the UI locale.

import { ar, enUS } from "date-fns/locale";
import type { Locale } from "./config";

// date-fns Locale object for a UI locale. date-fns has no bare `en`; `enUS` is
// its default English locale. Pass as `{ locale: dateFnsLocale(locale) }`.
export function dateFnsLocale(locale: Locale) {
  return locale === "ar" ? ar : enUS;
}

// BCP-47 tag for Intl.* APIs. `-u-nu-latn` forces Latin digits in Arabic
// (house rule: Latin numerals only, never Arabic-Indic) while keeping Arabic
// words + month names. See [[feedback_latin_numerals_only]].
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en";
}
