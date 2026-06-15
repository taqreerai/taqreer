// Preview the billing emails by SENDING them (Resend) to a real inbox so you
// can see how they render in a client. Sample data only.
//
//   npx tsx scripts/preview-billing-emails.ts            -> dev@taqreer.ai
//   npx tsx scripts/preview-billing-emails.ts you@x.com  -> a custom address
//
// Sends all three (receipt / payment-failed / subscription-ending) in BOTH
// languages = 6 emails. Needs RESEND_API_KEY + RESEND_FROM_EMAIL (.env.local);
// without them the senders stub and nothing is sent.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { sendReceipt, sendPaymentFailed, sendSubscriptionEnding } =
    await import("@/lib/email/billing");

  const TO = process.argv[2] ?? "dev@taqreer.ai";
  const appOrigin = "https://taqreer.ai";
  const invoiceUrl = "https://invoice.stripe.com/i/preview-sample";

  const jobs: Array<{ name: string; run: () => Promise<unknown> }> = [
    {
      name: "receipt (en)",
      run: () =>
        sendReceipt({
          toEmail: TO, locale: "en", appOrigin,
          planLabel: "Plus (monthly)", amount: "$15.00",
          dateLabel: "15 June 2026", invoiceNumber: "TQR-001042",
          periodLabel: "15 Jun - 15 Jul 2026", invoiceUrl,
        }),
    },
    {
      name: "payment-failed (en)",
      run: () =>
        sendPaymentFailed({
          toEmail: TO, locale: "en", appOrigin,
          planLabel: "Plus (monthly)", amount: "$15.00",
        }),
    },
    {
      name: "subscription-ending (en)",
      run: () =>
        sendSubscriptionEnding({
          toEmail: TO, locale: "en", appOrigin,
          planLabel: "Plus (monthly)", endDateLabel: "15 July 2026",
        }),
    },
    {
      name: "receipt (ar)",
      run: () =>
        sendReceipt({
          toEmail: TO, locale: "ar", appOrigin,
          planLabel: "Plus (شهري)", amount: "56.25 ر.س",
          dateLabel: "15 يونيو 2026", invoiceNumber: "TQR-001042",
          periodLabel: "15 يونيو - 15 يوليو 2026", invoiceUrl,
        }),
    },
    {
      name: "payment-failed (ar)",
      run: () =>
        sendPaymentFailed({
          toEmail: TO, locale: "ar", appOrigin,
          planLabel: "Plus (شهري)", amount: "56.25 ر.س",
        }),
    },
    {
      name: "subscription-ending (ar)",
      run: () =>
        sendSubscriptionEnding({
          toEmail: TO, locale: "ar", appOrigin,
          planLabel: "Plus (شهري)", endDateLabel: "15 يوليو 2026",
        }),
    },
  ];

  console.log(`Sending ${jobs.length} preview emails to ${TO}…\n`);
  for (const job of jobs) {
    const res = await job.run();
    console.log(`  ${job.name}: ${JSON.stringify(res)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
