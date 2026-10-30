// Two endless rows of featured template covers under the hero (they replaced
// the trusted-by logos, owner 2026-10-30): Arabic covers drift right to left,
// the other languages drift left to right underneath. Full-bleed with the
// `.mask-edges` fade; hovering a row pauses it, a cover opens its template
// page. Server component, pure CSS motion (`.cover-row-*` in globals.css).
/* eslint-disable @next/next/no-img-element -- covers are /tpl edge-proxied storage URLs; next/image's optimization doesn't apply */

import { localizedHref } from "@/lib/i18n/navigation";
import type { LandingCover } from "@/lib/auth/marquee-projects";

// Each half of the loop holds at least this many tiles (short rows repeat
// their covers) so one half is always wider than the widest screen and the
// -50% loop never shows a gap.
const MIN_TILES = 10;
// Seconds per tile: the loop's duration scales with its length so both rows
// drift at the same slow speed whatever their cover count.
const SECONDS_PER_TILE = 8;

function CoverRow({
  covers,
  direction,
  locale,
  fallbackAlt,
}: {
  covers: LandingCover[];
  direction: "rtl" | "ltr";
  locale: "ar" | "en";
  fallbackAlt: string;
}) {
  const repeat = Math.ceil(MIN_TILES / covers.length);
  const half = Array.from({ length: repeat }, () => covers).flat();

  return (
    <div
      className={`cover-row-${direction} pause-on-hover flex w-max`}
      style={{ animationDuration: `${half.length * SECONDS_PER_TILE}s` }}
    >
      {/* Two identical halves; the second is decorative (hidden from
          assistive tech and the tab order) so each cover is reachable once. */}
      {[0, 1].map((copy) =>
        half.map((c, i) => {
          const name = locale === "ar" ? c.nameAr ?? c.nameEn : c.nameEn ?? c.nameAr;
          const hidden = copy === 1 || i >= covers.length;
          return (
            <a
              key={`${copy}-${i}-${c.id}`}
              href={localizedHref(
                c.slug ? `/presentation-templates/${c.slug}` : "/presentation-templates",
                locale,
              )}
              aria-hidden={hidden || undefined}
              tabIndex={hidden ? -1 : undefined}
              className="tq-thumbnail group me-4 block aspect-video w-[200px] shrink-0 overflow-hidden rounded-[14px] border border-[var(--tq-border-hairline)] sm:w-[260px] lg:w-[300px]"
            >
              <img
                alt={hidden ? "" : name ?? fallbackAlt}
                src={c.cover}
                className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </a>
          );
        }),
      )}
    </div>
  );
}

export function TemplateCoverRows({
  arabic,
  other,
  locale,
  fallbackAlt,
}: {
  arabic: LandingCover[];
  other: LandingCover[];
  locale: "ar" | "en";
  fallbackAlt: string;
}) {
  if (arabic.length === 0 && other.length === 0) return null;
  return (
    // Full-bleed out of the max-w-7xl column (<main> clips the overflow);
    // dir="ltr" keeps the drift directions the same in both locales.
    <div
      className="mask-edges flex w-screen flex-col gap-4 overflow-hidden ms-[calc(50%-50vw)]"
      dir="ltr"
    >
      {arabic.length > 0 ? (
        <CoverRow covers={arabic} direction="rtl" locale={locale} fallbackAlt={fallbackAlt} />
      ) : null}
      {other.length > 0 ? (
        <CoverRow covers={other} direction="ltr" locale={locale} fallbackAlt={fallbackAlt} />
      ) : null}
    </div>
  );
}
