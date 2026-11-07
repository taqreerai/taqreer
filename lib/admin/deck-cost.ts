// Admin > what one deck cost (2026-11-07, owner: "I'm burning credits like
// crazy with no traces"): which model did each part of the job, the tokens,
// the real money (micro-dollars stored per call, lib/anthropic/pricing.ts) and
// the credits the user was charged.
//
// Sources, most exact first:
//  - LlmUsage rows for the deck (projectId) and for its upload (sourceKey = the
//    extraction job id named in the deck's source path), one row per call.
//  - Job token totals for generation / partial regeneration, used only when the
//    deck has no per-call rows for them (decks made before per-call tracking).
//  - CreditHold rows (settled charge per job).
//  - GeneratedImage rows (where each picture came from).

import { prisma } from "@/lib/prisma";
import { anthropicCostMicros } from "@/lib/anthropic/pricing";

export type DeckCostRow = {
  purpose: string;
  label: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  usd: number;
  // Image dollars use estimated gpt-image rates; job totals are summed calls.
  basis: "per-call" | "job-total" | "estimate";
};

export type DeckCostJob = {
  type: string;
  status: string;
  quality: string | null;
  model: string | null;
  at: string;
  credits: number | null;
  creditStatus: string | null;
};

export type DeckCost = {
  rows: DeckCostRow[];
  jobs: DeckCostJob[];
  totalUsd: number;
  estimatedUsd: number;
  creditsCharged: number;
  images: { source: string; count: number }[];
  perCallTracked: boolean;
};

const LABELS: Record<string, string> = {
  "deck-generate": "Writing the deck",
  "deck-regenerate": "Slide regenerations",
  "freeze-review": "Design review (Opus)",
  "freeze-haiku-fix": "Fix pass (Haiku)",
  "deck-unlock": "Unlocking locked slides",
  "enhance-plan": "Enhance plan",
  "enhance-check": "Enhance check",
  "extract-enhance-questions": "Reading the file: questions",
  "extract-page-regions": "Reading the file: page regions",
  "extract-text-pictures": "Reading the file: pictures of text",
  "extract-brand-logos": "Reading the file: logos",
  "extract-language": "Reading the file: language",
  "extract-ornaments": "Reading the file: ornaments",
  "extract-hd-pictures": "Reading the file: HD pictures",
  "extract-photo-refresh": "Reading the file: photo refresh",
  "extract-rework-pictures": "Reading the file: rework pictures",
  "stock-check": "Stock photo checks",
  "image-check": "Library photo checks",
  "image-gen": "AI images",
  "image-product": "AI product images",
  "photo-edit": "Photo restore / refresh",
  "image-regen-prompt": "Image prompt rewrite",
  "auto-style": "Style pick",
  "auto-font": "Font pick",
  assistant: "Assistant edits",
  "picture-text": "Picture text",
};

const JOB_PURPOSE: Record<string, string> = {
  "deck.generate": "deck-generate",
  "deck.regenerate.partial": "deck-regenerate",
};

/** The extraction job id a deck's source path names (`<uid>/extract/<jobId>/<file>`). */
function extractJobId(input: unknown): string | null {
  const path = (input as { brief?: { source?: { sourcePath?: unknown } } } | null)?.brief?.source?.sourcePath;
  if (typeof path !== "string") return null;
  const m = /\/extract\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

function imageSource(size: string): string {
  if (!size) return "none";
  const prefix = size.split(":")[0];
  if (prefix === "pexels") return "Stock (Pexels)";
  if (prefix === "lib") return "Library (reused)";
  if (prefix === "commons") return "Wikimedia Commons";
  if (prefix === "flagcdn") return "Flag";
  if (/^\d+x\d+$/.test(size)) return "AI (gpt-image)";
  return prefix;
}

export async function getDeckCost(projectId: string): Promise<DeckCost> {
  const jobs = await prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      status: true,
      quality: true,
      model: true,
      holdKey: true,
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });
  const firstGen = jobs.find((j) => j.type === "deck.generate");
  const firstGenInput = firstGen
    ? (await prisma.job.findUnique({ where: { id: firstGen.id }, select: { inputJson: true } }))?.inputJson
    : null;
  const sourceKey = extractJobId(firstGenInput);

  const [holds, usage, images] = await Promise.all([
    prisma.creditHold.findMany({
      where: { jobKey: { in: jobs.map((j) => j.holdKey ?? j.id) } },
      select: { jobKey: true, status: true, amountHeld: true, amountCharged: true },
    }),
    prisma.llmUsage.findMany({
      where: { OR: [{ projectId }, ...(sourceKey ? [{ sourceKey }] : [])] },
      select: {
        purpose: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        costMicros: true,
      },
    }),
    prisma.generatedImage.findMany({
      where: { version: { presentation: { projectId } }, status: "ready" },
      select: { size: true, storageUrl: true },
    }),
  ]);

  // Per-call rows, grouped by purpose + model.
  const groups = new Map<string, DeckCostRow>();
  for (const u of usage) {
    const key = `${u.purpose}|${u.model}`;
    const g =
      groups.get(key) ??
      ({
        purpose: u.purpose,
        label: LABELS[u.purpose] ?? u.purpose,
        model: u.model,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usd: 0,
        basis: u.model.startsWith("gpt-image") ? "estimate" : "per-call",
      } as DeckCostRow);
    g.calls += 1;
    g.inputTokens += u.inputTokens;
    g.outputTokens += u.outputTokens;
    g.cacheReadTokens += u.cacheReadTokens;
    g.cacheCreationTokens += u.cacheCreationTokens;
    // A row written before costs were stored (costMicros 0) is priced now.
    const micros =
      u.costMicros > 0 || u.model.startsWith("gpt-image")
        ? u.costMicros
        : anthropicCostMicros(u.model, u);
    g.usd += micros / 1_000_000;
    groups.set(key, g);
  }

  // Job totals for generation / regeneration the per-call rows do not cover.
  const perCallPurposes = new Set(usage.map((u) => u.purpose));
  for (const j of jobs) {
    const purpose = JOB_PURPOSE[j.type];
    if (!purpose || perCallPurposes.has(purpose) || !j.model) continue;
    if (j.inputTokens + j.outputTokens === 0) continue;
    const key = `${purpose}|${j.model}|job`;
    const tokens = {
      inputTokens: j.inputTokens,
      outputTokens: j.outputTokens,
      cacheReadTokens: j.cacheReadTokens,
      cacheCreationTokens: j.cacheCreationTokens,
    };
    const g =
      groups.get(key) ??
      ({
        purpose,
        label: LABELS[purpose] ?? purpose,
        model: j.model,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usd: 0,
        basis: "job-total",
      } as DeckCostRow);
    g.calls += 1;
    g.inputTokens += tokens.inputTokens;
    g.outputTokens += tokens.outputTokens;
    g.cacheReadTokens += tokens.cacheReadTokens;
    g.cacheCreationTokens += tokens.cacheCreationTokens;
    g.usd += anthropicCostMicros(j.model, tokens) / 1_000_000;
    groups.set(key, g);
  }

  const rows = [...groups.values()].sort((a, b) => b.usd - a.usd);
  const holdByKey = new Map(holds.map((h) => [h.jobKey, h]));
  const jobRows: DeckCostJob[] = jobs.map((j) => {
    const h = holdByKey.get(j.holdKey ?? j.id);
    return {
      type: j.type,
      status: j.status,
      quality: j.quality,
      model: j.model,
      at: j.createdAt.toISOString(),
      credits: h ? (h.amountCharged ?? (h.status === "held" ? h.amountHeld : 0)) : null,
      creditStatus: h?.status ?? null,
    };
  });

  const imageCounts = new Map<string, Set<string>>();
  for (const im of images) {
    const src = imageSource(im.size);
    const set = imageCounts.get(src) ?? new Set<string>();
    set.add(im.storageUrl ?? `${src}:${set.size}`);
    imageCounts.set(src, set);
  }

  return {
    rows,
    jobs: jobRows,
    totalUsd: rows.reduce((s, r) => s + r.usd, 0),
    estimatedUsd: rows.filter((r) => r.basis === "estimate").reduce((s, r) => s + r.usd, 0),
    creditsCharged: jobRows.reduce((s, j) => s + (j.creditStatus === "settled" ? (j.credits ?? 0) : 0), 0),
    images: [...imageCounts.entries()].map(([source, set]) => ({ source, count: set.size })),
    perCallTracked: usage.length > 0,
  };
}
