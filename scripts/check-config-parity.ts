// Parity guard for Phase 0/1: the runtime-config accessors must return EXACTLY
// what today's code constants do — both cold (SEED fallback) and after loading
// the seeded DB. Proves the config move is behavior-preserving.
//
//   DATABASE_URL="<dev url>" npx tsx scripts/check-config-parity.ts
import { strict as assert } from "assert";
import {
  getActivePresets,
  paramsForPreset,
  creditCostFor,
  getTier,
  getTiers,
  getFreeCredits,
  getImageCredits,
  defaultPresetKey,
  regenPresetKey,
  ensureFresh,
} from "../lib/config/runtime-config";
import { QUALITY_PRESETS, DEFAULT_QUALITY, REGEN_QUALITY } from "../lib/types/quality";
import { paramsForQuality } from "../lib/anthropic/quality-params";
import { CREDIT_COST, TIERS, IMAGE_CREDITS_PER_IMAGE } from "../lib/credits/cost";
import { KNOWN_PLANS } from "../lib/plan";

function checkAgainstConstants(label: string) {
  for (const p of QUALITY_PRESETS) {
    assert.deepEqual(paramsForPreset(p.key), paramsForQuality(p.key), `params ${p.key}`);
    assert.deepEqual(creditCostFor(p.key), CREDIT_COST[p.key], `cost ${p.key}`);
  }
  assert.deepEqual(
    getActivePresets().map((p) => p.key).sort(),
    QUALITY_PRESETS.filter((p) => p.active).map((p) => p.key).sort(),
    "active preset keys",
  );
  assert.equal(getImageCredits(), IMAGE_CREDITS_PER_IMAGE, "image credits");
  assert.equal(getTiers().length, KNOWN_PLANS.length, "tier count");
  for (const plan of KNOWN_PLANS) {
    const t = getTier(plan);
    const c = TIERS[plan];
    assert.equal(t.priceUsd, c.priceUsd, `${plan} priceUsd`);
    assert.equal(t.monthlyAllotment, c.monthlyAllotment, `${plan} monthlyAllotment`);
    assert.equal(t.signupGrant, c.signupGrant, `${plan} signupGrant`);
    assert.equal(t.slideCap, c.slideCap, `${plan} slideCap`);
    assert.deepEqual([...t.unlockedPresetKeys].sort(), [...c.presets].sort(), `${plan} presets`);
    assert.deepEqual([...t.flows].sort(), [...c.flows].sort(), `${plan} flows`);
  }
  assert.equal(getFreeCredits(), TIERS.free.signupGrant, "free credits");
  assert.equal(defaultPresetKey(), DEFAULT_QUALITY, "default preset");
  assert.equal(regenPresetKey(), REGEN_QUALITY, "regen preset");
  console.log(`  OK  ${label}: presets, params, costs, tiers, free-credits all match constants`);
}

async function main() {
  // 1) cold cache -> accessors serve the SEED fallback
  checkAgainstConstants("SEED / cold cache");
  // 2) load the seeded DB -> DB must equal the constants too
  if (process.env.DATABASE_URL) {
    await ensureFresh();
    checkAgainstConstants("DB-loaded");
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  } else {
    console.log("  ..  skipped DB-loaded check (no DATABASE_URL)");
  }
  console.log("PARITY OK");
}

main().catch((e) => {
  console.error("PARITY FAILED:", e?.message ?? e);
  process.exit(1);
});
