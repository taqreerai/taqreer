"use client";

// Landing top nav — STATIC (Swiss-grid redesign): no scroll-reveal motion, no
// background fill, just a bottom hairline. `absolute` so it sits at the top of
// the hero and scrolls away (no sticky reveal). The flex order mirrors with the
// chrome direction: in RTL the logo reads at the start (right); in LTR it leads
// from the left. Strings come from the active-locale dictionary.

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useDict } from "@/components/i18n/LocaleProvider";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { localizedHref, stripLocale } from "@/lib/i18n/navigation";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { FeaturesMenu, MobileFeaturesList } from "@/components/marketing/FeaturesMenu";

// Auth state is resolved CLIENT-side (useIsAuthed: a cookie-presence check, no
// Supabase client) so the marketing/legal layouts and the landing need no server
// getUser() — that's what lets those pages render statically AND keeps the
// ~200 KB Supabase bundle off them. Logged-out nav renders first; it swaps to
// the authed CTA after hydration for signed-in visitors (rarely on these pages).
export function LandingNav() {
  const { locale } = useLocale();
  const dict = useDict();
  const pathname = usePathname();
  const isAuthed = useIsAuthed();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close the mobile menu on an outside click or Escape, matching the app's
  // popup convention (the landing has no iframe, so a document listener is
  // enough - the menu panel lives inside <nav>, so a click outside the nav
  // closes it; links inside close via their own onClick).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && navRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // On the landing the links are in-page smooth-scroll anchors; on any other
  // page (the legal pages share this nav) they jump back to the landing's
  // sections instead of dead `#` anchors.
  const stripped = stripLocale(pathname);
  const onLanding = stripped === "/" || stripped === "";
  const home = localizedHref("/", locale);
  const sec = (anchor: string) => (onLanding ? anchor : `${home}${anchor}`);
  // "Features" is rendered separately as a dropdown (desktop) / expandable
  // list (mobile) of the one-feature-per-page spokes; see FeaturesMenu.
  const navLinks = [
    { label: dict.landingNav.whyUs, href: localizedHref("/arabic-presentations", locale) },
    { label: dict.landingNav.pricing, href: localizedHref("/pricing", locale) },
    { label: dict.landingNav.templates, href: localizedHref("/presentation-templates", locale) },
    { label: dict.landingNav.stockImages, href: localizedHref("/free-stock-images", locale) },
    { label: dict.landingNav.faq, href: sec("#faq") },
  ];

  return (
    <nav ref={navRef} className="absolute top-0 start-0 end-0 z-50">
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
            <FeaturesMenu triggerHref={sec("#features")} />
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
            {/* Theme + language. The theme is one choice for the whole site
                (light by default, owner 2026-10-29), so the same toggle as
                the dashboard chrome. */}
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

          {/* Mobile hamburger — toggles the panel below (md and up uses the
              inline nav + actions above). */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={locale === "ar" ? "القائمة" : "Menu"}
            aria-expanded={menuOpen}
            className="icon-hover -me-1 flex h-10 w-10 items-center justify-center rounded-lg md:hidden"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu panel — nav links + theme/lang + auth CTAs. Opaque
            surface so it reads over the hero it overlays. */}
        {menuOpen ? (
          <div className="surface-menu mt-2 flex flex-col gap-1 rounded-2xl p-3 md:hidden">
            <MobileFeaturesList onNavigate={() => setMenuOpen(false)} />
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="icon-hover cursor-pointer rounded-lg px-3 py-2.5 text-center text-sm"
              >
                {l.label}
              </a>
            ))}
            {/* Centered controls + content-width (not full-width) CTAs. */}
            <div className="mt-2 mb-2 flex items-center justify-center gap-2">
              <ThemeToggle />
              <LanguageMenu />
            </div>
            {isAuthed ? (
              <div className="flex flex-col items-center">
                <Link
                  href={localizedHref("/dashboard", locale)}
                  onClick={() => setMenuOpen(false)}
                  className="btn-gradient px-6 py-2.5 text-center text-xs"
                >
                  {dict.landingNav.dashboard}
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Link
                  href={localizedHref("/login", locale)}
                  onClick={() => setMenuOpen(false)}
                  className="btn-pill px-6 py-2.5 text-center text-xs"
                >
                  {dict.landingNav.login}
                </Link>
                <Link
                  href={localizedHref("/signup", locale)}
                  onClick={() => setMenuOpen(false)}
                  className="btn-gradient px-6 py-2.5 text-center text-xs"
                >
                  {dict.landingNav.signup}
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
