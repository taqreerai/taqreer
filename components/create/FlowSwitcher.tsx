"use client";

// Tool switcher at the top of every creation wizard (2026-10-07, owner
// direction): one segmented row - Create, Enhance, Your own template, Social -
// with the current tool marked, so a visitor who landed on the wrong tool
// moves over in one click. Same flows, icons and copy as the dashboard's
// QuickActions. All four are open to visitors, so every link goes direct.
// Phones show the icon only for the other tools (`.tool-tab-label`).

import Link from "next/link";
import posthog from "posthog-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { useIsGuest } from "@/components/app/GuestContext";
import { localizedHref } from "@/lib/i18n/navigation";
import type { GuestFlow } from "@/lib/create/guest-draft";

const FLOWS: readonly { icon: string; key: GuestFlow }[] = [
  { icon: "add_circle", key: "create" },
  { icon: "auto_fix_high", key: "enhance" },
  { icon: "content_copy", key: "mimic" },
  { icon: "tag", key: "social" },
  // /datasheet is left out on purpose (2026-10-06): an unlisted tool with no
  // search demand; spreadsheets are meant to come to /create.
];

export function FlowSwitcher({ current }: { current: GuestFlow }) {
  const dict = useDict();
  const { locale } = useLocale();
  const guest = useIsGuest();
  const copy = dict.quickActions;

  return (
    <nav aria-label={dict.flows.switcher.label} className="tool-tabs">
      {FLOWS.map((f) => {
        const active = f.key === current;
        return (
          <Link
            key={f.key}
            href={localizedHref(`/${f.key}`, locale)}
            aria-current={active ? "page" : undefined}
            aria-label={copy[f.key].title}
            title={copy[f.key].desc}
            onClick={() => {
              if (!active) posthog.capture("create_flow_switch", { from: current, flow: f.key, guest });
            }}
            className={`tool-tab ${active ? "is-active" : ""}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden>
              {f.icon}
            </span>
            <span className="tool-tab-label">{copy[f.key].title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
