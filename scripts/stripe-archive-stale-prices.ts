// One-off cleanup: remove Stripe Prices on our products that no longer
// carry a catalog lookup_key. RECURRING prices are backed by Plans, which
// Stripe DOES allow deleting (same as the dashboard's "Delete price") -
// history is unaffected, invoices keep their own copies. One-time prices
// have no delete API and fall back to archiving (active=false). Scoped to
// products stamped with metadata.taqreerProductKey so nothing else in the
// account can be touched.
//
// Usage:  npx tsx scripts/stripe-archive-stale-prices.ts           (dry-run)
//         npx tsx scripts/stripe-archive-stale-prices.ts --apply   (archive)
//         npx tsx scripts/stripe-archive-stale-prices.ts --delete  (delete, archive fallback)
//         add --live to confirm when running with a live key
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { stripe, isStripeTestMode } = await import("@/lib/billing/stripe");
  const { BILLING_CATALOG } = await import("@/lib/billing/prices");

  const del = process.argv.includes("--delete");
  const apply = del || process.argv.includes("--apply");
  const allowLive = process.argv.includes("--live");
  if (apply && !isStripeTestMode && !allowLive) {
    console.error("LIVE key: pass --live to confirm mutating live prices.");
    process.exit(1);
  }

  const currentKeys = new Set(BILLING_CATALOG.map((s) => s.lookupKey));
  const products = await stripe.products.list({ active: true, limit: 100 });
  const ours = products.data.filter((p) => p.metadata?.taqreerProductKey);

  let stale = 0;
  for (const product of ours) {
    // In delete mode include archived prices too - full cleanup.
    const prices = await stripe.prices.list({
      product: product.id,
      ...(del ? {} : { active: true }),
      limit: 100,
    });
    for (const price of prices.data) {
      if (price.lookup_key && currentKeys.has(price.lookup_key)) {
        console.log(`keep     ${price.id} ${price.lookup_key} ($${(price.unit_amount ?? 0) / 100})`);
        continue;
      }
      stale++;
      const label = `${price.id} (${product.metadata.taqreerProductKey}, $${(price.unit_amount ?? 0) / 100}, lookup_key=${price.lookup_key ?? "none"}, ${price.active ? "active" : "archived"})`;
      if (!apply) {
        console.log(`stale    ${label} - would ${del ? "delete" : "archive"}`);
        continue;
      }
      if (del && price.type === "recurring") {
        try {
          // Recurring prices are plans under the hood; deleting the plan
          // removes the price (the dashboard's "Delete price"). VERIFIED
          // live 2026-07-07: plans.del accepted the price_... ids and the
          // 8 stale prices disappeared from a filterless prices.list.
          await stripe.plans.del(price.id);
          console.log(`DELETED  ${label}`);
          continue;
        } catch (err) {
          console.warn(`  delete refused for ${price.id} (${err instanceof Error ? err.message : err}); archiving instead`);
        }
      }
      if (price.active) {
        await stripe.prices.update(price.id, { active: false });
        console.log(`ARCHIVED ${label}`);
      } else {
        console.log(`skipped  ${label} (already archived; not deletable)`);
      }
    }
  }
  console.log(`\n${stale} stale price(s) ${apply ? "processed" : `found (dry-run; pass --apply or --delete)`}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
