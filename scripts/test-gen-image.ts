// Phase 0 smoke test for context/images.md.
//   npx tsx scripts/test-gen-image.ts
// Makes ONE real gpt-image-2 call (~$0.04) and stores it in the public
// `generated-images` bucket, then prints the URL. Delete once Phase 2
// exercises this path for real.

import { config } from "dotenv";
config({ path: ".env.local" });

// supabase-js opens a Realtime WebSocket on construct; bare Node <22 (this
// script via tsx) has no global WebSocket. The Next.js runtime provides one,
// so this polyfill is for the SCRIPT only — store.ts stays clean.
import { WebSocket as UndiciWebSocket } from "undici";
(globalThis as unknown as { WebSocket?: unknown }).WebSocket ??= UndiciWebSocket;

import { generateImage } from "../lib/images/gpt-image";
import { storeGeneratedImage } from "../lib/images/store";

// 1×1 transparent PNG — validates the storage path for free before we
// spend a real image-gen call.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main() {
  console.log("[test] storage path check (1×1 png, no API cost)…");
  const tinyUrl = await storeGeneratedImage({
    projectId: "phase0-test",
    genid: "tiny",
    b64: TINY_PNG,
  });
  console.log("[test] ✅ store ok:", tinyUrl);

  console.log("[test] generating image (gpt-image-2, medium, landscape)…");
  const { b64, size } = await generateImage({
    prompt:
      "cinematic wide shot of a modern Riyadh skyline at dusk, warm golden " +
      "light, soft atmospheric haze, premium editorial photography",
    aspect: "landscape",
  });
  console.log(`[test] got ${size}, ~${Math.round(b64.length / 1024)}KB base64. storing…`);

  const url = await storeGeneratedImage({
    projectId: "phase0-test",
    genid: `smoke-${Date.now()}`,
    b64,
  });
  console.log("[test] ✅ public URL:", url);
}

main().catch((err) => {
  console.error("[test] ❌", err);
  process.exit(1);
});
