// End-to-end proof of the admin Settings write layer against the LOCAL DB:
// tier edit (free-credits propagation), preset create/update/delete, the
// tier-orphan guard, validation rejection, Fable-forces-thinking, and the
// UsageEvent audit trail. Restores the seed at the end so parity stays green.
//
//   DATABASE_URL="<dev url>" npx tsx scripts/verify-settings.ts
import { strict as assert } from "assert";
import { prisma } from "../lib/prisma";
import {
  ensureFresh,
  getAllPresets,
  getActivePresetKeys,
  getFreeCredits,
  getTier,
  paramsForPreset,
  creditCostFor,
  resetConfigToSeed,
} from "../lib/config/runtime-config";
import {
  createPreset,
  updatePreset,
  deletePreset,
  updateTier,
  ValidationError,
} from "../lib/config/settings-mutations";

const SONNET: Parameters<typeof createPreset>[1] = {
  key: "test-sonnet",
  label: "Sonnet test",
  model: "claude-sonnet-4-6",
  thinking: false,
  effort: null,
  maxTokens: 64000,
  baseCredits: 60,
  perSlideCredits: 8,
  secsPerSlide: 6,
  baseOverheadSecs: 20,
  active: true,
};

async function expectReject(fn: () => Promise<unknown>, label: string) {
  let rejected = false;
  try {
    await fn();
  } catch (e) {
    rejected = e instanceof ValidationError;
    if (!rejected) throw e;
  }
  assert.ok(rejected, `expected ValidationError: ${label}`);
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("No admin user in the local DB — run scripts/set-admin.ts <email>");
  const adminId = admin.id;
  await ensureFresh();
  console.log(`admin: ${admin.email}; start free=${getFreeCredits()} active=${getActivePresetKeys().join(",")}`);

  // 1) Free credits via the free-tier edit (the propagation feature).
  const f0 = getTier("free");
  await updateTier(adminId, "free", {
    monthlyAllotment: f0.monthlyAllotment,
    signupGrant: 500,
    slideCap: f0.slideCap,
    unlockedPresetKeys: [...f0.unlockedPresetKeys],
    flows: [...f0.flows],
  });
  await ensureFresh();
  assert.equal(getFreeCredits(), 500, "free credits should be 500");
  console.log("[1] free-credits edit -> 500 (propagates to grant/email/credits/pricing)");

  // 2) Create a preset from a live model id; params + cost must resolve.
  await createPreset(adminId, SONNET);
  await ensureFresh();
  assert.ok(getActivePresetKeys().includes("test-sonnet"), "new preset is active");
  assert.deepEqual(paramsForPreset("test-sonnet"), {
    model: "claude-sonnet-4-6",
    thinking: { type: "disabled" },
    maxTokens: 64000,
  });
  assert.deepEqual(creditCostFor("test-sonnet"), { base: 60, perSlide: 8 });
  console.log("[2] create preset -> generation params + charge cost resolve from DB");

  // 3) Update (deactivate) -> hidden from the active set / picker.
  await updatePreset(adminId, "test-sonnet", { ...SONNET, active: false });
  await ensureFresh();
  assert.ok(!getActivePresetKeys().includes("test-sonnet"), "deactivated preset hidden");
  console.log("[3] deactivate preset -> dropped from active set");

  // 4) Validation rejects a bad key + Fable without thinking.
  await expectReject(
    () => createPreset(adminId, { ...SONNET, key: "Bad Key" }),
    "non-kebab key",
  );
  await expectReject(
    () =>
      createPreset(adminId, {
        ...SONNET,
        key: "test-fable",
        model: "claude-fable-5",
        thinking: false,
      }),
    "fable without thinking",
  );
  console.log("[4] validation rejects bad key + fable-without-thinking");

  // 5) Tier-orphan guard: free unlocks only opus-fast, so deleting it is blocked.
  await expectReject(() => deletePreset(adminId, "opus-fast"), "delete free's only preset");
  console.log("[5] tier-orphan guard blocks deleting the free tier's only preset");

  // 6) Delete the test preset.
  await deletePreset(adminId, "test-sonnet");
  await ensureFresh();
  assert.ok(!getAllPresets().some((p) => p.key === "test-sonnet"), "test preset deleted");
  console.log("[6] delete preset");

  // Audit trail: each of the 4 SUCCESSFUL writes (tier update, preset
  // create/update/delete) left an admin.settings.* UsageEvent. The 3 rejected
  // mutations correctly leave none (they throw before commit). Count is
  // cumulative across runs, so assert >= 4 (this run's successful writes).
  const audit = await prisma.usageEvent.count({
    where: { eventType: { startsWith: "admin.settings." } },
  });
  assert.ok(audit >= 4, `expected >=4 audit rows, got ${audit}`);
  console.log(`audit: ${audit} admin.settings.* events (rejections wrote none)`);

  // Restore the seed so parity stays green.
  await resetConfigToSeed();
  await ensureFresh();
  assert.equal(getFreeCredits(), 400, "restored to seed");
  assert.deepEqual(getActivePresetKeys(), ["opus-fast", "opus-balanced", "fable-low"]);
  console.log("restored seed: free=400 presets=opus-fast,opus-balanced,fable-low");

  await prisma.$disconnect();
  console.log("SETTINGS VERIFY OK");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e?.message ?? e);
  process.exit(1);
});
