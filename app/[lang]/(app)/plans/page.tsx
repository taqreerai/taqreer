"use client";

// /plans - choose/change plan + top-up packs (split out of the old
// /billing per the embedded-billing plan, 2026-06-12). Money admin
// (cards, cancel) lives on /billing; receipts on /invoices; the shared
// BillingTabs strip ties the three together.

import { BillingSection } from "@/components/billing/BillingSection";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { InviteCard } from "@/components/billing/InviteCard";
import { useDict } from "@/components/i18n/LocaleProvider";

export default function PlansPage() {
  const dict = useDict();
  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <h1 className="tq-h1 mb-6">{dict.components.billing.title}</h1>
        <BillingTabs />
        <InviteCard />
        <BillingSection />
      </div>
    </div>
  );
}
