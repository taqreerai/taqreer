"use client";

// Static billing-UI showcase (see page.tsx). Every component below is a
// FROZEN mockup built from the design system's existing primitives
// (.surface-card / .surface-modal / .btn-pill / .btn-gradient /
// .badge-purple / .progress-track / status tokens / NoticeCard) - no new
// visual vocabulary. Copy lives in a local bilingual table for fast
// review iteration; the strings move into dictionaries/ when each
// component graduates to production (so nothing here is "hardcoded
// final").
//
// Round 2 (user directions 2026-06-11): bell rows shipped to the real
// BellDropdown; top-up button = label start / bolt + bold price end;
// alt actions styled as .btn-pill; same-row buttons equal width;
// Billing section gained the 4-tier pricing table + 4 packs (500
// added); RTL-corrected relative times; "الترقية إلى" copy; NoticeCard
// promoted to components/common as the app-wide warning pattern.

import { useLocale } from "@/components/i18n/LocaleProvider";
import { NoticeCard } from "@/components/common/NoticeCard";

// ─── Review copy (en/ar) - graduates to dictionaries on approval ────
const COPY = {
  en: {
    pageTitle: "Billing UI showcase",
    pageDesc:
      "Static renders for review - nothing is wired. Each section becomes real only after your direction.",
    sections: {
      notifications: {
        title: "1. Billing notifications (existing bell)",
        desc: "This row design now IS the real bell (moved to the top bar next to search).",
      },
      insufficient: {
        title: "2. Insufficient-credits dialog",
        desc: "Shown instead of starting generation. The two offers: reduce or top up.",
      },
      lockedPreset: {
        title: "3. Locked preset (quality menu)",
        desc: "A preset above the tier shows an upgrade row instead of a price.",
      },
      lockedFlow: {
        title: "4. Locked flow (Free tier opening /enhance)",
        desc: "Source flows are Plus and above. Built on the NoticeCard primitive (section 9).",
      },
      capExceeded: {
        title: "5. Slide cap exceeded (enhance upload too long)",
        desc: "Blocked at extraction - never truncated.",
      },
      premiumTemplate: {
        title: "6. Premium template lock (Pro + Max)",
        desc: "Tile badge + the gate dialog on use.",
      },
      settingsBilling: {
        title: "7. Settings - Billing section",
        desc: "Plan summary, the 4-tier switch table, 4 top-up packs, Stripe-hosted management.",
      },
      pastDue: {
        title: "8. Payment-failed banner (past_due)",
        desc: "Shown in Settings while Stripe retries the charge.",
      },
      notice: {
        title: "9. NoticeCard - the app-wide warning pattern",
        desc: "The locked-flow look, promoted to a shared primitive (components/common/NoticeCard). Default for confirms and outcome states: cancel generation, generation cancelled, delete account...",
      },
    },
    notif: {
      credited: "Your account was credited with 5,000 credits",
      creditedDesc: "Pro plan monthly renewal",
      topup: "Your account was credited with 1,000 credits",
      topupDesc: "Top-up pack purchase",
      welcome: "Welcome! 400 credits added to your account",
      welcomeDesc: "Free signup gift",
      failed: "Payment failed - update your payment method",
      failedDesc: "We'll retry over the next few days",
      ending: "Your subscription ends on July 11",
      endingDesc: "Credits remain usable until then",
      timeNow: "now",
      time2h: "2h",
      time1d: "1d",
    },
    insufficient: {
      title: "Not enough credits",
      body: "This deck needs 830 credits - you have 240.",
      reduce: "Generate 8 slides instead",
      reduceHint: "fits your balance - 228 credits",
      topup: "Top up 1,000 credits",
      topupPrice: "$12",
      topupHint: "packs never expire with the monthly reset",
      cancel: "Cancel",
    },
    preset: { header: "Generation quality", balance: "Balance: 240 cr", locked: "Upgrade to Pro", fast: "Fast", price: "≈ 180 cr" },
    flow: {
      title: "Enhance an existing presentation",
      body: "Enhance, Mimic and Datasheet are available from the Plus plan.",
      cta: "See plans",
    },
    cap: {
      title: "This file has 60 slides",
      body: "Your plan generates up to 30 slides per deck. Upgrade to Pro for 60.",
      cta: "Upgrade to Pro",
      alt: "Pick a shorter file",
    },
    template: {
      badge: "Premium",
      name: "Quarterly report - Riyadh",
      dialogTitle: "This is a premium template",
      dialogBody: "Premium templates are available on Pro and Max plans.",
      cta: "See plans",
      cancel: "Not now",
    },
    billing: {
      title: "Billing",
      planLine: "Pro plan",
      renew: "Renews July 11 - $30 / month",
      credits: "3,420 / 5,000 credits left",
      manage: "Manage subscription",
      manageHint: "Payment method, invoices and cancellation open in Stripe",
      plansTitle: "Change plan",
      perMonth: "/mo",
      creditsMo: "credits / mo",
      creditsOnce: "credits (signup)",
      current: "Current plan",
      upgrade: "Upgrade",
      downgrade: "Downgrade",
      tiers: [
        { name: "Free", price: "$0", credits: "400" },
        { name: "Plus", price: "$15", credits: "2,000" },
        { name: "Pro", price: "$30", credits: "5,000" },
        { name: "Max", price: "$70", credits: "12,000" },
      ],
      packsTitle: "Top-up packs",
      packsHint: "Stack on your balance, survive monthly resets, expire after 12 months",
      buy: "Buy",
      packs: [
        { credits: "500", price: "$7" },
        { credits: "1,000", price: "$12" },
        { credits: "3,000", price: "$32" },
        { credits: "8,000", price: "$75" },
      ],
    },
    pastDue: {
      text: "Your last payment failed. Update your payment method to keep your plan.",
      cta: "Update payment method",
    },
    notice: {
      confirmTitle: "Cancel this generation?",
      confirmBody: "You'll keep the 12 finished slides for 542 credits. The rest is refunded.",
      confirmYes: "Cancel generation",
      confirmNo: "Keep generating",
      doneTitle: "Generation cancelled",
      doneBody: "12 slides were kept - 288 credits refunded to your balance.",
      doneCta: "Open the deck",
    },
  },
  ar: {
    pageTitle: "معرض واجهات الفوترة",
    pageDesc:
      "عروض ثابتة للمراجعة - لا شيء مفعّل. كل قسم يصبح حقيقيًا فقط بعد توجيهك.",
    sections: {
      notifications: {
        title: "1. إشعارات الفوترة (الجرس الحالي)",
        desc: "هذا التصميم أصبح الجرس الفعلي (انتقل إلى الشريط العلوي بجانب البحث).",
      },
      insufficient: {
        title: "2. نافذة الرصيد غير الكافي",
        desc: "تظهر بدل بدء التوليد. الخياران: تقليل الشرائح أو شحن الرصيد.",
      },
      lockedPreset: {
        title: "3. نموذج مقفل (قائمة الجودة)",
        desc: "النموذج الأعلى من باقتك يعرض صف ترقية بدل السعر.",
      },
      lockedFlow: {
        title: "4. مسار مقفل (باقة Free تفتح /enhance)",
        desc: "مسارات المصدر متاحة من باقة Plus فأعلى. مبني على NoticeCard (القسم 9).",
      },
      capExceeded: {
        title: "5. تجاوز حد الشرائح (ملف تحسين طويل)",
        desc: "يُحظر عند الاستخراج - لا اقتطاع أبدًا.",
      },
      premiumTemplate: {
        title: "6. قفل القوالب المميزة (Pro و Max)",
        desc: "شارة على البطاقة + نافذة عند الاستخدام.",
      },
      settingsBilling: {
        title: "7. الإعدادات - قسم الفوترة",
        desc: "ملخص الباقة، جدول الباقات الأربع، 4 باقات شحن، والإدارة عبر Stripe.",
      },
      pastDue: {
        title: "8. شريط فشل الدفع (past_due)",
        desc: "يظهر في الإعدادات أثناء إعادة محاولات Stripe.",
      },
      notice: {
        title: "9. NoticeCard - نمط التحذير الموحد",
        desc: "تصميم المسار المقفل أصبح مكوّنًا مشتركًا. الافتراضي للتأكيدات والنتائج: إلغاء التوليد، تم الإلغاء، حذف الحساب...",
      },
    },
    notif: {
      credited: "تمت إضافة 5,000 نقطة إلى حسابك",
      creditedDesc: "التجديد الشهري لباقة Pro",
      topup: "تمت إضافة 1,000 نقطة إلى حسابك",
      topupDesc: "شراء باقة شحن",
      welcome: "أهلاً بك! أُضيفت 400 نقطة إلى حسابك",
      welcomeDesc: "هدية التسجيل المجانية",
      failed: "فشل الدفع - حدّث وسيلة الدفع",
      failedDesc: "سنعيد المحاولة خلال الأيام القادمة",
      ending: "ينتهي اشتراكك في 11 يوليو",
      endingDesc: "يبقى رصيدك قابلاً للاستخدام حتى ذلك الحين",
      timeNow: "الآن",
      time2h: "2س",
      time1d: "1ي",
    },
    insufficient: {
      title: "رصيدك غير كافٍ",
      body: "هذا العرض يحتاج 830 نقطة - رصيدك 240.",
      reduce: "أنشئ 8 شرائح بدلاً من ذلك",
      reduceHint: "يناسب رصيدك - 228 نقطة",
      topup: "اشحن 1,000 نقطة",
      topupPrice: "$12",
      topupHint: "باقات الشحن لا تتأثر بالتجديد الشهري",
      cancel: "إلغاء",
    },
    preset: { header: "جودة التوليد", balance: "رصيدك: 240 نقطة", locked: "الترقية إلى Pro", fast: "سريع", price: "≈ 180 نقطة" },
    flow: {
      title: "تحسين عرض موجود",
      body: "التحسين والمحاكاة والبيانات متاحة من باقة Plus.",
      cta: "استعرض الباقات",
    },
    cap: {
      title: "هذا الملف يحتوي 60 شريحة",
      body: "باقتك تنشئ حتى 30 شريحة لكل عرض. الترقية إلى Pro تتيح 60 شريحة.",
      cta: "الترقية إلى Pro",
      alt: "اختر ملفًا أقصر",
    },
    template: {
      badge: "مميز",
      name: "تقرير ربع سنوي - الرياض",
      dialogTitle: "هذا قالب مميز",
      dialogBody: "القوالب المميزة متاحة في باقتي Pro و Max.",
      cta: "استعرض الباقات",
      cancel: "ليس الآن",
    },
    billing: {
      title: "الفوترة",
      planLine: "باقة Pro",
      renew: "تتجدد في 11 يوليو - $30 شهريًا",
      credits: "متبقٍ 3,420 / 5,000 نقطة",
      manage: "إدارة الاشتراك",
      manageHint: "وسيلة الدفع والفواتير والإلغاء تُفتح في Stripe",
      plansTitle: "تغيير الباقة",
      perMonth: "/شهر",
      creditsMo: "نقطة / شهر",
      creditsOnce: "نقطة (عند التسجيل)",
      current: "باقتك الحالية",
      upgrade: "ترقية",
      downgrade: "تخفيض",
      tiers: [
        { name: "Free", price: "$0", credits: "400" },
        { name: "Plus", price: "$15", credits: "2,000" },
        { name: "Pro", price: "$30", credits: "5,000" },
        { name: "Max", price: "$70", credits: "12,000" },
      ],
      packsTitle: "باقات الشحن",
      packsHint: "تُضاف إلى رصيدك، تتجاوز التجديد الشهري، وتنتهي بعد 12 شهرًا",
      buy: "شراء",
      packs: [
        { credits: "500", price: "$7" },
        { credits: "1,000", price: "$12" },
        { credits: "3,000", price: "$32" },
        { credits: "8,000", price: "$75" },
      ],
    },
    pastDue: {
      text: "فشل آخر دفع. حدّث وسيلة الدفع للحفاظ على باقتك.",
      cta: "تحديث وسيلة الدفع",
    },
    notice: {
      confirmTitle: "إلغاء هذا التوليد؟",
      confirmBody: "ستحتفظ بالشرائح الـ 12 المكتملة مقابل 542 نقطة، ويُسترد الباقي.",
      confirmYes: "إلغاء التوليد",
      confirmNo: "متابعة التوليد",
      doneTitle: "تم إلغاء التوليد",
      doneBody: "احتفظت بـ 12 شريحة - أُعيدت 288 نقطة إلى رصيدك.",
      doneCta: "افتح العرض",
    },
  },
};

type Copy = (typeof COPY)["en"];

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{desc}</p>
      <div className="rounded-2xl border border-dashed border-[var(--tq-border-hairline)] p-6">
        {children}
      </div>
    </section>
  );
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined leading-none" style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}

// ─── 1. Bell notification rows (now the REAL bell design) ──────────
function NotificationRows({ c }: { c: Copy }) {
  const rows = [
    { icon: "account_balance_wallet", tone: "ok", title: c.notif.credited, desc: c.notif.creditedDesc, time: c.notif.timeNow },
    { icon: "add_card", tone: "ok", title: c.notif.topup, desc: c.notif.topupDesc, time: c.notif.time2h },
    { icon: "celebration", tone: "ok", title: c.notif.welcome, desc: c.notif.welcomeDesc, time: c.notif.time1d },
    { icon: "credit_card_off", tone: "warn", title: c.notif.failed, desc: c.notif.failedDesc, time: c.notif.time2h },
    { icon: "event_upcoming", tone: "muted", title: c.notif.ending, desc: c.notif.endingDesc, time: c.notif.time1d },
  ] as const;
  return (
    <div className="surface-card mx-auto max-w-md rounded-2xl p-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/[0.04]">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              row.tone === "warn"
                ? "text-[var(--tq-status-warn-text)]"
                : "text-foreground/80"
            } bg-[var(--tq-surface)]`}
          >
            <Icon name={row.icon} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-foreground">{row.title}</p>
            <p className="mt-0.5 text-[11px] text-muted">{row.desc}</p>
          </div>
          {/* No forced dir - the page direction orders digit+unit
              correctly ("س2" reads with the number on the right in AR;
              user direction 2026-06-11). */}
          <span className="shrink-0 text-[10px] text-muted">{row.time}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 2. Insufficient-credits dialog ─────────────────────────────────
function InsufficientDialog({ c }: { c: Copy }) {
  return (
    <div className="surface-modal mx-auto w-full max-w-md rounded-2xl p-8">
      <h3 className="mb-2 text-xl font-bold text-foreground">{c.insufficient.title}</h3>
      <p className="mb-6 text-sm text-muted">{c.insufficient.body}</p>
      <div className="flex flex-col gap-2.5">
        <button type="button" className="btn-pill flex w-full items-center justify-between px-5 py-3 text-sm">
          <span className="font-medium">{c.insufficient.reduce}</span>
          <span className="text-xs text-muted">{c.insufficient.reduceHint}</span>
        </button>
        {/* Label alone on the start side; bolt + BOLD price together on
            the end side (user direction 2026-06-11). */}
        <button type="button" className="btn-gradient flex w-full items-center justify-between px-5 py-3 text-sm">
          <span className="font-medium">{c.insufficient.topup}</span>
          <span className="flex items-center gap-1.5">
            <Icon name="bolt" size={16} />
            <span className="font-bold" dir="ltr">{c.insufficient.topupPrice}</span>
          </span>
        </button>
        <p className="text-center text-[11px] text-muted">{c.insufficient.topupHint}</p>
      </div>
      <div className="mt-6 flex justify-end">
        <button type="button" className="px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground">
          {c.insufficient.cancel}
        </button>
      </div>
    </div>
  );
}

// ─── 3. Locked preset row in the quality menu ───────────────────────
function LockedPresetMenu({ c }: { c: Copy }) {
  return (
    <div className="mx-auto w-80 overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)]">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-foreground/40">
        <span>{c.preset.header}</span>
        <span dir="ltr" className="tabular-nums">{c.preset.balance}</span>
      </div>
      {/* Unlocked row - what exists today. */}
      <div className="flex w-full items-center gap-3 bg-foreground/[0.06] px-3 py-2.5 text-sm text-foreground">
        <span className="flex flex-1 items-center gap-2">
          <Icon name="check" size={16} />
          <span>Sonnet 4.6 · سريع</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-[var(--tq-surface)] px-1.5 py-0.5 text-[9px] font-semibold text-foreground/50">{c.preset.fast}</span>
          <span className="text-[11px] text-foreground/40 tabular-nums" dir="ltr">{c.preset.price}</span>
        </span>
      </div>
      {/* LOCKED rows - lock icon + upgrade chip instead of a price. */}
      {["Opus 4.8 · سريع", "Opus 4.8 · تفكير"].map((label) => (
        <div key={label} className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-foreground/45">
          <span className="flex flex-1 items-center gap-2">
            <Icon name="lock" size={14} />
            <span>{label}</span>
          </span>
          <span className="badge-purple shrink-0 cursor-pointer">{c.preset.locked}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 4. Locked flow - built on the shared NoticeCard ────────────────
function LockedFlowCard({ c }: { c: Copy }) {
  return (
    <div className="surface-card mx-auto max-w-sm rounded-2xl">
      <NoticeCard
        icon="lock"
        title={c.flow.title}
        body={c.flow.body}
        actions={<button type="button" className="btn-gradient px-6 py-2.5 text-sm">{c.flow.cta}</button>}
      />
    </div>
  );
}

// ─── 5. Slide cap exceeded ──────────────────────────────────────────
function CapExceededCard({ c }: { c: Copy }) {
  return (
    <div className="surface-card mx-auto flex max-w-lg items-start gap-4 rounded-2xl p-6">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--tq-status-warn-bg)] text-[var(--tq-status-warn-text)]">
        <Icon name="warning" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-foreground">{c.cap.title}</h3>
        <p className="mt-1 text-sm text-muted">{c.cap.body}</p>
        {/* Same-row buttons share one size (user direction 2026-06-11);
            the alt action is a normal .btn-pill, not a bare text link. */}
        <div className="mt-4 flex items-stretch gap-3 [&>*]:flex-1 [&>*]:max-w-[200px]">
          <button type="button" className="btn-gradient px-5 py-2 text-sm">{c.cap.cta}</button>
          <button type="button" className="btn-pill px-5 py-2 text-sm">{c.cap.alt}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 6. Premium template lock ───────────────────────────────────────
function PremiumTemplate({ c }: { c: Copy }) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-8">
      {/* Tile with the premium badge */}
      <div className="w-56">
        <div className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-3">
          <div className="h-2 w-2/3 rounded-sm bg-foreground/25" />
          <div className="mt-1.5 h-1.5 w-1/2 rounded-sm bg-foreground/15" />
          <div className="absolute bottom-2 start-2 flex gap-1">
            <div className="h-4 w-10 rounded-sm bg-foreground/20" />
            <div className="h-4 w-10 rounded-sm bg-foreground/10" />
          </div>
          <span className="badge-purple absolute end-2 top-2 flex items-center gap-1">
            <Icon name="workspace_premium" size={11} />
            {c.template.badge}
          </span>
        </div>
        <p className="mt-1.5 truncate px-0.5 text-start text-[12px] font-semibold text-foreground">{c.template.name}</p>
      </div>
      {/* Gate dialog on use - equal-width buttons in one row. */}
      <div className="surface-modal w-full max-w-sm rounded-2xl p-8">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--tq-surface)] text-foreground/80">
          <Icon name="workspace_premium" size={22} />
        </span>
        <h3 className="mb-2 text-lg font-bold text-foreground">{c.template.dialogTitle}</h3>
        <p className="mb-6 text-sm text-muted">{c.template.dialogBody}</p>
        <div className="flex items-stretch gap-3 [&>*]:flex-1">
          <button type="button" className="btn-gradient px-5 py-2.5 text-sm">{c.template.cta}</button>
          <button type="button" className="btn-pill px-5 py-2.5 text-sm">{c.template.cancel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 7. Settings - Billing section ──────────────────────────────────
function SettingsBilling({ c }: { c: Copy }) {
  const CURRENT_TIER = "Pro"; // mock - the showcase user is on Pro
  const currentIdx = c.billing.tiers.findIndex((t) => t.name === CURRENT_TIER);
  return (
    <div className="surface-card mx-auto max-w-2xl rounded-2xl p-6">
      <h3 className="mb-4 text-base font-bold text-foreground">{c.billing.title}</h3>

      {/* Plan summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {c.billing.planLine}
            <span className="badge-purple">Pro</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{c.billing.renew}</p>
          <p className="mt-2 text-xs text-muted" dir="ltr">{c.billing.credits}</p>
          <div className="progress-track mt-1.5 w-56">
            <div className="progress-bar" style={{ width: "68%" }} />
          </div>
        </div>
        <div className="text-end">
          <button type="button" className="btn-pill px-4 py-2 text-sm">{c.billing.manage}</button>
          <p className="mt-1.5 max-w-[180px] text-[10px] leading-relaxed text-muted">{c.billing.manageHint}</p>
        </div>
      </div>

      {/* Plan switch table - all 4 tiers, current marked, others
          upgrade/downgrade (user direction 2026-06-11). */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-foreground">{c.billing.plansTitle}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {c.billing.tiers.map((tier, idx) => {
            const isCurrent = idx === currentIdx;
            const isUpgrade = idx > currentIdx;
            return (
              <div
                key={tier.name}
                className={`flex flex-col items-center gap-0.5 rounded-xl border p-4 ${
                  isCurrent
                    ? "border-[var(--tq-purple)] bg-[var(--tq-card)]"
                    : "border-[var(--tq-border-hairline)] bg-[var(--tq-card)]"
                }`}
              >
                <span className="text-sm font-bold text-foreground">{tier.name}</span>
                <span className="text-lg font-bold text-foreground tabular-nums" dir="ltr">
                  {tier.price}
                  <span className="text-[10px] font-normal text-muted">{c.billing.perMonth}</span>
                </span>
                <span className="text-[10px] text-muted" dir="ltr">
                  {tier.credits} {idx === 0 ? c.billing.creditsOnce : c.billing.creditsMo}
                </span>
                {isCurrent ? (
                  <span className="mt-2 w-full rounded-full py-1.5 text-center text-xs font-medium text-muted">
                    {c.billing.current}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`mt-2 w-full py-1.5 text-xs ${isUpgrade ? "btn-gradient" : "btn-pill"}`}
                  >
                    {isUpgrade ? c.billing.upgrade : c.billing.downgrade}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top-up packs - 4, matching the tier card count. */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-foreground">{c.billing.packsTitle}</p>
        <p className="mt-0.5 text-xs text-muted">{c.billing.packsHint}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {c.billing.packs.map((pack) => (
            <div key={pack.price} className="flex flex-col items-center gap-1 rounded-xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)] p-4">
              <span className="text-lg font-bold text-foreground tabular-nums" dir="ltr">{pack.credits}</span>
              <span className="text-xs font-bold text-muted" dir="ltr">{pack.price}</span>
              <button type="button" className="btn-pill mt-2 w-full py-1.5 text-xs">{c.billing.buy}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 8. past_due banner ─────────────────────────────────────────────
function PastDueBanner({ c }: { c: Copy }) {
  return (
    <div
      className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{
        background: "var(--tq-status-warn-bg)",
        borderColor: "var(--tq-status-warn-border)",
      }}
    >
      <span className="flex items-center gap-2 text-sm text-foreground">
        <span className="text-[var(--tq-status-warn-text)]">
          <Icon name="credit_card_off" size={16} />
        </span>
        {c.pastDue.text}
      </span>
      <button type="button" className="btn-pill shrink-0 px-4 py-1.5 text-xs">{c.pastDue.cta}</button>
    </div>
  );
}

// ─── 9. NoticeCard pattern examples ─────────────────────────────────
function NoticeExamples({ c }: { c: Copy }) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-6">
      <div className="surface-modal w-full max-w-sm rounded-2xl">
        <NoticeCard
          icon="stop_circle"
          tone="warn"
          title={c.notice.confirmTitle}
          body={c.notice.confirmBody}
          actions={
            <>
              <button type="button" className="btn-pill px-5 py-2.5 text-sm">{c.notice.confirmYes}</button>
              <button type="button" className="btn-gradient px-5 py-2.5 text-sm">{c.notice.confirmNo}</button>
            </>
          }
        />
      </div>
      <div className="surface-card w-full max-w-sm rounded-2xl">
        <NoticeCard
          icon="task_alt"
          title={c.notice.doneTitle}
          body={c.notice.doneBody}
          actions={<button type="button" className="btn-pill px-5 py-2.5 text-sm">{c.notice.doneCta}</button>}
        />
      </div>
    </div>
  );
}

export function BillingShowcase() {
  const { locale, dir } = useLocale();
  const c: Copy = COPY[locale === "ar" ? "ar" : "en"];
  return (
    <main dir={dir} className="min-h-screen bg-[var(--tq-panel)] px-6 py-14">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold text-foreground">{c.pageTitle}</h1>
        <p className="mb-10 mt-2 text-sm text-muted">{c.pageDesc}</p>

        <Section title={c.sections.notifications.title} desc={c.sections.notifications.desc}>
          <NotificationRows c={c} />
        </Section>
        <Section title={c.sections.insufficient.title} desc={c.sections.insufficient.desc}>
          <InsufficientDialog c={c} />
        </Section>
        <Section title={c.sections.lockedPreset.title} desc={c.sections.lockedPreset.desc}>
          <LockedPresetMenu c={c} />
        </Section>
        <Section title={c.sections.lockedFlow.title} desc={c.sections.lockedFlow.desc}>
          <LockedFlowCard c={c} />
        </Section>
        <Section title={c.sections.capExceeded.title} desc={c.sections.capExceeded.desc}>
          <CapExceededCard c={c} />
        </Section>
        <Section title={c.sections.premiumTemplate.title} desc={c.sections.premiumTemplate.desc}>
          <PremiumTemplate c={c} />
        </Section>
        <Section title={c.sections.settingsBilling.title} desc={c.sections.settingsBilling.desc}>
          <SettingsBilling c={c} />
        </Section>
        <Section title={c.sections.pastDue.title} desc={c.sections.pastDue.desc}>
          <PastDueBanner c={c} />
        </Section>
        <Section title={c.sections.notice.title} desc={c.sections.notice.desc}>
          <NoticeExamples c={c} />
        </Section>
      </div>
    </main>
  );
}
