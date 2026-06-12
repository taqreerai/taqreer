"use client";

// /invoices - receipt history (embedded billing, 2026-06-12). Part of
// the billing area with /plans + /billing via BillingTabs.

import { InvoicesList } from "@/components/billing/InvoicesList";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { useDict } from "@/components/i18n/LocaleProvider";

export default function InvoicesPage() {
  const dict = useDict();
  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <h1 className="tq-h1 mb-6">{dict.components.billing.title}</h1>
        <BillingTabs />
        <InvoicesList />
      </div>
    </div>
  );
}
