"use client";

// "Or try" row on /create's first step (2026-10-06, owner direction): the
// homepage's free button lands on /create, and this quiet row lets a visitor
// who came for something else jump to the other flows without a chooser
// page in front of everyone. Same flows, icons and copy as the dashboard's
// QuickActions. A flow that still needs an account sends a visitor through
// sign-up and straight into it; open flows (and signed-in users) go direct.

import Link from "next/link";
import posthog from "posthog-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useIsGuest } from "@/components/app/GuestContext";
import { localizedHref } from "@/lib/i18n/navigation";
import { GUEST_FLOWS } from "@/lib/create/guest-draft";

const FLOWS = [
  { icon: "auto_fix_high", key: "enhance", path: "/enhance" },
  { icon: "content_copy", key: "mimic", path: "/mimic" },
  { icon: "tag", key: "social", path: "/social" },
  // /datasheet is left out on purpose (2026-10-06): an untested, unlisted
  // tool with no search demand; spreadsheets are meant to come to /create.
] as const;

export function FlowSwitcher() {
  const dict = useDict();
  const { locale } = useLocale();
  const guest = useIsGuest();
  const copy = dict.quickActions;

  return (
    <nav
      aria-label={dict.flows.switcher.label}
      className="flex flex-wrap items-center justify-center gap-1.5"
    >
      <span className="me-1 text-xs text-[var(--tq-text-muted)]">
        {dict.flows.switcher.label}
      </span>
      {FLOWS.map((f) => {
        const flowHref = localizedHref(f.path, locale);
        // Flows open to visitors (enhance since 2026-10-06) link straight in;
        // the rest go through sign-up first.
        const open = (GUEST_FLOWS as readonly string[]).includes(f.path.slice(1));
        const href =
          guest && !open
            ? `${localizedHref("/signup", locale)}?next=${encodeURIComponent(flowHref)}`
            : flowHref;
        return (
          <Link
            key={f.key}
            href={href}
            title={copy[f.key].desc}
            onClick={() => posthog.capture("create_flow_switch", { flow: f.key, guest })}
            className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--tq-border-hairline)] px-3 text-xs font-medium text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
              {f.icon}
            </span>
            {copy[f.key].title}
          </Link>
        );
      })}
    </nav>
  );
}
