// One-off: move every ACTIVE subscription onto the CURRENT price for its
// plan+cadence (the price now holding the tier_<plan>_<cadence> lookup_key).
//
// Why: the 2026-07-28 reprice (Plus $12 -> $9, Max $100 -> $79) archives the
// old Prices, and the owner wants stale Prices DELETED. Deleting a recurring
// Price deletes its backing Plan; Stripe keeps existing subscriptions billing,
// but our webhook resolves each renewal's credit grant from the Price's
// metadata (lib/billing/prices.ts parseGrantMetadata) - a deleted Price breaks
// that lookup. So seats must move to the live Prices FIRST; only then is
// delete safe. For subscribers this is strictly a price cut (or no-op).
//
// Mechanics: for each active subscription on our products, if the item's
// price is not the current lookup-key Price implied by the OLD price's
// metadata (plan+cadence), swap the item to the current Price.
// proration_behavior "none": no mid-cycle charge or credit note; the new
// amount simply applies from the next invoice. Billing anchor unchanged.
//
// Usage:  npx tsx scripts/migrate-subs-2026-07-28.ts           (dry-run)
//         npx tsx scripts/migrate-subs-2026-07-28.ts --apply
//         add --live to confirm with a live key
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { stripe, isStripeTestMode } = await import("@/lib/billing/stripe");
  const { parseGrantMetadata } = await import("@/lib/billing/prices");

  const apply = process.argv.includes("--apply");
  const allowLive = process.argv.includes("--live");
  if (apply && !isStripeTestMode && !allowLive) {
    console.error("LIVE key: pass --live to confirm mutating live subscriptions.");
    process.exit(1);
  }

  // Current price per lookup_key (the ones checkout sells today).
  const currentByKey = new Map<string, { id: string; amount: number }>();
  const current = await stripe.prices.list({ active: true, limit: 100 });
  for (const p of current.data) {
    if (p.lookup_key?.startsWith("tier_")) {
      currentByKey.set(p.lookup_key, { id: p.id, amount: p.unit_amount ?? 0 });
    }
  }
  console.log("current tier prices:", [...currentByKey.entries()]
    .map(([k, v]) => `${k}=$${v.amount / 100}`).join("  "));

  let moved = 0;
  for await (const sub of stripe.subscriptions.list({ status: "active", limit: 100 })) {
    for (const item of sub.items.data) {
      const price = item.price;
      const grant = parseGrantMetadata(price.metadata ?? {});
      if (!grant || grant.kind !== "subscription") continue; // not a tier price (topups never subscribe)
      const key = `tier_${grant.plan}_${grant.cadence}`;
      const target = currentByKey.get(key);
      if (!target) {
        console.log(`SKIP ${sub.id}: no current price for ${key} - run stripe-setup-products first`);
        continue;
      }
      if (price.id === target.id) {
        console.log(`ok    ${sub.id} already on ${key} ($${(price.unit_amount ?? 0) / 100})`);
        continue;
      }
      // Safety: this migration exists to pass a price CUT through. Never move
      // a seat to a HIGHER amount unless explicitly confirmed - a stale seat
      // on an old cheaper price (e.g. a pre-2026-07-14 $70 Max) stays put.
      if (target.amount > (price.unit_amount ?? 0) && !process.argv.includes("--allow-increase")) {
        console.log(
          `SKIP  ${sub.id} ${key}: $${(price.unit_amount ?? 0) / 100} -> $${target.amount / 100} is an INCREASE (pass --allow-increase to override)`,
        );
        continue;
      }
      moved++;
      const label = `${sub.id} ${key}: $${(price.unit_amount ?? 0) / 100} (${price.id}) -> $${target.amount / 100} (${target.id})`;
      if (!apply) {
        console.log(`would move ${label}`);
        continue;
      }
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: target.id }],
        proration_behavior: "none",
      });
      console.log(`MOVED ${label}`);
    }
  }
  console.log(`${moved} subscription item(s) ${apply ? "moved" : "to move (dry-run)"}`);
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e);
  process.exit(1);
});
