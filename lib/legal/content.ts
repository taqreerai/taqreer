// Bilingual legal content (Terms / Privacy / Refund). Authored 2026-06-13.
//
// ‼️ DRAFT pending review by counsel before public launch. The ENGLISH version
// is the controlling language (the operating entity is a Wyoming, USA LLC and
// the Terms are governed by Wyoming law); the Arabic is a courtesy translation.
//
// ‼️ FILL THESE before publishing (from the Wyoming Articles of Organization):
//    LEGAL_META.entityName, LEGAL_META.address, LEGAL_META.effectiveDate.
//
// Long-form content lives here (not in dictionaries/*.json) so it stays out of
// the per-page client payload and is easy to edit. Short UI strings (page
// titles via these docs' `title`, the cookie banner, footer links) are normal.

export const LEGAL_META = {
  brand: "Taqreer",
  domain: "taqreer.ai",
  // TODO(osama): exact registered name from the Wyoming Articles of Organization.
  entityName: "[COMPANY LEGAL NAME], LLC",
  jurisdiction: "the State of Wyoming, United States of America",
  jurisdictionAr: "ولاية وايومنغ، الولايات المتحدة الأمريكية",
  // TODO(osama): registered / principal business address.
  address: "[REGISTERED BUSINESS ADDRESS]",
  contactEmail: "support@taqreer.ai",
  // TODO(osama): stamp the date these go live.
  effectiveDate: "[EFFECTIVE DATE]",
} as const;

// A block is a paragraph (string) or a bulleted list ({ list }).
export type LegalBlock = string | { list: string[] };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };
export type LegalKind = "terms" | "privacy" | "refund";

const E = LEGAL_META.entityName;
const BRAND = LEGAL_META.brand;
const MAIL = LEGAL_META.contactEmail;

// Subprocessors — the third parties that process data to run the service.
const SUBPROCESSORS_EN = [
  "Supabase — authentication, database, and file storage hosting.",
  "Anthropic (Claude) — the AI that designs your slides from the content you provide.",
  "OpenAI — AI image generation for slide visuals.",
  "Stripe — payment processing and billing (we never see or store your full card details).",
  "Sentry — error monitoring and performance diagnostics.",
  "Resend — transactional email delivery (e.g. share invitations).",
  "Hetzner — cloud server hosting (European data centre).",
];
const SUBPROCESSORS_AR = [
  "Supabase — استضافة المصادقة وقاعدة البيانات وتخزين الملفات.",
  "Anthropic (Claude) — الذكاء الاصطناعي الذي يصمم شرائحك من المحتوى الذي تقدّمه.",
  "OpenAI — توليد الصور بالذكاء الاصطناعي لعناصر الشرائح.",
  "Stripe — معالجة المدفوعات والفوترة (لا نطّلع على بيانات بطاقتك الكاملة ولا نخزّنها).",
  "Sentry — مراقبة الأخطاء وتشخيص الأداء.",
  "Resend — إرسال الرسائل البريدية التشغيلية (مثل دعوات المشاركة).",
  "Hetzner — استضافة الخوادم السحابية (مركز بيانات أوروبي).",
];

// ─────────────────────────────────────────────────────────────────────────
// TERMS & CONDITIONS
// ─────────────────────────────────────────────────────────────────────────
const TERMS_EN: LegalDoc = {
  title: "Terms & Conditions",
  intro:
    `These Terms & Conditions ("Terms") govern your access to and use of ${BRAND} ` +
    `(the "Service") at ${LEGAL_META.domain}, operated by ${E} ("${BRAND}", "we", ` +
    `"us"). By creating an account or using the Service you agree to these Terms. ` +
    `If you do not agree, do not use the Service.`,
  sections: [
    {
      heading: "1. The Service",
      blocks: [
        `${BRAND} is an AI-assisted platform that generates and lets you edit ` +
          `presentation decks (in Arabic and English) from content and brand ` +
          `materials you provide, and exports them to formats such as PPTX, PDF, ` +
          `PNG, and HTML.`,
        `We may add, change, or remove features at any time. We may also set ` +
          `limits (such as slide counts or generation quotas) that depend on your plan.`,
      ],
    },
    {
      heading: "2. Eligibility & Accounts",
      blocks: [
        `You must be at least 18 years old and able to form a binding contract to ` +
          `use the Service.`,
        `You are responsible for the accuracy of your account information, for ` +
          `keeping your login credentials secure, and for all activity under your ` +
          `account. Notify us promptly at ${MAIL} of any unauthorized use.`,
      ],
    },
    {
      heading: "3. Your Content",
      blocks: [
        `"Your Content" means the text, files, images, brand assets, and other ` +
          `material you upload or provide, and the decks generated for you. As ` +
          `between you and us, you retain all rights you hold in Your Content.`,
        `You grant us a limited, non-exclusive licence to host, process, transmit, ` +
          `and display Your Content solely to operate and provide the Service to you ` +
          `(including sending it to our AI providers to generate your decks).`,
        `You represent that you have the rights necessary to provide Your Content ` +
          `and that it does not infringe the rights of any third party or violate ` +
          `any law.`,
      ],
    },
    {
      heading: "4. AI-Generated Output",
      blocks: [
        `The Service uses third-party AI models to generate designs, text, and ` +
          `images. AI output can be inaccurate, incomplete, or unintentionally ` +
          `similar to other material. You are responsible for reviewing, editing, ` +
          `and verifying any output before you rely on or publish it.`,
        `We do not warrant that generated content is accurate, original, or fit ` +
          `for any particular purpose, and we make no representation regarding the ` +
          `intellectual-property status of AI-generated images or designs.`,
      ],
    },
    {
      heading: "5. Acceptable Use",
      blocks: [
        "You agree not to:",
        {
          list: [
            "use the Service for any unlawful, infringing, deceptive, or harmful purpose;",
            "upload content you do not have the right to use, or that is illegal, defamatory, or violates others' rights;",
            "attempt to reverse engineer, scrape, overload, disrupt, or gain unauthorized access to the Service or its systems;",
            "resell or redistribute the Service, or use it to build a competing product;",
            "circumvent usage limits, credit accounting, or access controls.",
          ],
        },
        "We may suspend or terminate accounts that violate these Terms.",
      ],
    },
    {
      heading: "6. Plans, Credits & Payment",
      blocks: [
        `The Service is offered on free and paid plans. Paid features are billed ` +
          `through our payment processor (Stripe). Generations consume "credits" ` +
          `according to the model and options you choose; credit balances, plan ` +
          `allowances, and pricing are described in the app and may change with ` +
          `notice for future billing periods.`,
        `Prices are exclusive of taxes unless stated otherwise. Any applicable ` +
          `taxes (such as VAT or sales tax) are calculated and shown at checkout ` +
          `based on your location, and you are responsible for them.`,
        `By purchasing a subscription you authorize us to charge your payment ` +
          `method on a recurring basis until you cancel. See our Refund Policy for ` +
          `cancellations and refunds.`,
      ],
    },
    {
      heading: "7. Third-Party Services",
      blocks: [
        `The Service relies on third parties (including those listed in our Privacy ` +
          `Policy) to function. Your use may also be subject to their terms. We are ` +
          `not responsible for third-party services we do not control.`,
      ],
    },
    {
      heading: "8. Intellectual Property",
      blocks: [
        `The Service itself — including its software, design system, templates, and ` +
          `branding — is owned by ${BRAND} and protected by intellectual-property ` +
          `laws. These Terms grant you a limited, revocable, non-transferable ` +
          `licence to use the Service; they do not transfer any ownership in it to you.`,
      ],
    },
    {
      heading: "9. Disclaimers",
      blocks: [
        `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ` +
          `ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A ` +
          `PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the ` +
          `Service will be uninterrupted, error-free, or secure.`,
      ],
    },
    {
      heading: "10. Limitation of Liability",
      blocks: [
        `TO THE MAXIMUM EXTENT PERMITTED BY LAW, ${BRAND} WILL NOT BE LIABLE FOR ANY ` +
          `INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ` +
          `LOSS OF PROFITS, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM ` +
          `RELATING TO THE SERVICE WILL NOT EXCEED THE AMOUNTS YOU PAID US IN THE ` +
          `THREE (3) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.`,
      ],
    },
    {
      heading: "11. Indemnification",
      blocks: [
        `You agree to indemnify and hold ${BRAND} harmless from claims, damages, ` +
          `and expenses arising out of Your Content, your use of the Service, or ` +
          `your breach of these Terms.`,
      ],
    },
    {
      heading: "12. Termination",
      blocks: [
        `You may stop using the Service and close your account at any time. We may ` +
          `suspend or terminate your access if you breach these Terms or to protect ` +
          `the Service. Provisions that by their nature should survive termination ` +
          `(such as IP, disclaimers, and limitation of liability) will survive.`,
      ],
    },
    {
      heading: "13. Changes to These Terms",
      blocks: [
        `We may update these Terms from time to time. Material changes will be ` +
          `posted here with an updated effective date; your continued use after a ` +
          `change means you accept the revised Terms.`,
      ],
    },
    {
      heading: "14. Governing Law",
      blocks: [
        `These Terms are governed by the laws of ${LEGAL_META.jurisdiction}, without ` +
          `regard to conflict-of-laws rules. Nothing in these Terms removes any ` +
          `mandatory consumer-protection rights you have under the law of your ` +
          `country of residence.`,
      ],
    },
    {
      heading: "15. Contact",
      blocks: [
        `Questions about these Terms? Contact ${E} at ${MAIL}.`,
      ],
    },
  ],
};

const TERMS_AR: LegalDoc = {
  title: "الشروط والأحكام",
  intro:
    `تحكم هذه الشروط والأحكام ("الشروط") وصولك إلى منصة ${BRAND} ("الخدمة") على ` +
    `${LEGAL_META.domain} واستخدامك لها، وتُشغّلها شركة ${E} ("${BRAND}"، "نحن"). ` +
    `بإنشائك حساباً أو استخدامك للخدمة فإنك توافق على هذه الشروط. وإن لم توافق فلا ` +
    `تستخدم الخدمة. النسخة الإنجليزية هي النسخة المُلزِمة عند أي تعارض.`,
  sections: [
    {
      heading: "1. الخدمة",
      blocks: [
        `${BRAND} منصّة مدعومة بالذكاء الاصطناعي تُنشئ عروضاً تقديمية (بالعربية ` +
          `والإنجليزية) من المحتوى وعناصر الهوية التي تقدّمها، وتتيح تحريرها ` +
          `وتصديرها إلى صيغ مثل PPTX و PDF و PNG و HTML.`,
        `يجوز لنا إضافة ميزات أو تعديلها أو إزالتها في أي وقت، كما يجوز لنا وضع حدود ` +
          `(مثل عدد الشرائح أو حصص الإنشاء) تعتمد على باقتك.`,
      ],
    },
    {
      heading: "2. الأهلية والحسابات",
      blocks: [
        `يجب ألا يقل عمرك عن 18 عاماً وأن تكون أهلاً لإبرام عقد مُلزِم لاستخدام الخدمة.`,
        `أنت مسؤول عن دقة بيانات حسابك وعن الحفاظ على سرية بيانات الدخول وعن كل نشاط ` +
          `يجري عبر حسابك. أبلغنا فوراً على ${MAIL} عند أي استخدام غير مصرّح به.`,
      ],
    },
    {
      heading: "3. محتواك",
      blocks: [
        `يقصد بـ"محتواك" النصوص والملفات والصور وعناصر الهوية وغيرها مما ترفعه أو ` +
          `تقدّمه، إضافةً إلى العروض المُنشأة لك. وفيما بينك وبيننا، تحتفظ بكامل ` +
          `حقوقك في محتواك.`,
        `تمنحنا ترخيصاً محدوداً وغير حصري لاستضافة محتواك ومعالجته ونقله وعرضه فقط ` +
          `لتشغيل الخدمة وتقديمها لك (بما في ذلك إرساله إلى مزوّدي الذكاء الاصطناعي ` +
          `لإنشاء عروضك).`,
        `تُقرّ بأنك تملك الحقوق اللازمة لتقديم محتواك وأنه لا ينتهك حقوق أي طرف ثالث ` +
          `ولا يخالف أي قانون.`,
      ],
    },
    {
      heading: "4. المخرجات المُولّدة بالذكاء الاصطناعي",
      blocks: [
        `تستخدم الخدمة نماذج ذكاء اصطناعي من أطراف ثالثة لتوليد التصاميم والنصوص ` +
          `والصور. وقد تكون هذه المخرجات غير دقيقة أو ناقصة أو مشابهة دون قصد لمواد ` +
          `أخرى. وأنت مسؤول عن مراجعتها وتحريرها والتحقق منها قبل الاعتماد عليها أو ` +
          `نشرها.`,
        `لا نضمن أن المحتوى المُولّد دقيق أو أصيل أو صالح لغرض معيّن، ولا نقدّم أي ` +
          `إقرار بشأن وضع الملكية الفكرية للصور أو التصاميم المُولّدة بالذكاء الاصطناعي.`,
      ],
    },
    {
      heading: "5. الاستخدام المقبول",
      blocks: [
        "توافق على ألّا:",
        {
          list: [
            "تستخدم الخدمة لأي غرض غير قانوني أو منتهِك أو مُضلِّل أو ضار؛",
            "ترفع محتوى لا تملك حق استخدامه، أو محتوى غير قانوني أو تشهيري أو ينتهك حقوق الآخرين؛",
            "تحاول الهندسة العكسية أو الاستخلاص الآلي أو إرهاق الخدمة أو تعطيلها أو الوصول غير المصرّح به إليها أو إلى أنظمتها؛",
            "تعيد بيع الخدمة أو توزيعها أو تستخدمها لبناء منتج منافس؛",
            "تتحايل على حدود الاستخدام أو احتساب النقاط أو ضوابط الوصول.",
          ],
        },
        "يجوز لنا تعليق أو إنهاء الحسابات التي تخالف هذه الشروط.",
      ],
    },
    {
      heading: "6. الباقات والنقاط والدفع",
      blocks: [
        `تُقدَّم الخدمة عبر باقات مجانية ومدفوعة. وتُحصَّل الميزات المدفوعة عبر مزوّد ` +
          `الدفع لدينا (Stripe). تستهلك عمليات الإنشاء "نقاطاً" بحسب النموذج والخيارات ` +
          `التي تختارها، وتُوضَّح أرصدة النقاط ومخصصات الباقات والأسعار داخل التطبيق، ` +
          `وقد تتغيّر بإشعار للفترات المستقبلية.`,
        `الأسعار لا تشمل الضرائب ما لم يُذكر خلاف ذلك. وتُحتسب أي ضرائب مطبّقة (مثل ` +
          `ضريبة القيمة المضافة) وتُعرض عند الدفع بحسب موقعك، وأنت مسؤول عنها.`,
        `بشرائك اشتراكاً فإنك تفوّضنا بخصم المبلغ من وسيلة الدفع بشكل متكرّر حتى ` +
          `تلغيه. راجع سياسة الاسترداد للإلغاء والاسترداد.`,
      ],
    },
    {
      heading: "7. خدمات الأطراف الثالثة",
      blocks: [
        `تعتمد الخدمة على أطراف ثالثة (منها المذكورة في سياسة الخصوصية) لتعمل. وقد ` +
          `يخضع استخدامك أيضاً لشروطها. ولسنا مسؤولين عن خدمات الأطراف الثالثة التي لا ` +
          `نتحكّم بها.`,
      ],
    },
    {
      heading: "8. الملكية الفكرية",
      blocks: [
        `الخدمة نفسها — بما فيها برمجياتها ونظام تصميمها وقوالبها وهويتها — مملوكة ` +
          `لـ${BRAND} ومحميّة بقوانين الملكية الفكرية. وتمنحك هذه الشروط ترخيصاً ` +
          `محدوداً قابلاً للإلغاء وغير قابل للنقل لاستخدام الخدمة، ولا تنقل إليك أي ` +
          `ملكية فيها.`,
      ],
    },
    {
      heading: "9. إخلاء المسؤولية",
      blocks: [
        `تُقدَّم الخدمة "كما هي" و"حسب توفّرها" دون أي ضمانات صريحة أو ضمنية، بما في ` +
          `ذلك ضمانات القابلية للتسويق أو الملاءمة لغرض معيّن أو عدم الانتهاك. ولا ` +
          `نضمن أن تكون الخدمة دون انقطاع أو خالية من الأخطاء أو آمنة.`,
      ],
    },
    {
      heading: "10. تحديد المسؤولية",
      blocks: [
        `إلى أقصى حد يسمح به القانون، لن تكون ${BRAND} مسؤولة عن أي أضرار غير مباشرة ` +
          `أو عرضية أو خاصة أو تبعية أو عقابية، ولا عن خسارة الأرباح أو البيانات أو ` +
          `السمعة. ولن تتجاوز مسؤوليتنا الإجمالية عن أي مطالبة تتعلق بالخدمة ما دفعته ` +
          `لنا خلال الأشهر الثلاثة (3) السابقة للحدث المنشئ للمطالبة.`,
      ],
    },
    {
      heading: "11. التعويض",
      blocks: [
        `توافق على تعويض ${BRAND} وحمايتها من أي مطالبات أو أضرار أو نفقات تنشأ عن ` +
          `محتواك أو استخدامك للخدمة أو مخالفتك لهذه الشروط.`,
      ],
    },
    {
      heading: "12. الإنهاء",
      blocks: [
        `يمكنك التوقف عن استخدام الخدمة وإغلاق حسابك في أي وقت. ويجوز لنا تعليق وصولك ` +
          `أو إنهاؤه إذا خالفت هذه الشروط أو لحماية الخدمة. وتبقى سارية الأحكام التي ` +
          `يقتضي طبعها الاستمرار بعد الإنهاء (مثل الملكية الفكرية وإخلاء المسؤولية ` +
          `وتحديد المسؤولية).`,
      ],
    },
    {
      heading: "13. تعديل الشروط",
      blocks: [
        `قد نحدّث هذه الشروط من وقت لآخر. وتُنشر التغييرات الجوهرية هنا مع تاريخ نفاذ ` +
          `محدّث، ويعني استمرارك في الاستخدام بعد التغيير قبولك للشروط المعدّلة.`,
      ],
    },
    {
      heading: "14. القانون الحاكم",
      blocks: [
        `تخضع هذه الشروط لقوانين ${LEGAL_META.jurisdictionAr} دون اعتبار لقواعد تنازع ` +
          `القوانين. ولا يُسقط أي بند في هذه الشروط أي حقوق حماية للمستهلك إلزامية ` +
          `تكفلها لك قوانين بلد إقامتك.`,
      ],
    },
    {
      heading: "15. التواصل",
      blocks: [
        `لأي استفسار حول هذه الشروط، تواصل مع ${E} على ${MAIL}.`,
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────────
const PRIVACY_EN: LegalDoc = {
  title: "Privacy Policy",
  intro:
    `This Privacy Policy explains how ${E} ("${BRAND}", "we") collects, uses, and ` +
    `protects information when you use ${BRAND} at ${LEGAL_META.domain}. We aim to ` +
    `comply with applicable data-protection laws, including Saudi Arabia's Personal ` +
    `Data Protection Law (PDPL) for users in the Kingdom.`,
  sections: [
    {
      heading: "1. Information We Collect",
      blocks: [
        { list: [
          "Account data: your name, email, and authentication details (via Supabase; Google sign-in shares your basic profile).",
          "Content you provide: text, files, brand assets, and the decks generated for you.",
          "Billing data: your plan, transactions, and subscription status. Payments are handled by Stripe; we do not store full card numbers.",
          "Usage & device data: pages visited, actions taken, and technical data such as browser type and IP address.",
          "Diagnostics: error reports and (masked) session-replay data via Sentry to debug and improve the Service.",
        ] },
      ],
    },
    {
      heading: "2. How We Use Information",
      blocks: [
        { list: [
          "to provide, operate, and improve the Service;",
          "to generate your decks (which requires sending your content to our AI providers);",
          "to process payments and manage subscriptions;",
          "to communicate with you about your account, security, and service updates;",
          "to detect, prevent, and address abuse, fraud, and technical issues;",
          "to comply with legal obligations.",
        ] },
      ],
    },
    {
      heading: "3. AI Processing of Your Content",
      blocks: [
        `To generate decks and images, we transmit the content you provide to our AI ` +
          `providers (Anthropic and OpenAI). They process it to return the generated ` +
          `output and handle it under their own terms and privacy commitments. Do not ` +
          `submit content you are not comfortable processing through these providers.`,
      ],
    },
    {
      heading: "4. Subprocessors & Sharing",
      blocks: [
        `We do not sell your personal data. We share it only with service providers ` +
          `that help us run ${BRAND}, under appropriate confidentiality and ` +
          `data-protection obligations:`,
        { list: SUBPROCESSORS_EN },
        `We may also disclose information if required by law or to protect our rights, ` +
          `users, or the public.`,
      ],
    },
    {
      heading: "5. International Transfers",
      blocks: [
        `${BRAND} is operated from the United States and our infrastructure providers ` +
          `process data in the United States and Europe. If you access the Service ` +
          `from outside these regions, your information will be transferred and ` +
          `processed there, with safeguards appropriate to the data.`,
      ],
    },
    {
      heading: "6. Cookies & Similar Technologies",
      blocks: [
        { list: [
          "Essential cookies — sign-in/session (Supabase), language (tq_locale), theme (tq_theme), and pre-launch access (tq_preview). These are required for the Service to work.",
          "Diagnostics — Sentry uses identifiers to group errors and record masked session replays (text and media are masked) to help us fix issues.",
        ] },
        `You can control cookies through your browser settings; blocking essential ` +
          `cookies may break parts of the Service.`,
      ],
    },
    {
      heading: "7. Data Retention",
      blocks: [
        `We keep your information for as long as your account is active and as needed ` +
          `to provide the Service, comply with legal obligations, resolve disputes, ` +
          `and enforce our agreements. You can delete your account, after which we ` +
          `delete or anonymize your personal data within a reasonable period, subject ` +
          `to legal retention requirements.`,
      ],
    },
    {
      heading: "8. Security",
      blocks: [
        `We use technical and organizational measures — including encryption in ` +
          `transit, access controls, and scoped credentials — to protect your data. ` +
          `No method of transmission or storage is completely secure, and we cannot ` +
          `guarantee absolute security.`,
      ],
    },
    {
      heading: "9. Your Rights",
      blocks: [
        `Subject to applicable law (including the PDPL), you may have the right to ` +
          `access, correct, delete, or obtain a copy of your personal data, to ` +
          `withdraw consent, and to object to or restrict certain processing.`,
        `To exercise these rights, contact us at ${MAIL}. You also have the right to ` +
          `lodge a complaint with your local data-protection authority.`,
      ],
    },
    {
      heading: "10. Children",
      blocks: [
        `The Service is not intended for anyone under 18, and we do not knowingly ` +
          `collect personal data from children.`,
      ],
    },
    {
      heading: "11. Changes to This Policy",
      blocks: [
        `We may update this Policy from time to time. We will post changes here with ` +
          `an updated effective date.`,
      ],
    },
    {
      heading: "12. Contact",
      blocks: [
        `For privacy questions or requests, contact ${E} at ${MAIL}.`,
      ],
    },
  ],
};

const PRIVACY_AR: LegalDoc = {
  title: "سياسة الخصوصية",
  intro:
    `توضّح سياسة الخصوصية هذه كيف تجمع ${E} ("${BRAND}"، "نحن") المعلومات وتستخدمها ` +
    `وتحميها عند استخدامك ${BRAND} على ${LEGAL_META.domain}. ونلتزم بقوانين حماية ` +
    `البيانات المعمول بها، بما فيها نظام حماية البيانات الشخصية (PDPL) في المملكة ` +
    `العربية السعودية لمستخدمي المملكة. النسخة الإنجليزية هي المُلزِمة عند أي تعارض.`,
  sections: [
    {
      heading: "1. المعلومات التي نجمعها",
      blocks: [
        { list: [
          "بيانات الحساب: اسمك وبريدك الإلكتروني وبيانات المصادقة (عبر Supabase؛ ويشارك تسجيل الدخول عبر Google ملفك الأساسي).",
          "المحتوى الذي تقدّمه: النصوص والملفات وعناصر الهوية والعروض المُنشأة لك.",
          "بيانات الفوترة: باقتك ومعاملاتك وحالة اشتراكك. وتتم المدفوعات عبر Stripe، ولا نخزّن أرقام البطاقات الكاملة.",
          "بيانات الاستخدام والجهاز: الصفحات التي تزورها والإجراءات التي تتخذها وبيانات تقنية مثل نوع المتصفح وعنوان IP.",
          "التشخيص: تقارير الأخطاء وبيانات إعادة تشغيل الجلسة (المُخفّاة) عبر Sentry لتصحيح الأخطاء وتحسين الخدمة.",
        ] },
      ],
    },
    {
      heading: "2. كيف نستخدم المعلومات",
      blocks: [
        { list: [
          "لتقديم الخدمة وتشغيلها وتحسينها؛",
          "لإنشاء عروضك (وهو ما يتطلّب إرسال محتواك إلى مزوّدي الذكاء الاصطناعي)؛",
          "لمعالجة المدفوعات وإدارة الاشتراكات؛",
          "للتواصل معك بشأن حسابك وأمنه وتحديثات الخدمة؛",
          "لاكتشاف إساءة الاستخدام والاحتيال والمشكلات التقنية ومنعها ومعالجتها؛",
          "للامتثال للالتزامات القانونية.",
        ] },
      ],
    },
    {
      heading: "3. معالجة محتواك بالذكاء الاصطناعي",
      blocks: [
        `لإنشاء العروض والصور، نُرسل المحتوى الذي تقدّمه إلى مزوّدي الذكاء الاصطناعي ` +
          `لدينا (Anthropic و OpenAI). ويعالجونه لإعادة المخرجات ويتعاملون معه وفق ` +
          `شروطهم والتزاماتهم الخاصة بالخصوصية. فلا تُرسل محتوى لا ترتاح لمعالجته عبر ` +
          `هؤلاء المزوّدين.`,
      ],
    },
    {
      heading: "4. المعالِجون من الباطن والمشاركة",
      blocks: [
        `لا نبيع بياناتك الشخصية. ولا نشاركها إلا مع مزوّدي خدمات يساعدوننا في تشغيل ` +
          `${BRAND}، وذلك وفق التزامات مناسبة بالسرية وحماية البيانات:`,
        { list: SUBPROCESSORS_AR },
        `وقد نُفصح عن المعلومات إذا تطلّب القانون ذلك أو لحماية حقوقنا أو مستخدمينا أو ` +
          `الجمهور.`,
      ],
    },
    {
      heading: "5. النقل الدولي للبيانات",
      blocks: [
        `تُشغَّل ${BRAND} من الولايات المتحدة، ويعالج مزوّدو البنية التحتية لدينا ` +
          `البيانات في الولايات المتحدة وأوروبا. وإذا وصلت إلى الخدمة من خارج هذه ` +
          `المناطق، فستُنقل معلوماتك وتُعالج هناك مع ضمانات مناسبة لطبيعة البيانات.`,
      ],
    },
    {
      heading: "6. ملفات تعريف الارتباط والتقنيات المشابهة",
      blocks: [
        { list: [
          "ملفات أساسية — تسجيل الدخول/الجلسة (Supabase) واللغة (tq_locale) والسمة (tq_theme) والوصول قبل الإطلاق (tq_preview). وهي لازمة لعمل الخدمة.",
          "التشخيص — يستخدم Sentry معرّفات لتجميع الأخطاء وتسجيل إعادة تشغيل جلسات مُخفّاة (يُخفّى النص والوسائط) لمساعدتنا في إصلاح المشكلات.",
        ] },
        `يمكنك التحكّم بملفات تعريف الارتباط من إعدادات متصفحك؛ وقد يؤدي حجب الملفات ` +
          `الأساسية إلى تعطّل أجزاء من الخدمة.`,
      ],
    },
    {
      heading: "7. الاحتفاظ بالبيانات",
      blocks: [
        `نحتفظ بمعلوماتك طالما كان حسابك نشطاً وبالقدر اللازم لتقديم الخدمة والامتثال ` +
          `للالتزامات القانونية وحل النزاعات وإنفاذ اتفاقياتنا. ويمكنك حذف حسابك، ` +
          `وبعدها نحذف بياناتك الشخصية أو نجعلها مجهولة خلال مدة معقولة مع مراعاة ` +
          `متطلبات الاحتفاظ القانونية.`,
      ],
    },
    {
      heading: "8. الأمان",
      blocks: [
        `نستخدم تدابير تقنية وتنظيمية — منها التشفير أثناء النقل وضوابط الوصول ` +
          `والصلاحيات المحدودة — لحماية بياناتك. ولا توجد وسيلة نقل أو تخزين آمنة ` +
          `تماماً، ولا يمكننا ضمان الأمان المطلق.`,
      ],
    },
    {
      heading: "9. حقوقك",
      blocks: [
        `وفقاً للقانون المعمول به (بما فيه نظام PDPL)، قد يكون لك الحق في الوصول إلى ` +
          `بياناتك الشخصية وتصحيحها وحذفها أو الحصول على نسخة منها، وفي سحب الموافقة، ` +
          `وفي الاعتراض على معالجات معيّنة أو تقييدها.`,
        `لممارسة هذه الحقوق، تواصل معنا على ${MAIL}. ولك أيضاً الحق في تقديم شكوى إلى ` +
          `جهة حماية البيانات المختصة لديك.`,
      ],
    },
    {
      heading: "10. الأطفال",
      blocks: [
        `الخدمة غير موجّهة لمن هم دون 18 عاماً، ولا نجمع عمداً بيانات شخصية من الأطفال.`,
      ],
    },
    {
      heading: "11. تعديل هذه السياسة",
      blocks: [
        `قد نحدّث هذه السياسة من وقت لآخر، وسننشر التغييرات هنا مع تاريخ نفاذ محدّث.`,
      ],
    },
    {
      heading: "12. التواصل",
      blocks: [
        `لأي استفسار أو طلب يتعلق بالخصوصية، تواصل مع ${E} على ${MAIL}.`,
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// REFUND POLICY
// ─────────────────────────────────────────────────────────────────────────
const REFUND_EN: LegalDoc = {
  title: "Refund Policy",
  intro:
    `This Refund Policy explains how cancellations and refunds work for paid plans ` +
    `and credits on ${BRAND}. It forms part of our Terms & Conditions.`,
  sections: [
    {
      heading: "1. Subscriptions",
      blocks: [
        `You can cancel your subscription at any time from your billing settings. ` +
          `When you cancel, your plan stays active until the end of the current ` +
          `billing period, and you are not charged again. We do not provide refunds ` +
          `for partial or unused subscription periods.`,
      ],
    },
    {
      heading: "2. Credits & Top-Ups",
      blocks: [
        `Credits (including monthly plan allowances and purchased top-up packs) are ` +
          `consumed when you generate decks and are non-refundable once granted. ` +
          `Unused monthly plan credits do not roll over; purchased top-up credits ` +
          `remain usable until their stated expiry.`,
      ],
    },
    {
      heading: "3. Billing Errors",
      blocks: [
        `If you are charged in error — for example a duplicate charge or a charge ` +
          `after a confirmed cancellation — contact us at ${MAIL} and we will ` +
          `investigate and correct genuine billing errors, including refunding ` +
          `incorrect charges where appropriate.`,
      ],
    },
    {
      heading: "4. Service Failures",
      blocks: [
        `Our credit system automatically releases the hold for a generation that ` +
          `fails before it produces output, so you are not charged credits for a ` +
          `failed generation. If you believe credits were charged for a failed ` +
          `generation, contact us and we will review it.`,
      ],
    },
    {
      heading: "5. Your Statutory Rights",
      blocks: [
        `Nothing in this Policy limits any non-waivable refund or consumer-protection ` +
          `rights you may have under the law of your country of residence.`,
      ],
    },
    {
      heading: "6. How to Request",
      blocks: [
        `To ask about a charge or request a refund, email ${MAIL} from the address on ` +
          `your account with your account details and the transaction in question.`,
      ],
    },
  ],
};

const REFUND_AR: LegalDoc = {
  title: "سياسة الاسترداد",
  intro:
    `توضّح سياسة الاسترداد هذه كيفية عمل الإلغاء والاسترداد للباقات المدفوعة والنقاط ` +
    `في ${BRAND}، وهي جزء من الشروط والأحكام. النسخة الإنجليزية هي المُلزِمة عند أي ` +
    `تعارض.`,
  sections: [
    {
      heading: "1. الاشتراكات",
      blocks: [
        `يمكنك إلغاء اشتراكك في أي وقت من إعدادات الفوترة. وعند الإلغاء تبقى باقتك ` +
          `فعّالة حتى نهاية فترة الفوترة الحالية ولا يُعاد خصم أي مبلغ. ولا نقدّم ` +
          `استرداداً عن الفترات الجزئية أو غير المستخدمة من الاشتراك.`,
      ],
    },
    {
      heading: "2. النقاط وباقات الشحن",
      blocks: [
        `تُستهلك النقاط (بما فيها المخصصات الشهرية للباقة وباقات الشحن المشتراة) عند ` +
          `إنشاء العروض، وهي غير قابلة للاسترداد بعد منحها. ولا تُرحَّل النقاط الشهرية ` +
          `غير المستخدمة، بينما تبقى نقاط باقات الشحن المشتراة صالحة حتى تاريخ ` +
          `انتهائها المذكور.`,
      ],
    },
    {
      heading: "3. أخطاء الفوترة",
      blocks: [
        `إذا خُصم منك مبلغ بالخطأ — مثل خصم مكرّر أو خصم بعد إلغاء مؤكَّد — فتواصل معنا ` +
          `على ${MAIL} وسنحقّق ونصحّح أخطاء الفوترة الحقيقية، بما في ذلك ردّ المبالغ ` +
          `المخصومة بالخطأ عند الاقتضاء.`,
      ],
    },
    {
      heading: "4. إخفاق الخدمة",
      blocks: [
        `يُحرّر نظام النقاط لدينا تلقائياً الحجز الخاص بأي عملية إنشاء تفشل قبل أن ` +
          `تُنتج مخرجات، فلا تُخصم منك نقاط مقابل عملية فاشلة. وإذا رأيت أنه خُصمت نقاط ` +
          `مقابل عملية فاشلة، فتواصل معنا وسنراجع الأمر.`,
      ],
    },
    {
      heading: "5. حقوقك النظامية",
      blocks: [
        `لا يحدّ أي بند في هذه السياسة من أي حقوق استرداد أو حماية للمستهلك غير قابلة ` +
          `للتنازل قد تكفلها لك قوانين بلد إقامتك.`,
      ],
    },
    {
      heading: "6. كيفية الطلب",
      blocks: [
        `للاستفسار عن خصم أو طلب استرداد، راسلنا على ${MAIL} من البريد المسجّل في ` +
          `حسابك مع بيانات حسابك والمعاملة المعنية.`,
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalKind, Record<"en" | "ar", LegalDoc>> = {
  terms: { en: TERMS_EN, ar: TERMS_AR },
  privacy: { en: PRIVACY_EN, ar: PRIVACY_AR },
  refund: { en: REFUND_EN, ar: REFUND_AR },
};
