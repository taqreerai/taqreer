"use client";

// /usage - credit statement (how credits were spent + received). Part of
// the billing area with /plans + /billing + /invoices via BillingTabs, and
// reachable directly from the profile menu.

import { UsageList } from "@/components/billing/UsageList";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { useDict } from "@/components/i18n/LocaleProvider";

export default function UsagePage() {
  const dict = useDict();
  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <h1 className="tq-h1 mb-6">{dict.components.billing.title}</h1>
        <BillingTabs />
        <UsageList />
      </div>
    </div>
  );
}
