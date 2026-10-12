// Per-model "thinking off" capability. The 5.5-era models reject
// `thinking: { type: "disabled" }` at the API (400), each differently
// (probed 2026-09-29):
//   • claude-sonnet-5-5 → lowest setting is `between_tools`
//   • claude-opus-5-5   → `adaptive` + effort only (between_tools rejected too)
//   • claude-fable-*    → `adaptive` only
//   • claude-haiku-5-5  → `adaptive` only (per API docs, not probed)
// Older models (sonnet-5, opus-4-8, ...) still take `disabled`.

import type Anthropic from "@anthropic-ai/sdk";

export type ThinkingOff = { type: "disabled" } | { type: "between_tools" };

const BETWEEN_TOOLS_MODELS = /^claude-sonnet-5-5/;
// Haiku 5.5: adaptive thinking only (API docs), so the admin form must keep
// thinking on for it.
const ADAPTIVE_ONLY_MODELS = /fable|^claude-opus-5-5|^claude-haiku-5-5/i;

/** True when the model has no thinking-off mode (admin must turn thinking on). */
export function requiresThinking(model: string): boolean {
  return ADAPTIVE_ONLY_MODELS.test(model);
}

/** The lowest-thinking param this model accepts, for a thinking-off preset. */
export function thinkingOffFor(model: string): ThinkingOff {
  return BETWEEN_TOOLS_MODELS.test(model) ? { type: "between_tools" } : { type: "disabled" };
}

/** SDK 0.95 types predate `between_tools`; cast at the wire only. */
export function toSdkThinking<T extends { type: string }>(
  thinking: T,
): Anthropic.Messages.ThinkingConfigParam {
  return thinking as unknown as Anthropic.Messages.ThinkingConfigParam;
}
