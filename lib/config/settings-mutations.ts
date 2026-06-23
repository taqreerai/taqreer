// Server-only write helpers for the admin Settings tab. Every mutation runs in
// one transaction that (1) applies the change, (2) bumps PlatformSettings.
// configVersion so every process reloads the cache, and (3) writes a UsageEvent
// audit row (the established audit channel). After commit it invalidates the
// in-process snapshot so the next read reflects the change immediately.
//
// Validation throws ValidationError (-> 400 at the route); anything else is a
// 500. Guards protect the invariant that EVERY tier keeps >= 1 active preset.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidateLocal } from "@/lib/config/runtime-config";
import { ALL_FLOWS, SYSTEM_SLIDE_CAP } from "@/lib/credits/cost";
import { listModels } from "@/lib/anthropic/models";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export type PresetInput = {
  key: string;
  label: string;
  model: string;
  thinking: boolean;
  effort: string | null;
  maxTokens: number;
  baseCredits: number;
  perSlideCredits: number;
  secsPerSlide: number;
  baseOverheadSecs: number;
  active: boolean;
};

export type TierInput = {
  monthlyAllotment: number;
  signupGrant: number;
  slideCap: number;
  unlockedPresetKeys: string[];
  flows: string[];
};

// Coerce a parsed JSON body into the typed input. Numbers may arrive as strings
// from form fields; coercion to NaN is then caught by validation downstream.
// An empty / whitespace-only / missing numeric field becomes NaN (not 0) so
// validation rejects it. The cost fields additionally require > 0
// (validatePresetShape), so a cleared field the client coerces to 0 is rejected
// too, instead of silently storing a zero-cost (free) preset.
const num = (v: unknown): number => {
  if (v == null) return NaN;
  const s = String(v).trim();
  return s === "" ? NaN : Number(s);
};

export function parsePresetInput(body: Record<string, unknown>): PresetInput {
  return {
    key: String(body.key ?? "").trim(),
    label: String(body.label ?? ""),
    model: String(body.model ?? ""),
    thinking: Boolean(body.thinking),
    effort: body.effort ? String(body.effort) : null,
    maxTokens: num(body.maxTokens),
    baseCredits: num(body.baseCredits),
    perSlideCredits: num(body.perSlideCredits),
    secsPerSlide: num(body.secsPerSlide),
    baseOverheadSecs: num(body.baseOverheadSecs),
    active: body.active !== false,
  };
}

export function parseTierInput(body: Record<string, unknown>): TierInput {
  return {
    monthlyAllotment: num(body.monthlyAllotment),
    signupGrant: num(body.signupGrant),
    slideCap: num(body.slideCap),
    unlockedPresetKeys: Array.isArray(body.unlockedPresetKeys)
      ? body.unlockedPresetKeys.map(String)
      : [],
    flows: Array.isArray(body.flows) ? body.flows.map(String) : [],
  };
}

export class ValidationError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ValidationError(msg);
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

// mutate -> bump configVersion -> audit, then drop the local cache.
async function commit(opts: {
  adminUserId: string;
  eventType: string;
  metadata: Prisma.InputJsonValue;
  mutate: (tx: Prisma.TransactionClient) => Promise<void>;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await opts.mutate(tx);
    await tx.platformSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", configVersion: 1 },
      update: { configVersion: { increment: 1 } },
    });
    await tx.usageEvent.create({
      data: {
        userId: opts.adminUserId,
        eventType: opts.eventType,
        amount: 1,
        metadata: opts.metadata,
      },
    });
  });
  invalidateLocal();
}

function validatePresetShape(input: PresetInput) {
  assert(
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.key),
    "Key must be lowercase kebab-case, e.g. opus-fast.",
  );
  assert(input.label.trim().length > 0, "Label is required.");
  assert(input.model.trim().length > 0, "Model is required.");
  assert(
    isNonNegInt(input.maxTokens) && input.maxTokens > 0,
    "Max tokens must be a positive integer.",
  );
  // Cost fields require > 0: a cleared field arrives from the client as 0, and a
  // 0-cost preset would generate for free. An explicit non-zero is required.
  assert(
    isNonNegInt(input.baseCredits) && input.baseCredits > 0,
    "Base credits must be a positive integer.",
  );
  assert(
    isNonNegInt(input.perSlideCredits) && input.perSlideCredits > 0,
    "Per-slide credits must be a positive integer.",
  );
  assert(isNonNegInt(input.secsPerSlide), "Secs/slide must be a non-negative integer.");
  assert(
    isNonNegInt(input.baseOverheadSecs),
    "Base overhead secs must be a non-negative integer.",
  );
  if (input.thinking) {
    assert(
      input.effort != null && (EFFORTS as readonly string[]).includes(input.effort),
      "Effort is required (low/medium/high/xhigh/max) when thinking is on.",
    );
  }
  // Fable models reject thinking:disabled at the API, so force thinking on.
  if (/fable/i.test(input.model)) {
    assert(
      input.thinking,
      "Fable models require thinking on (they reject thinking:disabled).",
    );
  }
}

function effortFor(input: PresetInput): Effort | null {
  return input.thinking ? (input.effort as Effort) : null;
}

// Reject a model id that isn't in the live Anthropic catalog, so a typo is
// caught at save time instead of 400-ing every generation on that preset.
// Degrades to the non-empty check (validatePresetShape) when the live list is
// unavailable (no API key / fetch failed), so the picker never hard-blocks.
async function assertModelInLiveList(model: string): Promise<void> {
  const models = await listModels();
  if (models.length === 0) return;
  assert(
    models.some((m) => m.id === model.trim()),
    `Model "${model.trim()}" is not in the live Anthropic model list.`,
  );
}

export async function createPreset(
  adminUserId: string,
  input: PresetInput,
): Promise<void> {
  validatePresetShape(input);
  await assertModelInLiveList(input.model);
  const existing = await prisma.preset.findUnique({ where: { key: input.key } });
  assert(!existing, `A preset with key "${input.key}" already exists.`);
  const maxSort =
    (await prisma.preset.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1;
  await commit({
    adminUserId,
    eventType: "admin.settings.preset.create",
    metadata: { key: input.key, model: input.model.trim() },
    mutate: async (tx) => {
      await tx.preset.create({
        data: {
          key: input.key,
          label: input.label.trim(),
          model: input.model.trim(),
          thinking: input.thinking,
          effort: effortFor(input),
          maxTokens: input.maxTokens,
          baseCredits: input.baseCredits,
          perSlideCredits: input.perSlideCredits,
          secsPerSlide: input.secsPerSlide,
          baseOverheadSecs: input.baseOverheadSecs,
          active: input.active,
          sortOrder: maxSort + 1,
        },
      });
    },
  });
}

export async function updatePreset(
  adminUserId: string,
  key: string,
  input: PresetInput,
): Promise<void> {
  assert(input.key === key, "Preset key cannot change.");
  validatePresetShape(input);
  await assertModelInLiveList(input.model);
  const existing = await prisma.preset.findUnique({ where: { key } });
  assert(existing, `Preset "${key}" not found.`);
  // Deactivating must not strand any tier with zero active presets.
  if (!input.active && existing.active) {
    await assertTiersKeepActivePreset(key);
  }
  await commit({
    adminUserId,
    eventType: "admin.settings.preset.update",
    metadata: { key },
    mutate: async (tx) => {
      await tx.preset.update({
        where: { key },
        data: {
          label: input.label.trim(),
          model: input.model.trim(),
          thinking: input.thinking,
          effort: effortFor(input),
          maxTokens: input.maxTokens,
          baseCredits: input.baseCredits,
          perSlideCredits: input.perSlideCredits,
          secsPerSlide: input.secsPerSlide,
          baseOverheadSecs: input.baseOverheadSecs,
          active: input.active,
        },
      });
    },
  });
}

export async function deletePreset(adminUserId: string, key: string): Promise<void> {
  const existing = await prisma.preset.findUnique({ where: { key } });
  assert(existing, `Preset "${key}" not found.`);
  // Can't orphan a tier (covers "the free tier depends on it").
  await assertTiersKeepActivePreset(key);
  await commit({
    adminUserId,
    eventType: "admin.settings.preset.delete",
    metadata: { key },
    mutate: async (tx) => {
      const tiers = await tx.tier.findMany();
      for (const t of tiers) {
        if (t.unlockedPresetKeys.includes(key)) {
          await tx.tier.update({
            where: { plan: t.plan },
            data: {
              unlockedPresetKeys: t.unlockedPresetKeys.filter((k) => k !== key),
            },
          });
        }
      }
      await tx.preset.delete({ where: { key } });
    },
  });
}

export async function updateTier(
  adminUserId: string,
  plan: string,
  input: TierInput,
): Promise<void> {
  const existing = await prisma.tier.findUnique({ where: { plan } });
  assert(existing, `Tier "${plan}" not found.`);
  assert(
    isNonNegInt(input.monthlyAllotment),
    "Monthly credits must be a non-negative integer.",
  );
  assert(
    isNonNegInt(input.signupGrant),
    "Signup grant must be a non-negative integer.",
  );
  assert(
    isNonNegInt(input.slideCap) &&
      input.slideCap >= 1 &&
      input.slideCap <= SYSTEM_SLIDE_CAP,
    `Slide cap must be between 1 and ${SYSTEM_SLIDE_CAP}.`,
  );
  assert(input.flows.length >= 1, "Each tier must keep at least one flow.");
  for (const f of input.flows) {
    assert((ALL_FLOWS as readonly string[]).includes(f), `Unknown flow "${f}".`);
  }
  const presets = await prisma.preset.findMany();
  const presetByKey = new Map(presets.map((p) => [p.key, p]));
  for (const k of input.unlockedPresetKeys) {
    assert(presetByKey.has(k), `Unknown preset "${k}".`);
  }
  const activeUnlocked = input.unlockedPresetKeys.filter(
    (k) => presetByKey.get(k)?.active,
  );
  assert(activeUnlocked.length >= 1, "Each tier must keep at least one active preset.");
  await commit({
    adminUserId,
    eventType: "admin.settings.tier.update",
    metadata: { plan, signupGrant: input.signupGrant },
    mutate: async (tx) => {
      await tx.tier.update({
        where: { plan },
        data: {
          monthlyAllotment: input.monthlyAllotment,
          signupGrant: input.signupGrant,
          slideCap: input.slideCap,
          unlockedPresetKeys: input.unlockedPresetKeys,
          flows: input.flows,
        },
      });
    },
  });
}

// After removing/deactivating `key`, every tier must still have >= 1 active
// unlocked preset, else generation for that tier would be impossible.
async function assertTiersKeepActivePreset(key: string): Promise<void> {
  const [tiers, presets] = await Promise.all([
    prisma.tier.findMany(),
    prisma.preset.findMany(),
  ]);
  const activeKeys = new Set(
    presets.filter((p) => p.active && p.key !== key).map((p) => p.key),
  );
  for (const t of tiers) {
    const remaining = t.unlockedPresetKeys.filter(
      (k) => k !== key && activeKeys.has(k),
    );
    assert(
      remaining.length >= 1,
      `Tier "${t.plan}" would be left with no active preset. Unlock another preset for it first.`,
    );
  }
}
