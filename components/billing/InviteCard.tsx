"use client";

// Invite-a-colleague card (2026-10-04, lib/referral.ts). Shows the user's
// invite link with copy + WhatsApp share (teachers spread tools through
// WhatsApp groups), the reward terms, and how many people joined.

import { useEffect, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

type ReferralData = {
  code: string;
  inviteeBonus: number;
  inviterReward: number;
  monthlyCap: number;
  invited: number;
  rewarded: number;
};

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export function InviteCard() {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.components.invite;
  const [data, setData] = useState<ReferralData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/referral")
      .then((r) => (r.ok ? (r.json() as Promise<ReferralData>) : null))
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;
  const link = `${window.location.origin}/${locale}/signup?ref=${data.code}`;
  const vars = {
    bonus: data.inviteeBonus,
    reward: data.inviterReward.toLocaleString("en-US"),
    cap: data.monthlyCap,
    invited: data.invited,
    rewarded: data.rewarded,
  };
  const message = `${fill(t.message, vars)} ${link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link stays selectable in the field.
    }
  };

  return (
    <section id="invite" dir={dir} className="surface-card mb-8 flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span
          className="material-symbols-outlined grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--tq-violet)]/15 text-[var(--tq-violet)]"
          aria-hidden
        >
          group_add
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-foreground/65">{fill(t.body, vars)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          dir="ltr"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="input-dark min-w-0 flex-1 text-sm"
          aria-label={t.title}
        />
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="btn-pill px-4 py-2 text-sm">
            {copied ? t.copied : t.copy}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-gradient px-4 py-2 text-sm no-underline"
          >
            {t.whatsapp}
          </a>
        </div>
      </div>
      <p className="text-xs text-foreground/50">{fill(t.stats, vars)}</p>
    </section>
  );
}
