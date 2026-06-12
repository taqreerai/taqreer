"use client";

// Shared tab strip for the billing area: /plans | /billing | /invoices
// read as one section with three views (embedded-billing plan,
// 2026-06-12). Pill links on the surface track - same look as the
// monthly/yearly mini-toggle.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref, stripLocale } from "@/lib/i18n/navigation";

const TABS = [
  { path: "/plans", key: "tabPlans" },
  { path: "/billing", key: "tabBilling" },
  { path: "/invoices", key: "tabInvoices" },
] as const;

export function BillingTabs() {
  const dict = useDict();
  const { locale } = useLocale();
  const pathname = usePathname();
  const current = stripLocale(pathname);
  const t = dict.components.billing;

  return (
    <div className="mb-6 flex w-fit items-center gap-0.5 rounded-full bg-[var(--tq-surface)] p-0.5 text-sm">
      {TABS.map((tab) => {
        const active = current === tab.path;
        return (
          <Link
            key={tab.path}
            href={localizedHref(tab.path, locale)}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 no-underline transition-colors ${
              active
                ? "bg-foreground/10 font-medium text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t[tab.key]}
          </Link>
        );
      })}
    </div>
  );
}
