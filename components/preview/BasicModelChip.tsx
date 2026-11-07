"use client";

// "Made with Basic model" chip in the studio's top bar (owner, 2026-11-07):
// a free deck designed on the Basic model (Claude Haiku) says so, and a short
// card explains what paid plans add, with a link to the plans page. Shown by
// DeckView only to the owner of a free, unpurchased Haiku deck.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export function BasicModelChip() {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.editor.basicModel;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="btn-pill whitespace-nowrap"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="material-symbols-outlined leading-none text-[var(--tq-brand-blue)]"
          style={{ fontSize: 14 }}
          aria-hidden
        >
          info
        </span>
        {t.chip}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t.title}
          className="surface-popover absolute end-0 top-full z-50 mt-2 w-72 rounded-2xl p-4 text-start"
        >
          <p className="text-sm font-semibold text-foreground">{t.title}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/60">{t.body}</p>
          <Link
            href={localizedHref("/plans", locale)}
            className="btn-gradient mt-3 inline-flex px-4 py-2 text-xs no-underline"
            onClick={() => setOpen(false)}
          >
            {t.cta}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
