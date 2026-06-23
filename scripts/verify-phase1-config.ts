// Phase 1 functional proof: a DB config edit propagates LIVE through the
// runtime-config read layer (the path the admin Settings tab will drive), and
// params/cost/gating stay intact. MUTATES then REVERTS the free tier's grant.
//
//   DATABASE_URL="<dev url>" npx tsx scripts/verify-phase1-config.ts
import { strict as assert } from "assert";
import {
  ensureFresh,
  invalidateLocal,
  getFreeCredits,
  paramsForPreset,
  creditCostFor,
  getActivePresetKeys,
} from "../lib/config/runtime-config";
import { prisma } from "../lib/prisma";

async function bumpVersion() {
  await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { configVersion: { increment: 1 } },
  });
}

async function main() {
  await ensureFresh();
  const original = getFreeCredits();
  console.log("free credits (seed):", original);
  assert.equal(original, 400, "seed free credits should be 400");

  // Simulate an admin edit: free signupGrant 400 -> 500 + version bump.
  await prisma.tier.update({ where: { plan: "free" }, data: { signupGrant: 500 } });
  await bumpVersion();
  invalidateLocal();
  await ensureFresh();
  assert.equal(getFreeCredits(), 500, "free credits must reflect the DB edit");
  console.log(
    "free credits (after edit):",
    getFreeCredits(),
    "-> now drives the grant, welcome email, /api/credits, pricing",
  );

  // The rest of the config still resolves correctly after the edit.
  assert.deepEqual(paramsForPreset("opus-fast"), {
    model: "claude-opus-4-8",
    thinking: { type: "disabled" },
    maxTokens: 128000,
  });
  assert.deepEqual(creditCostFor("opus-fast"), { base: 100, perSlide: 10 });
  assert.deepEqual(getActivePresetKeys(), [
    "opus-fast",
    "opus-balanced",
    "fable-low",
  ]);
  console.log("params + cost + active-preset gating intact after the edit");

  // Revert so the DB == seed again (parity stays green).
  await prisma.tier.update({
    where: { plan: "free" },
    data: { signupGrant: original },
  });
  await bumpVersion();
  invalidateLocal();
  await ensureFresh();
  assert.equal(getFreeCredits(), original, "revert failed");
  console.log("reverted free credits to", original);

  await prisma.$disconnect();
  console.log("PHASE 1 VERIFY OK");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e?.message ?? e);
  process.exit(1);
});
