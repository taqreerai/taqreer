// One-off clawback (owner direction 2026-08-30): zero the remaining FREE
// credits of existing accounts that signed up from a grant-blocked country
// (India), matching the new signup-grant country guard in
// lib/credits/signup.ts (GRANT_BLOCKED_COUNTRIES).
//
// SCOPE - deliberately narrow so no paid OR admin-granted value is touched
// (security-review advisory 2026-08-30: comp tiers, goodwill refunds and
// admin balance-sets land in the same subscriptionBalance bucket with no
// marker row, so filters alone cannot prove a balance is signup money):
//   • User.signupCountry = 'IN'
//   • plan = 'free'
//   • NO Subscription row and NO TopupGrant rows (never paid anything)
//   • HAS a credit.grant.signup event (something was granted to claw)
//   • NO credit.refund event (goodwill remediation present - skip)
//   • creditAccount.subscriptionBalance > 0 AND <= the signup grant
//     amount (a larger balance proves non-signup money - comp leftover /
//     admin set - is present; those accounts are listed and skipped)
// Accounts keep working at 0 credits; subscribing/purchasing later is
// unaffected. Each clawback writes a `credit.clawback` UsageEvent with the
// previous balance, so the action is auditable and attributable.
//
// Safety:
//   • DRY RUN by default - prints the affected users + totals and writes
//     nothing. Pass --execute to apply.
//   • Rerun-safe: users already at 0 simply no longer match.
//   • Race-safe: the balance write is a compare-and-swap (updateMany
//     conditioned on the balance we just read); a user spending credits
//     concurrently makes the CAS miss and the script skips them (a rerun
//     catches the remainder).
//
// Usage (local):  npx tsx --env-file=.env.local scripts/zero-india-free-credits.ts
//        (prod):  run on the box where the prod env is loaded, same flags.
//   Apply:        ... scripts/zero-india-free-credits.ts --execute

import { prisma } from "@/lib/prisma";

const COUNTRY = "IN";

// Operator output identifies accounts by id + masked email - full addresses
// stay out of stdout (which can end up in retained shell/session logs); the
// admin console resolves ids when a full lookup is needed.
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `***${email.slice(at)}`;
}

async function main() {
  const execute = process.argv.includes("--execute");

  const targets = await prisma.user.findMany({
    where: {
      signupCountry: COUNTRY,
      plan: "free",
      role: { not: "admin" },
      subscriptions: { none: {} },
      topupGrants: { none: {} },
      creditAccount: { is: { subscriptionBalance: { gt: 0 } } },
      usageEvents: { some: { eventType: "credit.grant.signup" } },
      AND: [{ usageEvents: { none: { eventType: "credit.refund" } } }],
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      creditAccount: { select: { subscriptionBalance: true } },
      usageEvents: {
        where: { eventType: "credit.grant.signup" },
        select: { amount: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Balance must not exceed what the signup grant ever gave - a larger
  // balance proves comp/admin-granted money is present (skip + surface).
  const eligible: typeof targets = [];
  const overGrant: typeof targets = [];
  for (const u of targets) {
    const balance = u.creditAccount?.subscriptionBalance ?? 0;
    const granted = u.usageEvents.reduce((sum, e) => sum + e.amount, 0);
    (balance <= granted ? eligible : overGrant).push(u);
  }

  let total = 0;
  for (const u of eligible) total += u.creditAccount?.subscriptionBalance ?? 0;
  console.log(
    `[clawback] ${execute ? "EXECUTE" : "DRY RUN"}: ${eligible.length} eligible free never-paid ${COUNTRY} account(s), ${total} credit(s) total`,
  );
  for (const u of eligible) {
    console.log(
      `  ${u.id}  ${maskEmail(u.email)}  balance=${u.creditAccount?.subscriptionBalance}  signupGrant=${u.usageEvents.reduce((s2, e) => s2 + e.amount, 0)}  joined=${u.createdAt.toISOString().slice(0, 10)}`,
    );
  }
  for (const u of overGrant) {
    console.log(
      `  SKIP (balance exceeds signup grant - admin-granted money present): ${u.id}  ${maskEmail(u.email)}  balance=${u.creditAccount?.subscriptionBalance}`,
    );
  }
  if (!execute) {
    console.log("[clawback] dry run only - pass --execute to apply");
    return;
  }

  let zeroed = 0;
  let skipped = 0;
  for (const u of eligible) {
    const balance = u.creditAccount?.subscriptionBalance ?? 0;
    if (balance <= 0) continue;
    await prisma.$transaction(async (tx) => {
      // Take the same per-account row lock every credit mutation takes
      // (lib/credits/server.ts lockAccount): grantTopup / refunds /
      // subscription writers all lock this row first, so the recheck and
      // the write below are serialized against any concurrent purchase.
      // The account row exists (it has a balance), so no upsert needed.
      await tx.$queryRaw`
        SELECT "userId" FROM "CreditAccount" WHERE "userId" = ${u.id} FOR UPDATE`;
      // Revalidate eligibility under the lock: a purchase or goodwill
      // refund landing between the scan and this write would not move
      // subscriptionBalance (top-ups live in TopupGrant rows), so the
      // CAS alone cannot catch it - re-check the paid/refund markers here.
      const still = await tx.user.findFirst({
        where: {
          id: u.id,
          plan: "free",
          role: { not: "admin" },
          subscriptions: { none: {} },
          topupGrants: { none: {} },
          usageEvents: { none: { eventType: "credit.refund" } },
        },
        select: { id: true },
      });
      if (!still) {
        skipped += 1;
        console.log(`  SKIP (became paid/refunded since scan): ${u.id}`);
        return;
      }
      // CAS: only zero if the balance is still what we read - a
      // concurrent spend/hold makes this miss and we skip (rerun-safe).
      const updated = await tx.creditAccount.updateMany({
        where: { userId: u.id, subscriptionBalance: balance },
        data: { subscriptionBalance: 0 },
      });
      if (updated.count === 0) {
        skipped += 1;
        console.log(`  SKIP (balance moved): ${u.id}`);
        return;
      }
      await tx.usageEvent.create({
        data: {
          userId: u.id,
          eventType: "credit.clawback",
          amount: -balance,
          metadata: {
            reason: "country_policy",
            country: COUNTRY,
            previousBalance: balance,
          },
        },
      });
      zeroed += 1;
    });
  }
  console.log(
    `[clawback] done: ${zeroed} zeroed, ${skipped} skipped (balance moved - rerun to catch)`,
  );
}

main()
  .catch((err) => {
    console.error("[clawback] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
