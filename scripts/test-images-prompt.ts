// Phase 1 check for context/images.md — the two-prompt (shared-core) design.
//   npx tsx scripts/test-images-prompt.ts
// Verifies: (1) the base SYSTEM_PROMPT is byte-IDENTICAL to its pre-refactor
// snapshot (shared invariants didn't drift); (2) SYSTEM_PROMPT_IMAGES swaps
// only the 3 direction sections (box contract in, SVG-only out) while keeping
// the shared core; (3) isImagesMode gates to create/scratch only.
// No Claude call — the "Claude emits good boxes" proof is a live app run.

import { config } from "dotenv";
config({ path: ".env.local" }); // before importing deck-generate (lib/prisma)
import { WebSocket as UndiciWebSocket } from "undici";
(globalThis as unknown as { WebSocket?: unknown }).WebSocket ??= UndiciWebSocket;
import { createHash } from "node:crypto";

// Byte-identity snapshot of the base SYSTEM_PROMPT. Re-baseline this hash
// (run the test, copy the printed value) ONLY when you intentionally edit the
// shared prompt core — it guards against accidental drift between the base and
// images variants. Last re-baselined for the top-level `slideCount` field.
const BASE_SHA256 = "e0b9d387ca6bdabae371e3eadfd111d9e28d659c1b65485484a559b0a1cc229b";

async function main(): Promise<boolean> {
  const { SYSTEM_PROMPT, SYSTEM_PROMPT_IMAGES, isImagesMode } = await import(
    "../inngest/functions/deck-generate"
  );

  let ok = true;
  const check = (label: string, cond: boolean) => {
    console.log(`${cond ? "✅" : "❌"} ${label}`);
    if (!cond) ok = false;
  };

  // 1) Base prompt unchanged — shared invariants didn't drift.
  const baseHash = createHash("sha256").update(SYSTEM_PROMPT).digest("hex");
  check(`SYSTEM_PROMPT is byte-identical to snapshot (${baseHash.slice(0, 12)}…)`,
    baseHash === BASE_SHA256);

  // 2) Images prompt: direction swapped IN, SVG-only swapped OUT.
  const inImages = ["PHOTOGRAPHY-LED", "data-genimage", "data-genaspect", "COVER MUST", "SCRIM (hard rule)"];
  check("SYSTEM_PROMPT_IMAGES contains the box contract + photo direction",
    inImages.every((m) => SYSTEM_PROMPT_IMAGES.includes(m)));
  check('SYSTEM_PROMPT_IMAGES dropped "GRAPHICS — inline SVG only"',
    !SYSTEM_PROMPT_IMAGES.includes("GRAPHICS — inline SVG only"));
  check("SYSTEM_PROMPT_IMAGES differs from base",
    SYSTEM_PROMPT_IMAGES !== SYSTEM_PROMPT);

  // 3) Shared CORE preserved in the images prompt (the user's "standard for
  //    all flows": BiDi, chrome, icons, typography, contrast, OUTPUT schema, fonts).
  const sharedCore = [
    "LANGUAGE & DIRECTION",
    "ICONS — Lucide stroke icons",
    "COLOUR CONTRAST — non-negotiable",
    "TYPOGRAPHY",
    '"version": "2.0"',
    "FONT SOURCING",
  ];
  check("SYSTEM_PROMPT_IMAGES keeps the shared core verbatim",
    sharedCore.every((m) => SYSTEM_PROMPT_IMAGES.includes(m) && SYSTEM_PROMPT.includes(m)));

  // 4) isImagesMode gating.
  type Ev = Parameters<typeof isImagesMode>[0];
  const ev = (brief: Record<string, unknown>, type = "create") =>
    ({ projectId: "p", presentationId: "x", versionId: "v", type, brief } as Ev);
  check("isImagesMode: create + imagesMode:true → true",
    isImagesMode(ev({ imagesMode: true })) === true);
  check("isImagesMode: create + imagesMode:false → false",
    isImagesMode(ev({ imagesMode: false })) === false);
  check("isImagesMode: create + no flag → false",
    isImagesMode(ev({})) === false);
  check("isImagesMode: mimic source → false",
    isImagesMode(ev({ imagesMode: true, source: { kind: "mimic" } })) === false);
  check("isImagesMode: enhance flow → false",
    isImagesMode(ev({ imagesMode: true }, "enhance")) === false);

  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error("[test] ❌ module/import error:", err);
    process.exit(1);
  });
