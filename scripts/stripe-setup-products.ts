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
//   - A drifted product name or grant metadata at an unchanged amount
//     (e.g. a top-up re-sized at a held price) is updated in place.
//
// Usage:  npx tsx scripts/stripe-setup-products.ts          (sync, test key)
//         npx tsx scripts/stripe-setup-products.ts --list   (show only)
//         npx tsx scripts/stripe-setup-products.ts --live   (intentional live run)
//
// LIVE GUARD: with a live key the script refuses to create unless --live
// is passed, so a stray run can't mint live products by accident. --list
// stays read-only in either mode.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { stripe, isStripeTestMode } = await import("@/lib/billing/stripe");
  const { BILLING_CATALOG, grantToMetadata } = await import(
    "@/lib/billing/prices"
  );

  const listOnly = process.argv.includes("--list");
  const allowLive = process.argv.includes("--live");
  if (!isStripeTestMode && !listOnly && !allowLive) {
    console.error(
      "Refusing to create products with a LIVE key. Pass --live to confirm an intentional live run, --list to inspect, or run with test keys.",
    );
    process.exit(1);
  }
  if (!isStripeTestMode && allowLive && !listOnly) {
    console.warn(
      "LIVE MODE: creating real Products/Prices in the live Stripe account.",
    );
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
      // Names carry the pack size ("Taqreer 2,000 credits") and show on
      // Stripe receipts, so a credit re-size must rename the product too.
      if (found.name !== name) {
        if (listOnly) {
          console.log(`product ~ ${key} -> ${found.id} (would rename "${found.name}" -> "${name}")`);
        } else {
          await stripe.products.update(found.id, { name });
          console.log(`product ~ ${key} -> ${found.id} (renamed "${found.name}" -> "${name}")`);
        }
        continue;
      }
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

  // Resolve each Price by lookup_key. Stripe allows at most 10 lookup_keys
  // per list call (the catalog outgrew that with the deck unlocks,
  // 2026-10-08), so fetch in chunks.
  const allKeys = BILLING_CATALOG.map((s) => s.lookupKey);
  const existingPrices = { data: [] as Awaited<ReturnType<typeof stripe.prices.list>>["data"] };
  for (let i = 0; i < allKeys.length; i += 10) {
    const page = await stripe.prices.list({
      active: true,
      limit: 100,
      lookup_keys: allKeys.slice(i, i + 10),
    });
    existingPrices.data.push(...page.data);
  }
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
      // Same amount but a stale grant (e.g. a top-up re-sized at a held
      // price): metadata is mutable, so refresh it in place instead of
      // minting a new Price.
      const grantMeta = grantToMetadata(spec.grant);
      const metaStale = Object.entries(grantMeta).some(
        ([k, v]) => current!.metadata?.[k] !== v,
      );
      if (!metaStale) {
        console.log(`  price ✓ ${spec.lookupKey} -> ${current!.id} ($${spec.amount / 100})`);
        continue;
      }
      if (listOnly) {
        console.log(`  price ~ ${spec.lookupKey} -> ${current!.id} (would refresh grant metadata)`);
        continue;
      }
      await stripe.prices.update(current!.id, { metadata: grantMeta });
      if (productId) {
        await stripe.products.update(productId, {
          metadata: { taqreerProductKey: spec.productKey, ...grantMeta },
        });
      }
      console.log(`  price ~ ${spec.lookupKey} -> ${current!.id} (refreshed grant metadata)`);
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
    // Archive the replaced Price (Stripe prices can't be deleted, only
    // deactivated). Existing subscriptions on it keep billing; it just
    // stops being offerable and stops cluttering the dashboard.
    if (current) {
      await stripe.prices.update(current.id, { active: false });
      console.log(`  price - archived stale ${current.id}`);
    }
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
