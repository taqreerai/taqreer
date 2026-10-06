"use client";

// Top bar for a signed-out visitor on an open flow (/create, /enhance),
// 2026-10-06: logo home on the
// start side; language, theme and "Log in" on the end side. Same pinned,
// click-through cluster as TopUtilityBar. "Log in" first asks the page to
// save the visitor's draft (GUEST_SAVE_EVENT), then comes back to that flow
// with it restored (no auto-generate: they only wanted to sign in).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref, stripLocale } from "@/lib/i18n/navigation";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import {
  GUEST_FLOWS,
  GUEST_SAVE_EVENT,
  guestLoginHref,
  type GuestFlow,
} from "@/lib/create/guest-draft";

export function GuestTopBar() {
  const dict = useDict();
  const { locale } = useLocale();
  // The open flow this bar sits on (/create, /enhance), for the way back.
  const segment = stripLocale(usePathname() ?? "").split("/")[1] ?? "";
  const flow: GuestFlow = (GUEST_FLOWS as readonly string[]).includes(segment)
    ? (segment as GuestFlow)
    : "create";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex items-center justify-between px-3 md:px-5">
      <Link
        href={localizedHref("/", locale)}
        aria-label={dict.nav.home}
        className="pointer-events-auto flex h-9 items-center"
      >
        <ThemeLogo width={140} height={32} className="h-7 w-auto object-contain" />
      </Link>
      <div className="pointer-events-auto flex items-center gap-1.5">
        <LanguageMenu />
        <ThemeToggle />
        <Link
          href={guestLoginHref(flow, locale, "restore")}
          onClick={() => window.dispatchEvent(new Event(GUEST_SAVE_EVENT))}
          className="btn-pill ms-1 flex h-9 items-center rounded-full px-4 text-xs font-semibold"
        >
          {dict.landingNav.login}
        </Link>
      </div>
    </div>
  );
}
