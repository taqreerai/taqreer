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
// images variants. Last re-baselined for the weights-are-Claude's-choice
// typography rule (no two-weight limit; named-weight font embed).
// Re-baselined 2026-06-01: added the uploaded-brand-font rule to FONT SOURCING
// (Claude pairs uploaded families to fontHeading/fontBody, emits name only).
// Re-baselined 2026-06-01: strengthened that rule for multi-weight uploads —
// ONLY uploaded families (no Google/system fallback) + per-weight faces.
// Re-baselined 2026-06-01: added the COUNTRY FLAGS section (flagcdn.com SVG
// by ISO 3166-1 alpha-2; inlines as a vector on export, no data-fill). In
// the shared core so it rides into SYSTEM_PROMPT_IMAGES too.
// Re-baselined 2026-06-01: added the BACKGROUND rule (theme.background +
// slide surfaces must be a brand-palette colour; never an invented
// off-palette dark canvas). Shared core → applies to images decks too.
// Re-baselined 2026-06-01: prompt audit — REMOVED the COLOUR CONTRAST
// section (its "white on dark / near-black on light" fallback was biasing
// Claude toward dark canvases) and rewrote DESIGN TOKENS → "BRAND PALETTE
// & FONT" (drop the primary/secondary/brand-bg role labels — just give the
// palette to use freely; fonts are one family now).
// Re-baselined 2026-06-01: dropped the "Dominant colour + 1–2 accents.
// Vary themes across the deck." line from DESIGN PHILOSOPHY (base + images)
// — it limited palette use / leaned monochromatic-dark. The DESIGN
// PHILOSOPHY→IMG swap end-marker moved to "multi-column editorial."
// Re-baselined 2026-06-01: removed redundancy by request — deleted the whole
// DESIGN PHILOSOPHY section (base) + its base→images swap (the image-led line
// now leads IMG_LAYOUT_MENU), the "Asymmetric split-screen" layout bullet,
// and the COMPOSITION DIRECTION block from COMPOSITION_RULES (its "(per
// COMPOSITION DIRECTION)" cross-ref in GRAPHICS dropped). The images prompt
// now swaps TWO sections, not three.
const BASE_SHA256 = "4a20918104bb31faf007ae67624236e945719c95ac238e0849ffc920a162fa15";

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
  const inImages = ["IMAGE STYLE", "data-genimage", "data-genaspect", "THE COVER", "SCRIM (hard rule)"];
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
    "BACKGROUND — on-brand surface",
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
