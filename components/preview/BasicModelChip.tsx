"use client";

// "Make it engaging" chip in the studio's top bar (owner, 2026-11-07): an
// upgrade nudge, not a label. Shown by DeckView to the owner of a free,
// unpurchased deck designed at the Simple level. Its card sells the one-time
// unlock (the whole deck redesigned at the Engaging level, no watermark) and
// starts it; a deck with nothing locked points to the plans instead.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export function BasicModelChip({
  priceCents,
  onUnlock,
}: {
  // The deck's one-time unlock price; null = no unlock offer for this deck.
  priceCents: number | null;
  onUnlock: () => void;
}) {
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

  // Latin numerals in both languages (owner rule).
  const price = priceCents !== null ? `$${(priceCents / 100).toFixed(2)}` : null;

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
          style={{ fontSize: 15 }}
          aria-hidden
        >
          auto_awesome
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
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/60">
            {price ? t.body : t.bodyPlans}
          </p>
          {price ? (
            <button
              type="button"
              className="btn-gradient mt-3 inline-flex px-4 py-2 text-xs"
              onClick={() => {
                setOpen(false);
                onUnlock();
              }}
            >
              {t.unlock.replace("{price}", price)}
            </button>
          ) : (
            <Link
              href={localizedHref("/plans", locale)}
              className="btn-gradient mt-3 inline-flex px-4 py-2 text-xs no-underline"
              onClick={() => setOpen(false)}
            >
              {t.cta}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
