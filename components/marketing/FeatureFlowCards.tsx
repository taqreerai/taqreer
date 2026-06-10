"use client";

// ─── Landing feature-flow columns ─────────────────────────────────
//
// The four flows (Create / Enhance / Mimic / Datasheet) as a 4-column, 1-row
// band split by vertical hairlines — modeled on Stripe's "backbone of global
// commerce" stat row. RTL: content right-aligned, columns flow right→left.
// Hover (Stripe-style): the column gets a faint fill, its AnimatedIcon plays,
// and the title tints violet.

import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

const FEATURES: { icon: string; title: string; description: string }[] = [
  {
    icon: "add_circle",
    title: "إنشاء عرض جديد",
    description:
      "اكتب فكرتك أو ارفع ملفاً، وسيبني تقرير عرضاً تقديمياً كاملاً بتصميم احترافي يحاكي ذوقك وهويتك البصرية.",
  },
  {
    icon: "auto_fix_high",
    title: "تحسين عرض موجود",
    description:
      "ارفع عرضك الحالي بصيغة PowerPoint أو PDF، وسنعيد تصميمه بهويتك الجديدة مع الحفاظ على المحتوى الأساسي.",
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
      "حوّل ملف Excel أو CSV إلى عرض احترافي كامل، مع رسوم بيانية مناسبة وتنسيق دقيق لكل شريحة.",
  },
];

export function FeatureFlowCards() {
  return (
    <div className="grid grid-cols-1 divide-y divide-[var(--tq-border-hairline)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
      {FEATURES.map((feature) => (
        <FlowColumn key={feature.title} feature={feature} />
      ))}
    </div>
  );
}

function FlowColumn({ feature }: { feature: (typeof FEATURES)[number] }) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <div
      className="group flex flex-col gap-5 p-8 transition-colors duration-300 hover:bg-white/[0.02]"
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <div className="w-fit text-[var(--tq-text-muted)] transition-colors group-hover:text-white">
        <AnimatedIcon ref={iconRef} name={feature.icon} size={40} strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-medium text-white transition-colors group-hover:text-[var(--tq-violet)]">
          {feature.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted">{feature.description}</p>
      </div>
    </div>
  );
}
