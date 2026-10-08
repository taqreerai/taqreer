// Which frame persona a deck is authored with: the social carousel playbook or
// the presentation one. ONE rule for every job (generation, unlock, partial
// regen, the freeze bake's review) so the prompt and its cache never differ by
// path. Fixed 2026-10-08: the follow-up jobs keyed off the 3:4 format only, so
// a 4:5 / 1:1 social carousel's unlocked posts were written as deck slides.

import { isSocialFormat, type SlideFormat } from "@/lib/schema/slide";

export function frameKindFor(
  projectType: string | null | undefined,
  format: SlideFormat | null | undefined,
): "social" | "deck" {
  return projectType === "social" || isSocialFormat(format ?? undefined) ? "social" : "deck";
}
