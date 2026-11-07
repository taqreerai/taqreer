// What one AI call cost us in real money (2026-11-07, owner: "I'm burning
// credits like crazy with no traces"). Anthropic first-party API rates per
// million tokens, from the Claude API reference (cached 2026-10-06). Cache
// reads are listed per model; cache writes are 1.25x input (5-minute TTL).
// Stored on each LlmUsage row at write time, so a later price change never
// rewrites what a past deck cost.
//
// gpt-image-2 (OpenAI) rates are NOT confirmed: the gpt-image-1 per-token
// rates stand in, and the admin view labels image dollars as an estimate.

type Rates = {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  // Haiku 5.5: prompts over `longAbove` tokens bill at the long rates.
  longAbove?: number;
  longIn?: number;
  longOut?: number;
};

const ANTHROPIC: Array<[RegExp, Rates]> = [
  [/^claude-haiku-5-5/, { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longAbove: 100_000, longIn: 0.5, longOut: 2.5 }],
  [/^claude-haiku-4-5/, { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  [/^claude-sonnet-5/, { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/^claude-sonnet-4-6/, { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/^claude-opus-5-5/, { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }],
  [/^claude-opus-(?:5|4-[678])/, { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/^claude-fable-5/, { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
];

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/** Dollar cost of one Anthropic call, in micro-dollars. 0 for an unknown model. */
export function anthropicCostMicros(model: string, u: TokenUsage): number {
  const r = ANTHROPIC.find(([re]) => re.test(model))?.[1];
  if (!r) return 0;
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  const long = r.longAbove !== undefined && prompt > r.longAbove;
  const inRate = long ? (r.longIn ?? r.in) : r.in;
  const outRate = long ? (r.longOut ?? r.out) : r.out;
  const dollars =
    (u.inputTokens * inRate +
      u.outputTokens * outRate +
      u.cacheReadTokens * r.cacheRead +
      u.cacheCreationTokens * r.cacheWrite) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}

/** True when a model's price is known (else the admin view flags it). */
export function isPricedModel(model: string): boolean {
  return ANTHROPIC.some(([re]) => re.test(model)) || model.startsWith("gpt-image");
}

// gpt-image ESTIMATE (gpt-image-1 rates): text input $5, image input $10,
// image output $40 per million tokens.
export function imageCostMicros(u: { textIn: number; imageIn: number; out: number }): number {
  return Math.round((u.textIn * 5 + u.imageIn * 10 + u.out * 40));
}
