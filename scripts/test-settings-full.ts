// Full settings test matrix against the REAL server logic (no Inngest/Claude).
// Creates throwaway users per role, then exercises: the params each preset
// resolves to (what the deck-generate step would push to Claude), per-role
// preset + flow + slide-cap gating via preflightGenerate, the admin superuser
// bypass, free-credit grant propagation, the inactive-preset path, and live
// tier/cost edits. Restores the seed + deletes the test users at the end.
//
//   DATABASE_URL="<dev url>" npx tsx scripts/test-settings-full.ts
import { strict as assert } from "assert";
import { prisma } from "../lib/prisma";
import {
  ensureFresh,
  getActivePresets,
  getActivePresetKeys,
  getPreset,
  getTier,
  getFreeCredits,
  defaultPresetKey,
  creditCostFor,
  resetConfigToSeed,
} from "../lib/config/runtime-config";
import { paramsForQuality } from "../lib/anthropic/quality-params";
import { preflightGenerate } from "../lib/credits/preflight";
import { grantSignupCredits, holdCredits, getBalance } from "../lib/credits/server";
import {
  createPreset,
  updatePreset,
  updateTier,
  deletePreset,
} from "../lib/config/settings-mutations";
import { generationCost, type Flow } from "../lib/credits/cost";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  XX  ${label}   ${detail}`);
  }
}
function deepEq(a: unknown, b: unknown): boolean {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

let adminId = "";

async function createUser(label: string, plan: string, role: string) {
  const email = `test-matrix-${label}@example.com`;
  await prisma.user.deleteMany({ where: { email } });
  const u = await prisma.user.create({ data: { email, plan, role } });
  await prisma.creditAccount.create({
    data: { userId: u.id, subscriptionBalance: 100_000 },
  });
  return { id: u.id, plan, role };
}

async function editTier(
  plan: string,
  patch: Partial<{
    monthlyAllotment: number;
    signupGrant: number;
    slideCap: number;
    unlockedPresetKeys: string[];
    flows: string[];
  }>,
) {
  const t = getTier(plan);
  await updateTier(adminId, plan, {
    monthlyAllotment: patch.monthlyAllotment ?? t.monthlyAllotment,
    signupGrant: patch.signupGrant ?? t.signupGrant,
    slideCap: patch.slideCap ?? t.slideCap,
    unlockedPresetKeys: patch.unlockedPresetKeys ?? [...t.unlockedPresetKeys],
    flows: patch.flows ?? [...t.flows],
  });
  await ensureFresh();
}

async function editPreset(
  key: string,
  patch: Partial<{ baseCredits: number; perSlideCredits: number; active: boolean }>,
) {
  const p = getPreset(key);
  if (!p) throw new Error(`no preset ${key}`);
  await updatePreset(adminId, key, {
    key,
    label: p.label,
    model: p.model,
    thinking: p.thinking,
    effort: p.effort,
    maxTokens: p.maxTokens,
    baseCredits: patch.baseCredits ?? p.baseCredits,
    perSlideCredits: patch.perSlideCredits ?? p.perSlideCredits,
    secsPerSlide: p.secsPerSlide,
    baseOverheadSecs: p.baseOverheadSecs,
    active: patch.active ?? p.active,
  });
  await ensureFresh();
}

const ALL_PRESETS = ["opus-fast", "opus-balanced", "fable-low"];
const PLAN_PRESETS: Record<string, string[]> = {
  free: ["opus-fast"],
  plus: ["opus-fast", "opus-balanced"],
  pro: ["opus-fast", "opus-balanced", "fable-low"],
  max: ["opus-fast", "opus-balanced", "fable-low"],
};
const EXPECTED_PARAMS: Record<string, unknown> = {
  "opus-fast": { model: "claude-opus-4-8", thinking: { type: "disabled" }, maxTokens: 128000 },
  "opus-balanced": {
    model: "claude-opus-4-8",
    thinking: { type: "adaptive" },
    outputConfig: { effort: "low" },
    maxTokens: 128000,
  },
  "fable-low": {
    model: "claude-fable-5",
    thinking: { type: "adaptive" },
    outputConfig: { effort: "low" },
    maxTokens: 128000,
  },
};
const slides = (count: number) => ({ kind: "fixed" as const, count });

async function main() {
  // Start from a known seed so the assertions have a deterministic baseline.
  await resetConfigToSeed();
  await ensureFresh();

  // ── [1] Preset -> Anthropic params (what the generate step sends Claude) ──
  console.log("\n[1] Preset -> Anthropic call params (Inngest off; the model/config pushed to Claude):");
  for (const key of ALL_PRESETS) {
    check(
      `${key} -> expected model/thinking/effort/maxTokens`,
      deepEq(paramsForQuality(key), EXPECTED_PARAMS[key]),
      JSON.stringify(paramsForQuality(key)),
    );
  }
  check(
    "legacy key 'opus-max' falls back to opus-balanced params",
    deepEq(paramsForQuality("opus-max"), EXPECTED_PARAMS["opus-balanced"]),
  );

  // ── test users per role ──
  const u = {
    free: await createUser("free", "free", "user"),
    plus: await createUser("plus", "plus", "user"),
    pro: await createUser("pro", "pro", "user"),
    max: await createUser("max", "max", "user"),
  };
  const admin = await createUser("admin", "free", "admin");
  adminId = admin.id;
  console.log("\ncreated test users: free, plus, pro, max (role=user) + admin (role=admin)");

  // ── [2] Per-role preset gating ──
  console.log("\n[2] Per-role preset gating (preflight, flow=create, 5 slides):");
  for (const plan of ["free", "plus", "pro", "max"] as const) {
    for (const preset of ALL_PRESETS) {
      const r = await preflightGenerate({
        userId: u[plan].id,
        plan,
        flow: "create",
        preset,
        slideInput: slides(5),
        isAdmin: false,
      });
      const shouldUnlock = PLAN_PRESETS[plan].includes(preset);
      const got = r.ok ? "ok" : r.reason;
      const okExpected = shouldUnlock ? r.ok : !r.ok && r.reason === "preset_locked";
      check(`${plan} + ${preset} -> ${shouldUnlock ? "ok" : "preset_locked"}`, okExpected, `got ${got}`);
      // the quotes array's per-preset unlocked flag must agree
      const q = r.quotes.find((x) => x.preset === preset);
      check(`  quote.unlocked(${plan},${preset}) == ${shouldUnlock}`, q?.unlocked === shouldUnlock, `quote ${q?.unlocked}`);
    }
  }

  // ── [3] Flow gating ──
  console.log("\n[3] Flow gating (free unlocks only 'create'):");
  for (const flow of ["enhance", "mimic", "datasheet"] as Flow[]) {
    const r = await preflightGenerate({ userId: u.free.id, plan: "free", flow, preset: "opus-fast", slideInput: slides(5), isAdmin: false });
    check(`free + ${flow} -> flow_locked`, !r.ok && r.reason === "flow_locked", `got ${r.ok ? "ok" : r.reason}`);
  }
  {
    const r = await preflightGenerate({ userId: u.plus.id, plan: "plus", flow: "enhance", preset: "opus-fast", slideInput: slides(5), isAdmin: false });
    check("plus + enhance -> ok", r.ok, `got ${r.ok ? "ok" : r.reason}`);
  }

  // ── [4] Admin superuser bypass — excluded from EVERY tier knob ──
  console.log("\n[4] Admin superuser bypass (role=admin, plan=free, isAdmin -> everything unlocked):");
  {
    // Every flow x every active preset, on the lowest (free) plan -> all ok.
    // The admin bypasses flow + preset gating regardless of its own tier.
    for (const flow of ["create", "enhance", "mimic", "datasheet"] as Flow[]) {
      for (const preset of ALL_PRESETS) {
        const r = await preflightGenerate({ userId: admin.id, plan: "free", flow, preset, slideInput: slides(5), isAdmin: true });
        check(`admin + ${flow} + ${preset} -> ok`, r.ok, `got ${r.ok ? "ok" : r.reason}`);
      }
    }
    // Slide cap: bypasses the tier cap up to the SYSTEM ceiling (75) ...
    const cap = await preflightGenerate({ userId: admin.id, plan: "free", flow: "create", preset: "opus-fast", slideInput: slides(50), isAdmin: true });
    check("admin + 50 slides (free tier cap 10) -> ok (raised to 75)", cap.ok, `got ${cap.ok ? "ok" : cap.reason}`);
    // ... but NOT past it: 75 is a hard output-token ceiling, not a tier knob.
    const over = await preflightGenerate({ userId: admin.id, plan: "free", flow: "create", preset: "opus-fast", slideInput: slides(80), isAdmin: true });
    check("admin + 80 slides -> slide_cap_exceeded (75 is a token ceiling, not a knob)", !over.ok && over.reason === "slide_cap_exceeded", `got ${over.ok ? "ok" : over.reason}`);
    // Never charged: a waived hold debits nothing.
    const before = (await getBalance(admin.id)).total;
    const h = await holdCredits({ userId: admin.id, jobKey: `test-admin-waive-${admin.id}`, amount: 9999, waive: true, metadata: { kind: "test" } });
    const after = (await getBalance(admin.id)).total;
    check("admin hold is waived -> balance unchanged (never charged)", h.ok && before === after, `ok ${h.ok}, ${before} -> ${after}`);
  }

  // ── [5] Slide cap per tier (exact count above cap) ──
  console.log("\n[5] Slide-cap gating (exact counts):");
  {
    const free = await preflightGenerate({ userId: u.free.id, plan: "free", flow: "create", preset: "opus-fast", slideInput: slides(15), isAdmin: false });
    check("free + 15 (cap 10) -> slide_cap_exceeded", !free.ok && free.reason === "slide_cap_exceeded", `got ${free.ok ? "ok" : free.reason}`);
    const plus = await preflightGenerate({ userId: u.plus.id, plan: "plus", flow: "create", preset: "opus-fast", slideInput: slides(15), isAdmin: false });
    check("plus + 15 (cap 30) -> ok", plus.ok, `got ${plus.ok ? "ok" : plus.reason}`);
    const max = await preflightGenerate({ userId: u.max.id, plan: "max", flow: "create", preset: "opus-fast", slideInput: slides(80), isAdmin: false });
    check("max + 80 (cap 75) -> slide_cap_exceeded", !max.ok && max.reason === "slide_cap_exceeded", `got ${max.ok ? "ok" : max.reason}`);
  }

  // ── [6] Free-credit signup grant + live propagation ──
  console.log("\n[6] Free-credit grant propagation:");
  {
    const fresh1 = await createUser("fresh1", "free", "user");
    const g1 = await grantSignupCredits({ userId: fresh1.id, notify: false });
    check(`fresh signup grant == getFreeCredits() (${getFreeCredits()})`, g1.granted === getFreeCredits(), `granted ${g1.granted}`);
    await editTier("free", { signupGrant: 333 });
    const fresh2 = await createUser("fresh2", "free", "user");
    const g2 = await grantSignupCredits({ userId: fresh2.id, notify: false });
    check("after editing free credits -> 333, a new signup grants 333", g2.granted === 333, `granted ${g2.granted}`);
    await editTier("free", { signupGrant: 400 });
  }

  // ── [7] Inactive preset: hidden from picker + active set + coerced ──
  console.log("\n[7] Deactivate Fable -> hidden + coerced:");
  {
    await editPreset("fable-low", { active: false });
    check("getActivePresetKeys excludes inactive fable-low", !getActivePresetKeys().includes("fable-low"));
    check("picker payload (getActivePresets) excludes fable-low", !getActivePresets().some((p) => p.key === "fable-low"));
    const resolved = getActivePresetKeys().includes("fable-low") ? "fable-low" : defaultPresetKey();
    check("a direct fable-low request coerces to default (opus-fast)", resolved === "opus-fast", `got ${resolved}`);
    await editPreset("fable-low", { active: true });
    check("reactivated fable-low is back in the active set", getActivePresetKeys().includes("fable-low"));
  }

  // ── [8] Tier knob edit propagates to gating ──
  console.log("\n[8] Unlock Fable for the plus tier -> preflight reflects it:");
  {
    const before = await preflightGenerate({ userId: u.plus.id, plan: "plus", flow: "create", preset: "fable-low", slideInput: slides(5), isAdmin: false });
    check("plus + fable-low -> preset_locked (before)", !before.ok && before.reason === "preset_locked", `got ${before.ok ? "ok" : before.reason}`);
    await editTier("plus", { unlockedPresetKeys: ["opus-fast", "opus-balanced", "fable-low"] });
    const after = await preflightGenerate({ userId: u.plus.id, plan: "plus", flow: "create", preset: "fable-low", slideInput: slides(5), isAdmin: false });
    check("plus + fable-low -> ok (after unlocking)", after.ok, `got ${after.ok ? "ok" : after.reason}`);
    await editTier("plus", { unlockedPresetKeys: ["opus-fast", "opus-balanced"] });
  }

  // ── [9] Preset cost edit -> charge, and shown == charged ──
  console.log("\n[9] Edit opus-fast cost -> the charge + the picker estimate both track it:");
  {
    await editPreset("opus-fast", { baseCredits: 150 });
    const r = await preflightGenerate({ userId: u.pro.id, plan: "pro", flow: "create", preset: "opus-fast", slideInput: slides(5), isAdmin: false });
    check("charge reflects edited cost: 150 + 5*10 = 200", r.ok && r.holdCredits === 200, `holdCredits ${r.ok ? r.holdCredits : r.reason}`);
    const p = getActivePresets().find((x) => x.key === "opus-fast");
    const shown = p ? p.baseCredits + 5 * p.perSlideCredits : -1;
    check("picker estimate == charge (200)", shown === 200, `shown ${shown}`);
    await editPreset("opus-fast", { baseCredits: 100 });
  }

  // ── [10] Settle parity: the deck-generate settle charges what the hold quoted
  //        (DB-aware preset + DB cost) — the two HIGH bugs the review caught ──
  console.log("\n[10] Settle parity (hold == settle for a DB-added preset + a cost edit):");
  {
    // A preset that exists only in the DB (not in the bundled snapshot).
    await createPreset(adminId, {
      key: "test-ultra",
      label: "Ultra",
      model: "claude-opus-4-8",
      thinking: false,
      effort: null,
      maxTokens: 128000,
      baseCredits: 800,
      perSlideCredits: 40,
      secsPerSlide: 8,
      baseOverheadSecs: 25,
      active: true,
    });
    await editTier("max", { unlockedPresetKeys: [...getTier("max").unlockedPresetKeys, "test-ultra"] });
    const hold = await preflightGenerate({ userId: u.max.id, plan: "max", flow: "create", preset: "test-ultra", slideInput: slides(6), isAdmin: false });
    // Mirror of the deck-generate settle: price on the held key via creditCostFor.
    const settle = generationCost("test-ultra", 6, creditCostFor);
    check(
      "DB-added preset: hold == settle (800 + 6*40 = 1040), not opus-balanced 532",
      hold.ok && hold.holdCredits === 1040 && settle === 1040,
      `hold ${hold.ok ? hold.holdCredits : hold.reason}, settle ${settle}`,
    );
    // Mid-run deactivation: the held key stays in the preset map, so the settle
    // still prices on it (== hold) instead of dropping to a cheaper default.
    await editPreset("test-ultra", { active: false });
    const settleAfter = generationCost("test-ultra", 6, creditCostFor);
    check(
      "settle still prices the held preset after mid-run deactivation (1040)",
      settleAfter === 1040,
      `settleAfter ${settleAfter}`,
    );
    await deletePreset(adminId, "test-ultra");
    await ensureFresh();

    // A cost edit must flow to BOTH the hold and the settle.
    await editPreset("opus-fast", { baseCredits: 200 });
    const hold2 = await preflightGenerate({ userId: u.pro.id, plan: "pro", flow: "create", preset: "opus-fast", slideInput: slides(5), isAdmin: false });
    const settle2 = generationCost("opus-fast", 5, creditCostFor);
    check(
      "cost edit: hold == settle (200 + 5*10 = 250), not static 150",
      hold2.ok && hold2.holdCredits === 250 && settle2 === 250,
      `hold ${hold2.ok ? hold2.holdCredits : hold2.reason}, settle ${settle2}`,
    );
    await editPreset("opus-fast", { baseCredits: 100 });
  }
}

async function run() {
  try {
    await main();
  } finally {
    await resetConfigToSeed().catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { startsWith: "test-matrix-" } } })
      .catch(() => {});
  }
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

run().catch(async (e) => {
  console.error("RUNNER ERROR:", e?.stack ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
