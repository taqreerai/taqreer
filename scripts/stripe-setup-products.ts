// Create / sync the Stripe Products + Prices for every entry in
// BILLING_CATALOG (billing plan Phase B). Idempotent: re-running only
// creates what's missing.
//
//   - Products are matched by `metadata.taqreerProductKey` (so a rename
//     of productName doesn't orphan the old one).
//   - Prices are matched by `lookup_key` (Stripe's stable handle). A
//     Price's amount is immutable, so if the catalog amount changed we
//     archive the old Price and create a fresh one carrying the same
//     lookup_key (Stripe moves the key to the newest active Price).
//
// Usage:  npx tsx scripts/stripe-setup-products.ts          (sync)
//         npx tsx scripts/stripe-setup-products.ts --list   (show only)
//
// TEST MODE: gated on the key being rk_test_/sk_test_ so a stray run
// against live keys can't mint live products by accident.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { stripe, isStripeTestMode } = await import("@/lib/billing/stripe");
  const { BILLING_CATALOG, grantToMetadata } = await import(
    "@/lib/billing/prices"
  );

  const listOnly = process.argv.includes("--list");
  if (!isStripeTestMode && !listOnly) {
    console.error(
      "Refusing to create products with a LIVE key. Use --list to inspect, or run with test keys.",
    );
    process.exit(1);
  }

  // Distinct products from the catalog (productKey -> name).
  const products = new Map<string, string>();
  for (const spec of BILLING_CATALOG) products.set(spec.productKey, spec.productName);

  // Resolve (find-or-create) a Product per productKey, matched on metadata.
  const productIdByKey = new Map<string, string>();
  const existingProducts = await stripe.products.list({ active: true, limit: 100 });
  for (const [key, name] of products) {
    const found = existingProducts.data.find(
      (p) => p.metadata?.taqreerProductKey === key,
    );
    if (found) {
      productIdByKey.set(key, found.id);
      console.log(`product ✓ ${key} -> ${found.id}`);
      continue;
    }
    if (listOnly) {
      console.log(`product ✗ ${key} (would create)`);
      continue;
    }
    const created = await stripe.products.create({
      name,
      metadata: { taqreerProductKey: key },
    });
    productIdByKey.set(key, created.id);
    console.log(`product + ${key} -> ${created.id}`);
  }

  // Resolve each Price by lookup_key.
  const existingPrices = await stripe.prices.list({
    active: true,
    limit: 100,
    lookup_keys: BILLING_CATALOG.map((s) => s.lookupKey),
  });
  for (const spec of BILLING_CATALOG) {
    const productId = productIdByKey.get(spec.productKey);
    const current = existingPrices.data.find((p) => p.lookup_key === spec.lookupKey);
    const matches =
      current &&
      current.unit_amount === spec.amount &&
      current.currency === spec.currency &&
      (spec.interval
        ? current.recurring?.interval === spec.interval
        : current.type === "one_time");
    if (matches) {
      console.log(`  price ✓ ${spec.lookupKey} -> ${current!.id} ($${spec.amount / 100})`);
      continue;
    }
    if (listOnly) {
      console.log(
        `  price ✗ ${spec.lookupKey} (would ${current ? "replace" : "create"}, $${spec.amount / 100})`,
      );
      continue;
    }
    if (!productId) {
      console.error(`  price ! ${spec.lookupKey}: no product id`);
      continue;
    }
    // A changed amount needs a NEW price; transfer_lookup_key moves the
    // stable key off the stale one onto the new Price.
    const created = await stripe.prices.create({
      product: productId,
      unit_amount: spec.amount,
      currency: spec.currency,
      lookup_key: spec.lookupKey,
      transfer_lookup_key: !!current,
      ...(spec.interval ? { recurring: { interval: spec.interval } } : {}),
      metadata: grantToMetadata(spec.grant),
    });
    // Also stamp the grant onto the Product (webhook can read either).
    await stripe.products.update(productId, {
      metadata: { taqreerProductKey: spec.productKey, ...grantToMetadata(spec.grant) },
    });
    console.log(`  price + ${spec.lookupKey} -> ${created.id} ($${spec.amount / 100})`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
