"use client";

// Shared body of the profile menu - extracted from Sidebar (2026-06-12)
// so the studio header's avatar menu is a TRUE replica of the dashboard
// one (user direction: "replicate the avatar, not strip it down"). Two
// consumers: Sidebar's bottom-anchored portal dropdown and UserMenu's
// header dropdown. The consumer owns the open/close state, positioning
// surface, and the NewProjectDialog mount (the dialog must outlive the
// menu body, which unmounts on close).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { localizedHref, switchLocaleHref } from "@/lib/i18n/navigation";
import { locales, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/ui-cookies";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { nextTier } from "@/lib/credits/cost";
import { normalizePlan, planLabel } from "@/lib/plan";
import { format } from "date-fns";
import { dateFnsLocale } from "@/lib/i18n/date";

export function ProfileMenuContent({
  onClose,
  onNewProject,
}: {
  onClose: () => void;
  // Opens the (consumer-mounted) NewProjectDialog after the menu closes.
  onNewProject: () => void;
}) {
  const rawPathname = usePathname() ?? "";
  const router = useRouter();
  const { locale, dir } = useLocale();
  const dict = useDict();
  const { name, email } = useUser();
  const supabase = createClient();
  const credits = useCreditBalance();
  const creditFraction =
    credits && credits.capacity > 0
      ? credits.balance.total / credits.capacity
      : null;
  const currentPlan = credits ? normalizePlan(credits.plan) : null;
  const upgradeTo = currentPlan ? nextTier(currentPlan) : null;

  // Theme toggle (mirrors components/app/ThemeToggle): flip the `.light`
  // class on <html> + persist the `tq_theme` cookie. Synced from the DOM
  // on mount (SSR already applied the class), so the row icon matches.
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);
  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.cookie = `${THEME_COOKIE}=${next ? "light" : "dark"};path=/;max-age=31536000;samesite=lax`;
  };

  // Language picker is a "Language >" drilldown that swaps the menu body
  // for a back header + the locale options. State lives here (the body
  // unmounts on close, so it naturally reopens at the top level).
  const [langView, setLangView] = useState(false);

  const chooseLocale = (next: Locale) => {
    onClose();
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    void fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
    router.push(switchLocaleHref(rawPathname, next));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push(localizedHref("/login", locale));
    router.refresh();
  };

  if (langView) {
    return (
      <>
        <button type="button" onClick={() => setLangView(false)} className="dropdown-item">
          <span className="material-symbols-outlined text-[18px]">
            {dir === "rtl" ? "chevron_right" : "chevron_left"}
          </span>
          <span className="font-semibold">{dict.language.label}</span>
        </button>
        <div className="divider-dark my-1" />
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            role="menuitemradio"
            aria-checked={code === locale}
            onClick={() => chooseLocale(code)}
            className="dropdown-item"
          >
            <span
              className="material-symbols-outlined text-[18px]"
              style={{ opacity: code === locale ? 1 : 0 }}
              aria-hidden
            >
              check
            </span>
            <span>{code === "ar" ? dict.language.ar : dict.language.en}</span>
          </button>
        ))}
      </>
    );
  }

  return (
    <>
      <div className="px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground text-sm">
          <span className="truncate">{name}</span>
          {/* Tier chip - logical gap/flex so it sits after the name in
              BOTH directions. */}
          {currentPlan ? (
            <span className="badge-purple shrink-0">
              {planLabel(dict.components.planUsage, currentPlan)}
            </span>
          ) : null}
        </p>
        <p className="text-muted text-xs truncate">{email}</p>
      </div>
      <div className="divider-dark my-1" />

      {/* ── Credit cards ── reads the SAME store as the avatar ring and
          the settings card; updates in place on the balance nudge. */}
      {credits ? (
        <>
          <div className="flex flex-col gap-2 px-1 py-1">
            {upgradeTo ? (
              <div className="flex items-center justify-between gap-2 rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] py-1.5 ps-4 pe-1.5">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span
                    className="material-symbols-outlined leading-none"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  >
                    bolt
                  </span>
                  <span className="truncate">
                    {dict.components.credits.upgradeTitle.replace(
                      "{tier}",
                      planLabel(dict.components.planUsage, upgradeTo),
                    )}
                  </span>
                </span>
                <Link
                  href={localizedHref("/plans", locale)}
                  onClick={onClose}
                  className="btn-gradient shrink-0 px-3 py-1.5 text-xs no-underline"
                >
                  {dict.components.credits.upgradeCta}
                </Link>
              </div>
            ) : null}

            {/* Credits card: the WHOLE card links to /plans. */}
            <Link
              href={localizedHref("/plans", locale)}
              onClick={onClose}
              className="block rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] px-3 py-2.5 no-underline transition-colors hover:border-[var(--tq-purple)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {dict.components.credits.title}
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
                  <span className="tabular-nums" dir="ltr">
                    {dict.components.credits.creditsLeftShort.replace(
                      "{count}",
                      formatCredits(credits.balance.total),
                    )}
                  </span>
                  <span
                    className="material-symbols-outlined leading-none"
                    style={{ fontSize: 14 }}
                    aria-hidden
                  >
                    {dir === "rtl" ? "chevron_left" : "chevron_right"}
                  </span>
                </span>
              </div>
              <div className="progress-track my-2">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.round((creditFraction ?? 0) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{dict.components.credits.subscriptionSplit}</span>
                <span className="tabular-nums" dir="ltr">
                  {formatCredits(credits.balance.subscription)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted">
                <span>{dict.components.credits.topupSplit}</span>
                <span className="tabular-nums" dir="ltr">
                  {formatCredits(credits.balance.topup)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {credits.balance.allotmentResetAt
                  ? dict.components.credits.renews.replace(
                      "{date}",
                      format(new Date(credits.balance.allotmentResetAt), "d MMMM", {
                        locale: dateFnsLocale(locale),
                      }),
                    )
                  : dict.components.credits.noRenewal}
              </p>
            </Link>
          </div>
          <div className="divider-dark my-1" />
        </>
      ) : null}

      <button
        type="button"
        onClick={() => {
          onClose();
          onNewProject();
        }}
        className="dropdown-item"
      >
        <span className="material-symbols-outlined text-[18px]">add_circle</span>
        <span>{dict.profileMenu.newProject}</span>
      </button>

      <div className="divider-dark my-1" />

      {/* Theme toggle - flips the chrome theme in place (menu stays open
          so the colour change is visible). */}
      <button type="button" onClick={toggleTheme} aria-pressed={light} className="dropdown-item">
        <span className="material-symbols-outlined text-[18px]">
          {light ? "dark_mode" : "light_mode"}
        </span>
        <span>{dict.topBar.theme}</span>
      </button>

      <button
        type="button"
        onClick={() => setLangView(true)}
        aria-haspopup="menu"
        className="dropdown-item"
      >
        <span className="material-symbols-outlined text-[18px]">translate</span>
        <span>{dict.language.label}</span>
        <span className="material-symbols-outlined text-[18px] ms-auto opacity-50">
          {dir === "rtl" ? "chevron_left" : "chevron_right"}
        </span>
      </button>

      <div className="divider-dark my-1" />

      <Link href={localizedHref("/billing", locale)} onClick={onClose} className="dropdown-item">
        <span className="material-symbols-outlined text-[18px]">credit_card</span>
        <span>{dict.profileMenu.billing}</span>
      </Link>
      <Link href={localizedHref("/settings", locale)} onClick={onClose} className="dropdown-item">
        <span className="material-symbols-outlined text-[18px]">settings</span>
        <span>{dict.profileMenu.settings}</span>
      </Link>
      <button type="button" onClick={handleLogout} className="dropdown-item">
        <span className="material-symbols-outlined text-[18px]">logout</span>
        <span>{dict.profileMenu.signOut}</span>
      </button>
    </>
  );
}
