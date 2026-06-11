"use client";

// Landing top nav — STATIC (Swiss-grid redesign): no scroll-reveal motion, no
// background fill, just a bottom hairline. `absolute` so it sits at the top of
// the hero and scrolls away (no sticky reveal). The flex order mirrors with the
// chrome direction: in RTL the logo reads at the start (right); in LTR it leads
// from the left. Strings come from the active-locale dictionary.

import Link from "next/link";
import Image from "next/image";
import { useLocale, useDict } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";

export function LandingNav({ isAuthed }: { isAuthed: boolean }) {
  const { locale } = useLocale();
  const dict = useDict();

  // In-page anchor links — no locale prefix (they scroll within this page).
  const navLinks = [
    { label: dict.landingNav.home, href: "#" },
    { label: dict.landingNav.features, href: "#features" },
    { label: dict.landingNav.pricing, href: "#pricing" },
    { label: dict.landingNav.templates, href: "#templates" },
  ];

  return (
    <nav className="absolute top-0 right-0 left-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <Link href={localizedHref("/", locale)} className="flex flex-shrink-0 items-center gap-2">
            <Image
              src="/logo-light.svg"
              alt="taqreer.ai logo"
              width={140}
              height={32}
              className="h-8 w-auto object-contain"
            />
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="cursor-pointer text-sm text-muted transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <LanguageMenu />
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
