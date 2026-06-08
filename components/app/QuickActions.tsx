"use client";

// QuickActions row: the 4 entry cards on the dashboard (إنشاء / تحسين /
// محاكاة / من بيانات). Icons are itshover animated SVGs driven by CARD hover
// (per user direction 2026-05-28: "hover animation should start on button
// hover not icon hover") — each card owns its icon ref and calls
// startAnimation / stopAnimation from its own onMouseEnter / onMouseLeave.

import Link from "next/link";
import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

type QuickActionCard = {
  icon: string;
  title: string;
  desc: string;
  path: string;
};

const cards: QuickActionCard[] = [
  {
    icon: "add_circle",
    title: "إنشاء عرض جديد",
    desc: "ابدأ من الصفر بمحتواك",
    path: "/create",
  },
  {
    icon: "auto_fix_high",
    title: "تحسين عرض موجود",
    desc: "احصل على نسخة محسّنة",
    path: "/enhance",
  },
  {
    icon: "content_copy",
    title: "محاكاة أسلوب عرض",
    desc: "انسخ أسلوب عرض آخر وطبّقه",
    path: "/mimic",
  },
  {
    icon: "dataset",
    title: "إنشاء من بيانات",
    desc: "حوّل ملف Excel إلى عرض احترافي",
    path: "/datasheet",
  },
];

export function QuickActions() {
  return (
    <section>
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <QACard key={card.path} card={card} />
        ))}
      </div>
    </section>
  );
}

// One card per flow. Pulled out so each instance owns its own icon ref (a
// single ref-array in the parent would be fragile across re-renders).
function QACard({ card }: { card: QuickActionCard }) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <Link
      href={card.path}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      // `.qa-card` carries the animated mesh-stroke on hover + slow zoom
      // (globals.css). Icon at the top; title + desc pinned to the bottom via
      // `mt-auto`, both single-line (truncate).
      className="qa-card group relative flex flex-col gap-2 overflow-hidden rounded-2xl p-4 min-h-[96px] cursor-pointer no-underline transition-all duration-200"
      dir="rtl"
    >
      <div className="shrink-0 text-muted transition-colors group-hover:text-white">
        <AnimatedIcon ref={iconRef} name={card.icon} size={28} strokeWidth={1.5} />
      </div>
      <div className="mt-auto min-w-0 w-full">
        <h3 className="truncate text-[14px] font-semibold text-white leading-snug">
          {card.title}
        </h3>
        <p className="mt-1 truncate text-[11px] text-muted">{card.desc}</p>
      </div>
    </Link>
  );
}
