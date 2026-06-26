// Runtime config — generation presets, tier knobs, and the free-credit amount,
// DB-backed and admin-editable (the /admin/settings tab), with a frozen SEED
// fallback equal to today's code constants so a cold cache OR a DB outage
// degrades to current behaviour.
//
// Consumers read SYNCHRONOUSLY through the accessors (the hot path —
// paramsForPreset in the Inngest step — and the cost math reused by the client
// GenerateSplitButton cannot take `await`). Freshness: an async ensureFresh()
// at server entry points checks PlatformSettings.configVersion at most once per
// TTL and reloads when it changed; admin writes call invalidateLocal() so the
// next read reloads immediately. Prod is a single pm2 process serving both
// /api/admin and the Inngest functions, so this in-process cache is shared.
//
// SEED below is byte-identical to lib/types/quality.ts + quality-params.ts +
// cost.ts; the seed script (scripts/seed-config.ts) writes it to the DB so the
// DB == the constants at launch (asserted by scripts/check-config-parity.ts).

import { prisma } from "@/lib/prisma";
import type { AnthropicCallParams } from "@/lib/anthropic/quality-params";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type PresetConfig = {
  key: string;
  label: string;
  model: string;
  thinking: boolean;
  effort: Effort | null;
  maxTokens: number;
  baseCredits: number;
  perSlideCredits: number;
  secsPerSlide: number;
  baseOverheadSecs: number;
  active: boolean;
  sortOrder: number;
};

export type TierConfigRow = {
  plan: string;
  priceUsd: number;
  monthlyAllotment: number;
  signupGrant: number;
  slideCap: number;
  unlockedPresetKeys: string[];
  flows: string[];
  sortOrder: number;
};

// ─── SEED — equal to the current code constants ───────────────────────
export const SEED_PRESETS: readonly PresetConfig[] = [
  { key: "opus-fast",     label: "Opus 4.8", model: "claude-opus-4-8", thinking: false, effort: null,  maxTokens: 128000, baseCredits: 100, perSlideCredits: 10, secsPerSlide: 8,  baseOverheadSecs: 25, active: true, sortOrder: 0 },
  { key: "opus-balanced", label: "Opus 4.8", model: "claude-opus-4-8", thinking: true,  effort: "low", maxTokens: 128000, baseCredits: 400, perSlideCredits: 22, secsPerSlide: 25, baseOverheadSecs: 60, active: true, sortOrder: 1 },
  { key: "fable-low",     label: "Fable 5",  model: "claude-fable-5",  thinking: true,  effort: "low", maxTokens: 128000, baseCredits: 500, perSlideCredits: 28, secsPerSlide: 20, baseOverheadSecs: 45, active: true, sortOrder: 2 },
];

export const SEED_TIERS: readonly TierConfigRow[] = [
  { plan: "free", priceUsd: 0,  monthlyAllotment: 0,     signupGrant: 400, slideCap: 10, unlockedPresetKeys: ["opus-fast"], flows: ["create"], sortOrder: 0 },
  { plan: "plus", priceUsd: 15, monthlyAllotment: 2000,  signupGrant: 0,   slideCap: 30, unlockedPresetKeys: ["opus-fast", "opus-balanced"], flows: ["create", "enhance", "mimic", "datasheet"], sortOrder: 1 },
  { plan: "pro",  priceUsd: 30, monthlyAllotment: 5000,  signupGrant: 0,   slideCap: 60, unlockedPresetKeys: ["opus-fast", "opus-balanced", "fable-low"], flows: ["create", "enhance", "mimic", "datasheet"], sortOrder: 2 },
  { plan: "max",  priceUsd: 70, monthlyAllotment: 12000, signupGrant: 0,   slideCap: 75, unlockedPresetKeys: ["opus-fast", "opus-balanced", "fable-low"], flows: ["create", "enhance", "mimic", "datasheet"], sortOrder: 3 },
];

// Seed default + regen preset, mirroring DEFAULT_QUALITY / REGEN_QUALITY.
const SEED_DEFAULT_KEY = "opus-fast";

// ─── In-process snapshot ──────────────────────────────────────────────
type Snapshot = {
  presets: Map<string, PresetConfig>;
  tiers: Map<string, TierConfigRow>;
  version: number;
};

const SEED_SNAPSHOT: Snapshot = {
  presets: new Map(SEED_PRESETS.map((p) => [p.key, p])),
  tiers: new Map(SEED_TIERS.map((t) => [t.plan, t])),
  version: 0,
};

let snapshot: Snapshot | null = null;
let lastCheckAt = 0;
const TTL_MS = 30_000;

function current(): Snapshot {
  return snapshot ?? SEED_SNAPSHOT;
}

function rowToPreset(p: {
  key: string; label: string; model: string; thinking: boolean; effort: string | null;
  maxTokens: number; baseCredits: number; perSlideCredits: number; secsPerSlide: number;
  baseOverheadSecs: number; active: boolean; sortOrder: number;
}): PresetConfig {
  return {
    key: p.key, label: p.label, model: p.model, thinking: p.thinking,
    effort: (p.effort as Effort | null) ?? null, maxTokens: p.maxTokens,
    baseCredits: p.baseCredits, perSlideCredits: p.perSlideCredits,
    secsPerSlide: p.secsPerSlide, baseOverheadSecs: p.baseOverheadSecs,
    active: p.active, sortOrder: p.sortOrder,
  };
}
function rowToTier(t: {
  plan: string; priceUsd: number; monthlyAllotment: number; signupGrant: number;
  slideCap: number; unlockedPresetKeys: string[]; flows: string[]; sortOrder: number;
}): TierConfigRow {
  return {
    plan: t.plan, priceUsd: t.priceUsd, monthlyAllotment: t.monthlyAllotment,
    signupGrant: t.signupGrant, slideCap: t.slideCap,
    unlockedPresetKeys: t.unlockedPresetKeys, flows: t.flows, sortOrder: t.sortOrder,
  };
}

/**
 * Refresh the in-process snapshot if cold or past the TTL. Cheap: one indexed
 * read of configVersion in the common (unchanged) case. Call once near the top
 * of an async server entry point that reads config. Never throws — on a DB
 * error it keeps the last-known snapshot (or SEED).
 */
export async function ensureFresh(): Promise<void> {
  const now = Date.now();
  if (snapshot && now - lastCheckAt < TTL_MS) return;
  lastCheckAt = now;
  try {
    const settings = await prisma.platformSettings.findUnique({
      where: { id: "singleton" },
      select: { configVersion: true },
    });
    const version = settings?.configVersion ?? 0;
    if (snapshot && snapshot.version === version) return;
    const [presets, tiers] = await Promise.all([
      prisma.preset.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.tier.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    if (presets.length === 0 || tiers.length === 0) {
      // Not seeded yet — keep serving SEED, but remember the version.
      snapshot = { presets: SEED_SNAPSHOT.presets, tiers: SEED_SNAPSHOT.tiers, version };
      return;
    }
    snapshot = {
      presets: new Map(presets.map((p) => [p.key, rowToPreset(p)])),
      tiers: new Map(tiers.map((t) => [t.plan, rowToTier(t)])),
      version,
    };
  } catch (err) {
    console.error("[runtime-config] load failed, serving last-known/SEED:", err);
    if (!snapshot) snapshot = SEED_SNAPSHOT;
  }
}

/** Drop the local snapshot so the next read reloads. Called after admin writes. */
export function invalidateLocal(): void {
  snapshot = null;
  lastCheckAt = 0;
}

// ─── Sync accessors (read the warm snapshot, else SEED) ───────────────
export function getAllPresets(): PresetConfig[] {
  return [...current().presets.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
export function getActivePresets(): PresetConfig[] {
  return getAllPresets().filter((p) => p.active);
}
export function getPreset(key: string): PresetConfig | undefined {
  return current().presets.get(key);
}
export function getActivePresetKeys(): string[] {
  return getActivePresets().map((p) => p.key);
}

/** Default preset key (= DEFAULT_QUALITY): the seed default if active, else the first active. */
export function defaultPresetKey(): string {
  const active = getActivePresets();
  if (active.some((p) => p.key === SEED_DEFAULT_KEY)) return SEED_DEFAULT_KEY;
  return active[0]?.key ?? SEED_DEFAULT_KEY;
}
/** Regen preset key (= REGEN_QUALITY): the fastest active (no-thinking) preset, else the default. */
export function regenPresetKey(): string {
  const noThink = getActivePresets().find((p) => !p.thinking);
  return noThink?.key ?? defaultPresetKey();
}

/** Anthropic call params for a preset key, or undefined for an unknown key. */
export function paramsForPreset(
  key: string | null | undefined,
): AnthropicCallParams | undefined {
  const p = key ? current().presets.get(key) : undefined;
  if (!p) return undefined;
  if (p.thinking) {
    return {
      model: p.model,
      thinking: { type: "adaptive" },
      ...(p.effort ? { outputConfig: { effort: p.effort } } : {}),
      maxTokens: p.maxTokens,
    };
  }
  return { model: p.model, thinking: { type: "disabled" }, maxTokens: p.maxTokens };
}

/** Credit cost for a preset key; falls back to the default preset for unknown keys. */
export function creditCostFor(key: string): { base: number; perSlide: number } {
  const p = current().presets.get(key) ?? current().presets.get(defaultPresetKey());
  return { base: p?.baseCredits ?? 0, perSlide: p?.perSlideCredits ?? 0 };
}

export function getTier(plan: string): TierConfigRow {
  // Fall back to the live free tier, then to the SEED free tier (always present)
  // so an under-seeded / partially-wiped DB degrades instead of throwing on the
  // non-null assertion.
  return (
    current().tiers.get(plan) ??
    current().tiers.get("free") ??
    SEED_SNAPSHOT.tiers.get("free")!
  );
}
export function getTiers(): TierConfigRow[] {
  return [...current().tiers.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
/** THE free-credit amount — single source of truth = the free tier's signup grant. */
export function getFreeCredits(): number {
  return getTier("free").signupGrant;
}

// Per-tier numbers the PRICING surfaces display, from the live config: the free
// tier shows its signup grant, paid tiers their monthly allotment; `slides` is
// the per-tier cap. The marketing pages + /api/credits feed these into the
// pricing cards (otherwise hardcoded literals) so the advertised figures track
// admin Settings instead of drifting from the grant/charge.
export function pricingDisplayNumbers(): {
  plan: string;
  credits: number;
  slides: number;
}[] {
  // Iterate the FIXED plan set (not getTiers()) so the result ALWAYS carries
  // all four plans. A partially-wiped tiers table can't yield a short list that
  // would leave a card rendering a raw {credits}/{slides} token. getTier() falls
  // back to the free/SEED tier for any missing plan.
  return (["free", "plus", "pro", "max"] as const).map((plan) => {
    const t = getTier(plan);
    return {
      plan,
      credits: plan === "free" ? t.signupGrant : t.monthlyAllotment,
      slides: t.slideCap,
    };
  });
}

// ─── Seed helpers ─────────────────────────────────────────────────────
/**
 * CREATE-ONLY seed: inserts any missing Preset/Tier/PlatformSettings rows from
 * SEED and leaves EXISTING rows untouched, so re-running it (a redeploy runbook,
 * a second `tsx scripts/seed-config.ts`) can never clobber live admin Settings
 * edits. Safe to run repeatedly. This is the prod + scripts/seed-config.ts path.
 */
export async function seedConfig(): Promise<void> {
  for (const p of SEED_PRESETS) {
    await prisma.preset.upsert({ where: { key: p.key }, create: p, update: {} });
  }
  for (const t of SEED_TIERS) {
    await prisma.tier.upsert({ where: { plan: t.plan }, create: t, update: {} });
  }
  await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", configVersion: 1 },
    update: {},
  });
  invalidateLocal();
}

/**
 * DESTRUCTIVE: overwrite every Preset/Tier back to the SEED constants + bump
 * configVersion. ONLY for the local test harness (reset between runs); it
 * discards admin edits, so never wire it to an operator script. The live write
 * path is the audited single-row createPreset/updatePreset/updateTier.
 */
export async function resetConfigToSeed(): Promise<void> {
  for (const p of SEED_PRESETS) {
    await prisma.preset.upsert({ where: { key: p.key }, create: p, update: p });
  }
  for (const t of SEED_TIERS) {
    await prisma.tier.upsert({ where: { plan: t.plan }, create: t, update: t });
  }
  await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", configVersion: 1 },
    update: { configVersion: { increment: 1 } },
  });
  invalidateLocal();
}
