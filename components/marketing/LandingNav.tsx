"use client";

// Landing top nav — STATIC (Swiss-grid redesign): no scroll-reveal motion, no
// background fill, just a bottom hairline. `absolute` so it sits at the top of
// the hero and scrolls away (no sticky reveal). The flex order mirrors with the
// chrome direction: in RTL the logo reads at the start (right); in LTR it leads
// from the left. Strings come from the active-locale dictionary.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useDict } from "@/components/i18n/LocaleProvider";
import { localizedHref, stripLocale } from "@/lib/i18n/navigation";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { ThemeLogo } from "@/components/brand/ThemeLogo";

export function LandingNav({ isAuthed }: { isAuthed: boolean }) {
  const { locale } = useLocale();
  const dict = useDict();
  const pathname = usePathname();

  // On the landing the links are in-page smooth-scroll anchors; on any other
  // page (the legal pages share this nav) they jump back to the landing's
  // sections instead of dead `#` anchors.
  const stripped = stripLocale(pathname);
  const onLanding = stripped === "/" || stripped === "";
  const home = localizedHref("/", locale);
  const sec = (anchor: string) => (onLanding ? anchor : `${home}${anchor}`);
  const navLinks = [
    { label: dict.landingNav.home, href: onLanding ? "#" : home },
    { label: dict.landingNav.features, href: sec("#features") },
    { label: dict.landingNav.pricing, href: sec("#pricing") },
    { label: dict.landingNav.templates, href: sec("#templates") },
    { label: dict.landingNav.faq, href: sec("#faq") },
  ];

  return (
    <nav className="absolute top-0 right-0 left-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* relative so the link group can be absolutely centred on the page
            regardless of the logo / actions widths (was drifting off-centre
            under justify-between). */}
        <div className="relative flex h-20 items-center justify-between">
          <Link href={localizedHref("/", locale)} className="flex flex-shrink-0 items-center gap-2">
            <ThemeLogo
              width={140}
              height={32}
              className="h-8 w-auto object-contain"
            />
          </Link>

          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:flex">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="icon-hover cursor-pointer text-sm"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {/* Theme + language as a tight icon pair so they don't read more
                spaced than the auth pills beside them. */}
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LanguageMenu />
            </div>
            {isAuthed ? (
              <Link href={localizedHref("/dashboard", locale)} className="btn-gradient px-5 py-2 text-xs">
                {dict.landingNav.dashboard}
              </Link>
            ) : (
              <>
                <Link href={localizedHref("/login", locale)} className="btn-pill px-4 py-2 text-xs">
                  {dict.landingNav.login}
                </Link>
                <Link href={localizedHref("/signup", locale)} className="btn-gradient px-5 py-2 text-xs">
                  {dict.landingNav.signup}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
