// /lab/billing - DEV-ONLY static showcase of every billing UI component
// (context/billing-plan.md, Phase A0). Nothing here is functional: each
// section is a frozen render for design review. Components graduate into
// the real flows ONLY after the user reviews + directs here. NOT linked
// anywhere; 404s in production.

import { notFound } from "next/navigation";
import { BillingShowcase } from "./BillingShowcase";

export const dynamic = "force-dynamic";

export default function LabBillingPage() {
  // Hard gate: this tool never ships.
  if (process.env.NODE_ENV === "production") notFound();
  return <BillingShowcase />;
}
