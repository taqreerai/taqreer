"use client";

// /invoices page body (embedded billing, 2026-06-12): the caller's
// invoice history rendered as `.settings-row` rows. Each row links to
// Stripe's hosted PDF (a receipt download only - all flows stay on
// taqreer.ai).

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { dateFnsLocale } from "@/lib/i18n/date";

type Invoice = {
  id: string;
  number: string | null;
  created: string;
  description: string | null;
  total: number;
  currency: string;
  status: "open" | "paid" | "uncollectible" | "void";
  url: string | null;
};

export function InvoicesList() {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.components.billing;
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/billing/invoices", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { invoices: Invoice[] } | null) => {
        if (!live) return;
        // Failure resolves the loading state too (CR PR#57) - the list
        // used to spin forever on a non-OK response.
        if (d) setInvoices(d.invoices);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const statusLabel: Record<Invoice["status"], string> = {
    paid: t.statusPaid,
    open: t.statusOpen,
    void: t.statusVoid,
    uncollectible: t.statusUncollectible,
  };

  function money(inv: Invoice): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: inv.currency.toUpperCase(),
    }).format(inv.total / 100);
  }

  return (
    <div className="surface-card rounded-2xl p-5">
      {loadFailed ? (
        <p className="text-sm text-muted">{t.loadFailed}</p>
      ) : invoices === null ? (
        <p className="text-sm text-muted">{t.loading}</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-muted">{t.noInvoices}</p>
      ) : (
        invoices.map((inv, i) => (
          <div
            key={inv.id}
            className={`settings-row ${i === invoices.length - 1 ? "border-b-0" : ""}`}
          >
            <div className="min-w-0">
              <p className="settings-row-title truncate">
                {inv.description ?? inv.number ?? inv.id}
              </p>
              <p className="settings-row-desc">
                {format(new Date(inv.created), "d MMMM yyyy", {
                  locale: dateFnsLocale(locale),
                })}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <span
                className={`text-xs ${inv.status === "paid" ? "text-muted" : "text-[var(--tq-status-warn-text)]"}`}
              >
                {statusLabel[inv.status]}
              </span>
              <span className="text-sm font-semibold text-foreground tabular-nums" dir="ltr">
                {money(inv)}
              </span>
              {inv.url ? (
                <a
                  href={inv.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-pill px-3 py-1.5 text-xs no-underline"
                >
                  {t.invoiceView}
                </a>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
