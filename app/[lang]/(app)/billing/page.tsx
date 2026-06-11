"use client";

// /billing - dedicated billing page (split out of /settings, user
// direction 2026-06-11). Plan summary, change-plan table, top-up packs.
// Reached from the user menu, the popup's upgrade pill, and the
// credits card.

import { BillingSection } from "@/components/billing/BillingSection";
import { useDict } from "@/components/i18n/LocaleProvider";

export default function BillingPage() {
  const dict = useDict();
  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        <h1 className="tq-h1 mb-6">{dict.components.billing.title}</h1>
        <BillingSection />
      </div>
    </div>
  );
}
