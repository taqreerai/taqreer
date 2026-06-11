// Compact, locale-aware relative-time formatter.
//
// Returns strings like (ar / en):
//   • منذ ثانية / a second ago
//   • منذ 3 دقائق / 3 minutes ago
//   • منذ ساعتين / 2 hours ago
//   • منذ 4 أيام / 4 days ago
//   • Beyond ~30 days: short date stamp ("12 ديسمبر 2026" / "Dec 12, 2026")
//     because "2 months ago" reads weirder than an absolute date and ages
//     out of "recent" mentally.
//
// `Intl.RelativeTimeFormat(tag, { numeric: "auto" })` handles the dual /
// plural forms for us — no manual zero/one/two/many tables to maintain.
// Consumed by CommentsPanel rows AND the read-only MarkerPreviewPopup in
// HeroCommentOverlay; both render the same shape, so the formatter lives
// outside either component to keep the wording locked across consumers.

import { intlLocale } from "@/lib/i18n/date";
import type { Locale } from "@/lib/i18n/config";

/**
 * Format an ISO timestamp as a localized relative-time string in the active
 * UI locale (Arabic keeps Latin digits via the `-u-nu-latn` tag).
 *
 * Returns empty string for non-finite / malformed inputs so callers
 * can safely render the result inline without a fallback check.
 */
export function formatRelativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const now = Date.now();
  // `Math.trunc` (not `Math.round`) on every divide so the unit
  // boundary thresholds in the if-chain below match the rounded
  // value being formatted. With `Math.round`, a half-second value
  // near a boundary (e.g. diff = 59.5s) could round to 60 and roll
  // the unit one step early — and the rollover behavior is sign-
  // dependent, so "in 59 seconds" and "59 seconds ago" produced
  // different strings near the threshold. Truncating toward zero
  // collapses both directions to a stable threshold (CR PR #33,
  // 2026-05-24).
  const diffSec = (then - now) / 1000;
  const absSec = Math.abs(diffSec);

  const tag = intlLocale(locale);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (absSec < 60) return rtf.format(Math.trunc(diffSec), "second");
  if (absSec < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (absSec < 86_400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (absSec < 86_400 * 30) {
    return rtf.format(Math.trunc(diffSec / 86_400), "day");
  }
  // Beyond a month: absolute date is clearer than "X months ago".
  return new Date(iso).toLocaleDateString(tag, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
