// Render the runtime (Resend) emails to public/email-lab/gen-*.html with sample
// data so the shell + helpers (credits pill, templates strip, summary, fields)
// are verifiable in the browser. Localhost asset paths. Preview-only.
//
//   npx tsx scripts/preview-emails.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  renderEmail,
  summaryBlock,
  templatesStrip,
  fieldsBlock,
} from "../lib/email/shell";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (name: string, html: string) =>
  fs.writeFileSync(path.join(root, "public/email-lab", `gen-${name}.html`), html);

const COVERS = [
  "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/2e04e55b-be03-4f98-b333-6dd0fdf62782/cmpeiecz7000m06s0g6ja9qjx/cmpeieczg000o06s0vfproyra/s01-cover.webp",
  "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/d0ad296c-d3d9-4f0a-85fc-b45d839fc954/cmqb1sjkm0001gas0hp647h20/cmqb1sjkt0003gas0knfzqjs1/slide-1.webp",
  "https://fdayuyccygoombuphnvf.supabase.co/storage/v1/object/public/slide-previews/2e04e55b-be03-4f98-b333-6dd0fdf62782/cmpyh8qm9000urjs0ajbznx01/cmpyh8qmk000wrjs07sxxs3hg/s1-cover.webp",
];

const pill = (label: string) => `
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
                  <tr><td style="background:#16233a;border:1px solid rgba(51,128,255,0.30);border-radius:999px;padding:6px 15px;font-size:12px;font-weight:600;color:#66A3FF;">${label}</td></tr>
                </table>`;

// Welcome AR / EN
out(
  "welcome-ar",
  renderEmail({
    lang: "ar",
    assetBase: "",
    eyebrowHtml: pill("تمت إضافة 400 رصيد مجاني"),
    title: "أهلاً بك في taqreer.ai",
    subHtml:
      "حوّل أفكارك إلى عروض تقديمية كاملة التصميم بالعربية والإنجليزية، ثم صدّرها بصيغة PowerPoint. رصيدك جاهز، ابدأ متى شئت.",
    buttonLabel: "ابدأ الإنشاء",
    buttonHref: "#",
    extraHtml: templatesStrip(
      COVERS.map((src) => ({ href: "#", src })),
      "أو ابدأ من قالب جاهز",
    ),
    footerNoteHtml: "يسعدنا انضمامك. إذا احتجت أي مساعدة، تواصل معنا على support@taqreer.ai.",
  }),
);
out(
  "welcome-en",
  renderEmail({
    lang: "en",
    assetBase: "",
    eyebrowHtml: pill("400 free credits added"),
    title: "Welcome to taqreer.ai",
    subHtml:
      "Turn your ideas into fully designed presentations in Arabic and English, then export them to PowerPoint. Your credits are ready whenever you are.",
    buttonLabel: "Start creating",
    buttonHref: "#",
    extraHtml: templatesStrip(
      COVERS.map((src) => ({ href: "#", src })),
      "Or start from a ready-made template",
    ),
    footerNoteHtml: "We're glad you're here. Need a hand? Reach us at support@taqreer.ai.",
  }),
);

// Billing receipt EN
out(
  "billing-en",
  renderEmail({
    lang: "en",
    assetBase: "",
    title: "Payment receipt",
    subHtml: "Thanks for subscribing to taqreer.ai. Your payment was received.",
    extraHtml: summaryBlock(
      [
        { label: "Plan", value: "Pro" },
        { label: "Amount", value: "30.00 USD" },
        { label: "Date", value: "2026-06-13" },
      ],
      "ltr",
    ),
    buttonLabel: "View invoice",
    buttonHref: "#",
    footerNoteHtml: "Your subscription renews automatically. Manage it from billing settings.",
  }),
);

// Contact (internal) EN
out(
  "contact-en",
  renderEmail({
    lang: "en",
    assetBase: "",
    title: "New contact message",
    subHtml: "A visitor submitted the contact form on taqreer.ai.",
    extraHtml: fieldsBlock(
      [
        { label: "From", value: "Sara Ahmed" },
        { label: "Email", value: "sara@example.com" },
        { label: "Department", value: "Support & bug report" },
      ],
      "Hi, I'm hitting an export error when I download a deck as PPTX, the file is empty. Could you take a look? Thanks.",
    ),
    buttonLabel: "Reply",
    buttonHref: "#",
    footerNoteHtml: "Reply-to is set to the sender, just hit reply to respond directly.",
  }),
);

console.log("Rendered welcome / billing / contact previews.");
