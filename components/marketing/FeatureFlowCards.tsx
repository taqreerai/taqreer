"use client";

// ─── Landing feature-flow cards ───────────────────────────────────
//
// The four flow cards (Create / Enhance / Mimic / Datasheet) in a 2 × 2 grid.
// Each card shows the SAME animated icon used on the dashboard's QuickActions
// buttons (add_circle / auto_fix_high / content_copy / dataset) — played on
// card hover. Content LEFT, icon RIGHT (`dir="ltr"` locks the order; the Arabic
// text block re-anchors rtl). Card hover also lifts/zooms the card + tints the
// title violet.

import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";

const FEATURES: { icon: string; title: string; description: string }[] = [
  {
    icon: "add_circle",
    title: "إنشاء عرض جديد",
    description:
      "اكتب فكرتك أو ارفع ملفاً، وسيقوم تقرير ببناء عرض تقديمي كامل، بتصميم احترافي يحاكي ذوقك ومراعاة هويتك البصرية.",
  },
  {
    icon: "auto_fix_high",
    title: "تحسين عرض موجود",
    description:
      "ارفع عرضك الحالي بصيغة PowerPoint أو PDF، وسنعيد تصميمه بهويتك البصرية الجديدة مع الحفاظ على المحتوى الأساسي.",
  },
  {
    icon: "content_copy",
    title: "محاكاة أسلوب عرض",
    description:
      "أرفق عرضاً مرجعياً تعجبك ألوانه وخطوطه وتخطيطه، وسنطبّق نفس الأسلوب البصري على محتواك الجديد.",
  },
  {
    icon: "dataset",
    title: "إنشاء من بيانات",
    description:
      "حوّل ملف Excel أو CSV إلى عرض احترافي كامل، مع رسوم بيانية مناسبة وتنسيق احترافي لكل شريحة.",
  },
];

export function FeatureFlowCards() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {FEATURES.map((feature, i) => (
        <ScrollReveal key={feature.title} direction="up" delay={0.05 + i * 0.05}>
          <FeatureCard feature={feature} />
        </ScrollReveal>
      ))}
    </div>
  );
}

function FeatureCard({ feature }: { feature: (typeof FEATURES)[number] }) {
  // Icon plays its hover animation when the CARD is hovered (per the rest of
  // the app: button hover, not icon hover).
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <div
      className="glass-card group max-h-[250px] self-start rounded-2xl px-6 transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.02]"
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      {/* `dir="ltr"` locks DOM order so text lands LEFT, icon RIGHT regardless
          of the page's RTL flow; the text block re-anchors RTL. */}
      <div dir="ltr" className="flex items-stretch gap-3 sm:gap-5">
        <div
          dir="rtl"
          className="flex min-w-0 flex-1 flex-col justify-center sm:min-w-[160px]"
        >
          <h3 className="mb-2 text-xl font-medium leading-snug text-white transition-colors group-hover:text-[var(--tq-violet)]">
            {feature.title}
          </h3>
          <p className="text-sm leading-relaxed text-muted">
            {feature.description}
          </p>
        </div>
        <div
          className="flex aspect-square w-[180px] min-w-0 shrink-0 items-center justify-center sm:w-[250px]"
          aria-hidden
        >
          <div className="text-[var(--tq-text-muted)] transition-colors group-hover:text-white">
            <AnimatedIcon
              ref={iconRef}
              name={feature.icon}
              size={84}
              strokeWidth={1}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
