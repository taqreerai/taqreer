// Preview the credit-gift email by SENDING it (Resend) to a real inbox so the
// wording + rendering can be approved before wiring the admin-grant trigger.
// Sample data only (800 credits = the repricing top-up delta).
//
//   npx tsx scripts/preview-credit-gift-email.ts               -> dev@taqreer.ai, both languages
//   npx tsx scripts/preview-credit-gift-email.ts you@x.com     -> a custom address
//   npx tsx scripts/preview-credit-gift-email.ts you@x.com ar  -> one language only
//
// EVERY RUN SENDS. Needs RESEND_API_KEY + RESEND_FROM_EMAIL (.env.local);
// without them the sender stubs and nothing is sent.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sendCreditGift } = await import("@/lib/email/send-credit-gift");

  const TO = process.argv[2] ?? "dev@taqreer.ai";
  const appOrigin = "https://taqreer.ai";
  const credits = 800;
  // Static sample covers (real prod template thumbnails) - the live path
  // resolves these via getWelcomeTemplates(), which needs the Next runtime
  // (unstable_cache), so the preview passes its own strip.
  const covers = [
    "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/2e04e55b-be03-4f98-b333-6dd0fdf62782/cmplksaqq0003fts0vceho45o/cmplksar30005fts079g8tece/cover-01.webp",
    "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/2e04e55b-be03-4f98-b333-6dd0fdf62782/cmpzzc4dv001ub6s0a0r96s4j/cmpzzc4dz001wb6s0ar50cadv/slide-1.webp",
    "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/2e04e55b-be03-4f98-b333-6dd0fdf62782/cmpeiecz7000m06s0g6ja9qjx/cmpeieczg000o06s0vfproyra/s01-cover.webp",
  ];
  const templates = covers.map((cover, i) => ({ id: `sample-${i}`, cover }));

  const only = process.argv[3];
  const locales = (["en", "ar"] as const).filter((l) => !only || l === only);
  for (const locale of locales) {
    const res = await sendCreditGift({
      toEmail: TO,
      locale,
      appOrigin,
      templates,
      credits,
    });
    console.log(`credit-gift (${locale}):`, res);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
