"use client";

// QuickActions row: the 4 entry cards on the dashboard (Create / Enhance /
// Mimic / From data). Icons are hover-animated SVGs driven by CARD hover (per
// user direction 2026-05-28: "hover animation should start on button hover not
// icon hover") — each card owns its icon ref and calls startAnimation /
// stopAnimation from its own onMouseEnter / onMouseLeave. Strings come from the
// active-locale dictionary; direction is inherited from the chrome locale.

import Link from "next/link";
import { useRef } from "react";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

type QuickActionCard = {
  icon: string;
  title: string;
  desc: string;
  href: string;
};

// Icon + route per flow; copy is resolved from the dictionary below.
const CARD_BASE = [
  { icon: "add_circle", key: "create", path: "/create" },
  { icon: "auto_fix_high", key: "enhance", path: "/enhance" },
  { icon: "content_copy", key: "mimic", path: "/mimic" },
  { icon: "photo_camera", key: "social", path: "/social" },
] as const;

export function QuickActions() {
  const dict = useDict();
  const { locale } = useLocale();

  const cards: QuickActionCard[] = CARD_BASE.map((c) => ({
    icon: c.icon,
    title: dict.quickActions[c.key].title,
    desc: dict.quickActions[c.key].desc,
    href: localizedHref(c.path, locale),
  }));

  return (
    <section>
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <QACard key={card.href} card={card} />
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
      href={card.href}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      // `.qa-card` carries the animated mesh-stroke on hover + slow zoom
      // (globals.css). Icon at the top; title + desc pinned to the bottom via
      // `mt-auto`, both single-line (truncate).
      className="qa-card group relative flex flex-col gap-2 overflow-hidden rounded-2xl p-4 min-h-[96px] cursor-pointer no-underline transition-all duration-200"
    >
      <div className="shrink-0 text-muted transition-colors group-hover:text-foreground">
        <AnimatedIcon ref={iconRef} name={card.icon} size={28} strokeWidth={1.5} />
      </div>
      <div className="mt-auto min-w-0 w-full">
        {/* No truncate: copy wraps instead of clipping to "…". Grid row-stretch
            keeps every card the same height, so wrapped rows stay consistent. */}
        <h3 className="text-lg font-semibold text-foreground leading-snug">
          {card.title}
        </h3>
        <p className="mt-1 text-[12px] text-muted">{card.desc}</p>
      </div>
    </Link>
  );
}
