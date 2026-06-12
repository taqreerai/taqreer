"use client";

// /billing - money admin (embedded billing, 2026-06-12): subscription
// cancel/resume + payment methods. Plan changing lives on /plans,
// receipts on /invoices; BillingTabs ties the three together.

import { ManageBilling } from "@/components/billing/ManageBilling";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { useDict } from "@/components/i18n/LocaleProvider";

export default function BillingPage() {
  const dict = useDict();
  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <h1 className="tq-h1 mb-6">{dict.components.billing.title}</h1>
        <BillingTabs />
        <ManageBilling />
      </div>
    </div>
  );
}
