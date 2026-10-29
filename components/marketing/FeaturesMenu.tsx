"use client";

// Navbar "Features" menu (one feature per page, 2026-10-01). Desktop: hovering
// or focusing the trigger opens a 3-column dropdown (create / design / edit &
// share) on the standard .surface-menu, Framer entry 0.18s like the app's other
// menus. Each item plays its AnimatedIcon on hover, the same affordance as the
// landing's FeatureFlowCards. The trigger itself keeps its old job (jump to the
// landing's #features section). Mobile: MobileFeaturesList, a tap-to-expand
// list inside the hamburger panel. Routes + icons: featureMenu.ts.

import { useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import {
  FEATURES,
  FEATURE_GROUPS,
  type FeatureEntry,
} from "@/components/marketing/featureMenu";

// Grace period so the cursor can cross the gap from trigger to panel.
const CLOSE_DELAY_MS = 120;

export function FeaturesMenu({ triggerHref }: { triggerHref: string }) {
  const dict = useDict();
  const m = dict.landingNav.featuresMenu;
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    // NOT relative: the panel positions against the nav link group, which is
    // centred on the page, so the wide panel centres on the page too instead
    // of under the trigger (which sits near the group edge and would push the
    // panel off-screen, especially in RTL).
    <div
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideSoon();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <a
        href={triggerHref}
        aria-haspopup="true"
        aria-expanded={open}
        className="icon-hover flex cursor-pointer items-center gap-0.5 text-sm"
      >
        {m.label}
        <span
          className={`material-symbols-outlined text-[18px] leading-none transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          expand_more
        </span>
      </a>

      <AnimatePresence>
        {open ? (
          // pt-3 bridges the gap so the hover survives the trip to the panel.
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            // Centring goes through framer (x), not a Tailwind translate class:
            // framer owns the transform while animating y and would drop it.
            style={{ x: "-50%" }}
            className="absolute left-1/2 top-full z-50 pt-3"
          >
            <div className="surface-menu grid w-[min(860px,calc(100vw-2rem))] grid-cols-3 gap-2 rounded-2xl p-3">
              {FEATURE_GROUPS.map((group) => (
                <div key={group} className="flex flex-col gap-0.5">
                  <span className="px-3 pb-1 pt-2 text-start text-xs font-semibold text-muted">
                    {m.groups[group]}
                  </span>
                  {FEATURES.filter((f) => f.group === group).map((f) => (
                    <FeatureMenuItem key={f.key} feature={f} onNavigate={() => setOpen(false)} />
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function FeatureMenuItem({
  feature,
  onNavigate,
}: {
  feature: FeatureEntry;
  onNavigate: () => void;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const item = dict.landingNav.featuresMenu.items[feature.key];
  const iconRef = useRef<AnimatedIconHandle>(null);
  return (
    <Link
      href={localizedHref(feature.path, locale)}
      onClick={onNavigate}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className="group flex items-start gap-3 rounded-lg px-3 py-2 text-start transition-colors hover:bg-overlay-soft"
    >
      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center text-[var(--tq-purple)] transition-colors group-hover:text-[var(--tq-purple-hover)]">
        <AnimatedIcon ref={iconRef} name={feature.icon} size={22} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-foreground">{item.title}</span>
        <span className="text-xs leading-snug text-muted">{item.desc}</span>
      </span>
    </Link>
  );
}

// Mobile: the hamburger panel's "Features" row expands into the 12 pages,
// grouped, icon + title only (descriptions would crowd a phone screen).
export function MobileFeaturesList({ onNavigate }: { onNavigate: () => void }) {
  const dict = useDict();
  const { locale } = useLocale();
  const m = dict.landingNav.featuresMenu;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="icon-hover flex cursor-pointer items-center justify-center gap-0.5 rounded-lg px-3 py-2.5 text-sm"
      >
        {m.label}
        <span
          className={`material-symbols-outlined text-[18px] leading-none transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        >
          expand_more
        </span>
      </button>
      {expanded ? (
        <div className="mb-1 flex flex-col gap-2 rounded-xl bg-overlay-soft p-2">
          {FEATURE_GROUPS.map((group) => (
            <div key={group} className="flex flex-col">
              <span className="px-2 pb-1 pt-1 text-start text-xs font-semibold text-muted">
                {m.groups[group]}
              </span>
              {FEATURES.filter((f) => f.group === group).map((f) => (
                <Link
                  key={f.key}
                  href={localizedHref(f.path, locale)}
                  onClick={onNavigate}
                  className="icon-hover flex items-center gap-3 rounded-lg px-2 py-2 text-start text-sm"
                >
                  <span className="flex flex-shrink-0 text-[var(--tq-purple)]">
                    <AnimatedIcon name={f.icon} size={20} strokeWidth={1.75} />
                  </span>
                  {m.items[f.key].title}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
