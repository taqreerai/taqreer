// Usage statement, shared shapes + presentation map for the credit
// "Usage" surface (the user-menu page that lists how a user spent and
// received credits). CLIENT-SAFE: pure data + mapping, no Prisma / env.
//
// The API (app/api/usage/ledger) normalizes the raw UsageEvent journal
// into LedgerRow[]; this module turns each row into an icon + label key
// the table renders. HOLDS ARE NEVER SHOWN, a hold is transient and
// settles into a charge/release, so the statement reads the FINAL
// movements only (mirrors RECENT_EVENT_TYPES in app/api/credits).

import type { Flow } from "@/lib/credits/cost";
import { BRAND_FLOW_CARDS } from "@/components/app/brandFlowCards";

// Final-movement event types shown in the statement. Excludes the
// transient `credit.hold`, the net-zero `credit.release` (a fully
// refunded failed job the user never saw debited), and the bookkeeping
// `credit.plan.changed` (amount 0).
export const STATEMENT_EVENT_TYPES = [
  "credit.settle",
  "credit.charge",
  "credit.grant.signup",
  "credit.grant.subscription",
  "credit.grant.topup",
  "credit.reset",
  "credit.expire_topup",
] as const;

// The credits-IN events, summed for the period "added" total.
export const GRANT_EVENT_TYPES = [
  "credit.grant.signup",
  "credit.grant.subscription",
  "credit.grant.topup",
  "credit.reset",
] as const;

// One normalized statement line (the API's output row shape).
export type LedgerRow = {
  id: string;
  at: string; // ISO timestamp
  eventType: string;
  // From the joined CreditHold metadata (spend rows only):
  kind: string | null; // "deck.generate" | "deck.regenerate.partial" | null
  flow: Flow | null; // create | enhance | mimic | datasheet | null
  preset: string | null;
  slides: number | null;
  // Signed credits: < 0 spent / expired, > 0 added.
  delta: number;
};

export type UsageType = "spent" | "added" | "expired";

export type UsageDescriptor = {
  // AnimatedIcon name. A flow name resolves to the SAME static flow
  // icon the QuickAction cards use (rendered without driving the hover
  // ref, so it sits still); everything else falls back to a Material
  // Symbol glyph.
  icon: string;
  // Key into dict.components.usage.events.*
  labelKey: string;
  type: UsageType;
};

// flow slug → Material-Symbol-equivalent icon name (the SAME mapping the
// dashboard flow cards use, so the statement reuses their iconography).
const FLOW_ICON = Object.fromEntries(
  BRAND_FLOW_CARDS.map((c) => [c.flow, c.icon]),
) as Record<Flow, string>;

/** Map a normalized ledger row to its icon + label key + spend/grant type. */
export function describeLedgerRow(row: LedgerRow): UsageDescriptor {
  // Generations carry a flow → reuse the flow's own icon + label.
  if (row.flow && FLOW_ICON[row.flow]) {
    return { icon: FLOW_ICON[row.flow], labelKey: row.flow, type: "spent" };
  }
  // Partial regen has no flow but a known kind.
  if (row.kind === "deck.regenerate.partial") {
    return { icon: "autorenew", labelKey: "regen", type: "spent" };
  }
  switch (row.eventType) {
    case "credit.grant.signup":
      return { icon: "redeem", labelKey: "signup", type: "added" };
    case "credit.grant.subscription":
      return { icon: "autorenew", labelKey: "subscription", type: "added" };
    case "credit.reset":
      return { icon: "autorenew", labelKey: "reset", type: "added" };
    case "credit.grant.topup":
      return { icon: "bolt", labelKey: "topup", type: "added" };
    case "credit.expire_topup":
      return { icon: "schedule", labelKey: "expired", type: "expired" };
    default:
      // A settle/charge whose hold metadata we couldn't resolve.
      return {
        icon: "bolt",
        labelKey: "generation",
        type: row.delta < 0 ? "spent" : "added",
      };
  }
}
