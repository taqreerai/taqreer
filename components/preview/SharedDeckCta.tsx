"use client";

// Viewer CTA on shared decks (2026-10-02): someone viewing a deck shared with
// them (public link or a view / comment invite) gets a small "Made with
// taqreer.ai, create your own" card, turning every share into a signup path.
// Anonymous viewers go to signup (then /create); signed-in ones straight to
// /create. Hidden when the owner white-labelled the deck (hideBrandingBadge).
// Dismissible for the session.

import { useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { barsIconSvg } from "@/lib/export/free-branding";

export function SharedDeckCta({ anonymous }: { anonymous: boolean }) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.editor.sharedCta;
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const href = anonymous
    ? `${localizedHref("/signup", locale)}?next=${encodeURIComponent(localizedHref("/create", locale))}`
    : localizedHref("/create", locale);
  return (
    <div
      dir={dir}
      className="surface-popover fixed bottom-24 start-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl p-3 md:bottom-5 md:start-5"
    >
      <span className="shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: barsIconSvg(32) }} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{t.title}</p>
        <p className="text-[11px] text-foreground/60">{t.body}</p>
      </div>
      {/* New tab (owner direction 2026-10-05): the viewer keeps the shared
          deck open while signing up / creating. */}
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-gradient shrink-0 px-4 py-2 text-xs"
      >
        {t.cta}
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={dict.common.close}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
      </button>
    </div>
  );
}
