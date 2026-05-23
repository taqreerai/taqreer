// Compact Arabic relative-time formatter.
//
// Returns strings like:
//   • منذ ثانية / منذ 5 ثوانٍ
//   • منذ دقيقة / منذ 3 دقائق
//   • منذ ساعة / منذ ساعتين
//   • منذ يوم / منذ 4 أيام
//   • Beyond ~30 days: short date stamp ("12 ديسمبر 2026") because
//     "منذ شهرين" reads weirder than an absolute date and ages out
//     of "recent" mentally.
//
// `Intl.RelativeTimeFormat("ar", { numeric: "auto" })` handles the
// dual / plural forms for us — no manual zero/one/two/many tables
// to maintain. Consumed by CommentsPanel rows AND the read-only
// MarkerPreviewPopup in HeroCommentOverlay; both render the same
// shape, so the formatter lives outside either component to keep
// the wording locked across consumers.

/**
 * Format an ISO timestamp as a localized Arabic relative-time string.
 *
 * Returns empty string for non-finite / malformed inputs so callers
 * can safely render the result inline without a fallback check.
 */
export function formatRelativeArabic(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  if (absSec < 60) return rtf.format(diffSec, "second");
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (absSec < 86_400 * 30) {
    return rtf.format(Math.round(diffSec / 86_400), "day");
  }
  // Beyond a month: absolute date is clearer than "منذ X شهراً".
  return new Date(iso).toLocaleDateString("ar", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
