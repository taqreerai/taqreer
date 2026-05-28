"use client";

// QuickActions row: 4 entry cards on the dashboard (إنشاء / تحسين /
// محاكاة / من بيانات). Icons swapped from Material Symbols Outlined
// to itshover animated SVGs 2026-05-28 (user direction); the
// `AnimatedIcon` resolver maps the existing Material slugs to the
// vendored icon components so this config didn't have to change.
//
// Animation is driven by CARD hover (not icon hover) per the user's
// "hover animation should start on button hover not icon hover"
// direction — each card owns its icon's ref and calls
// `startAnimation` / `stopAnimation` from its own `onMouseEnter` /
// `onMouseLeave`. Icon size 34 px, stroke 1.5 (slightly lighter than
// the sidebar's 2 so the larger glyph doesn't read as too heavy).

import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

type QuickActionCard = {
  icon: string;
  title: string;
  desc: string;
  path: string;
  comingSoon?: boolean;
};

const cards: QuickActionCard[] = [
  {
    icon: 'add_circle',
    title: 'إنشاء عرض جديد',
    desc: 'ابدأ من الصفر بمحتواك',
    path: '/create',
  },
  {
    icon: 'auto_fix_high',
    title: 'تحسين عرض موجود',
    desc: 'ارفع ملفك واحصل على نسخة محسّنة',
    path: '/enhance',
  },
  {
    icon: 'content_copy',
    title: 'محاكاة أسلوب عرض',
    desc: 'انسخ أسلوب عرض آخر وطبّقه',
    path: '/mimic',
  },
  {
    icon: 'dataset',
    title: 'إنشاء من بيانات',
    desc: 'حوّل ملف Excel إلى عرض احترافي',
    path: '/datasheet',
  },
];

export function QuickActions() {
  return (
    <section>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <QACard key={card.path} card={card} />
        ))}
      </div>
    </section>
  );
}

// One card per QuickActions row item. Pulled out into its own
// component so each instance can own its own icon ref (a single
// ref-array in the parent would be fragile across re-renders and
// makes the JSX harder to read).
function QACard({ card }: { card: QuickActionCard }) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <a
      href={card.path}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className="qa-card relative p-4 flex flex-col gap-3 cursor-pointer no-underline group transition-all duration-200"
      dir="rtl"
    >
      {card.comingSoon && (
        <span className="absolute top-3 left-3 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
          قريباً
        </span>
      )}
      <div className="text-right text-muted transition-colors group-hover:text-white">
        <AnimatedIcon ref={iconRef} name={card.icon} size={34} strokeWidth={1.5} />
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-white leading-snug mb-0.5">{card.title}</h3>
        <p className="text-[11px] text-muted leading-relaxed">{card.desc}</p>
      </div>
    </a>
  );
}
