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

import Link from "next/link";
import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import { Sparkline } from "@/components/app/Sparkline";
import type { AnimatedIconHandle } from "@/components/icons/types";

type QuickActionCard = {
  icon: string;
  title: string;
  desc: string;
  path: string;
  comingSoon?: boolean;
  // Bottom-of-card points-usage sparkline (mirrors the reference
  // dashboard's stat cards). `accent` is a Tailwind text-* class that
  // drives the line colour via `currentColor`; `spark` is static
  // placeholder data until the points model is wired.
  accent: string;
  spark: number[];
};

const cards: QuickActionCard[] = [
  {
    icon: 'add_circle',
    title: 'إنشاء عرض جديد',
    desc: 'ابدأ من الصفر بمحتواك',
    path: '/create',
    accent: 'text-[var(--tq-blue)]',
    spark: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    icon: 'auto_fix_high',
    title: 'تحسين عرض موجود',
    desc: 'ارفع ملفك واحصل على نسخة محسّنة',
    path: '/enhance',
    accent: 'text-[var(--tq-violet)]',
    spark: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    icon: 'content_copy',
    title: 'محاكاة أسلوب عرض',
    desc: 'انسخ أسلوب عرض آخر وطبّقه',
    path: '/mimic',
    accent: 'text-[var(--tq-lavender)]',
    spark: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    icon: 'dataset',
    title: 'إنشاء من بيانات',
    desc: 'حوّل ملف Excel إلى عرض احترافي',
    path: '/datasheet',
    accent: 'text-[var(--tq-magenta)]',
    spark: [0, 0, 0, 0, 0, 0, 0, 0],
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
    <Link
      href={card.path}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      // Switched from `.qa-card` (animated mesh-stroke hover) to the
      // standard `.glass-card` so these match the other dashboard cards:
      // a plain bg/border lighten on hover, no moving ring. Fixed 150px
      // height; `overflow-hidden` + `rounded-2xl` clip the full-bleed
      // sparkline to the rounded corners.
      className="glass-card group relative flex min-h-[150px] flex-col gap-2 overflow-hidden rounded-2xl p-4 cursor-pointer no-underline transition-all duration-200"
      dir="rtl"
    >
      {card.comingSoon && (
        <span className="absolute top-3 left-3 z-10 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
          قريباً
        </span>
      )}
      {/* Top row: title + desc grouped tightly on the start (visual
          right); icon on the end (visual left). Grouping the text keeps
          the subtitle snug under the title instead of being spaced apart
          by the taller icon row. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-white leading-snug">{card.title}</h3>
          <p className="mt-1 text-[11px] text-muted leading-relaxed">{card.desc}</p>
        </div>
        <div className="shrink-0 text-muted transition-colors group-hover:text-white">
          <AnimatedIcon ref={iconRef} name={card.icon} size={32} strokeWidth={1.5} />
        </div>
      </div>
      {/* Points-usage sparkline — RTL (newest on the left), full-bleed to
          the card's left/right and bottom edges (negative margins cancel
          the p-4 padding; the card's `overflow-hidden` + 14px radius clip
          it to the rounded corners). */}
      <div className="-mx-4 -mb-4 mt-auto pt-2">
        <Sparkline
          data={card.spark}
          id={card.path.replace(/\W/g, "")}
          rtl
          className={`block h-12 w-full ${card.accent}`}
        />
      </div>
    </Link>
  );
}
