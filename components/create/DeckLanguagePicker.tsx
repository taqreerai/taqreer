"use client";

// The deck's language on Create (owner, 2026-11-05). A typed prompt must pick
// one: nothing is preselected, because a hidden default silently translated
// decks. An upload follows its file, and only asks when the file's language
// could not be read. The prompt's own language is marked Suggested, never
// chosen for the user. Names come from Intl.DisplayNames in the page's locale.

import { useMemo } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { WRITING_LANGUAGES } from "@/lib/language/detect";
import { SegmentedToggle } from "@/components/create/controls";

const MAIN = ["ar", "en", "fr"];

export function DeckLanguagePicker({
  value,
  fileLanguage,
  suggested,
  missing,
  onChange,
  disabled = false,
}: {
  value: string | null;
  // The uploaded file's language: shown as a fact, with nothing to pick.
  fileLanguage: string | null;
  suggested: string | null;
  // Highlights the row when the user has content but no language yet.
  missing: boolean;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const t = useDict().flows;
  const { locale } = useLocale();
  const nameOf = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      names = null;
    }
    return (code: string) => names?.of(code) ?? code;
  }, [locale]);

  if (fileLanguage) {
    return (
      <p className="text-sm text-muted">
        {t.deckLanguage}: <span className="font-semibold text-foreground">{t.deckLanguageFromFile.replace("{lang}", nameOf(fileLanguage))}</span>
      </p>
    );
  }

  const others = WRITING_LANGUAGES.filter((code) => !MAIN.includes(code));
  const pickedOther = value !== null && !MAIN.includes(value);
  return (
    <div className="flex flex-col gap-2">
      <p className={`text-sm font-semibold ${missing ? "text-red-400" : "text-foreground"}`}>
        {missing ? t.chooseDeckLanguage : t.deckLanguage}
      </p>
      <div className="flex flex-wrap items-stretch gap-2">
        {/* The main three as the shared segmented track (one look with the
            other Create choices); nothing is active until the user picks. */}
        <SegmentedToggle
          options={MAIN.map((code) => ({
            value: code,
            label: (
              <>
                {nameOf(code)}
                {suggested === code ? <span className="ms-1 opacity-80">· {t.suggestedLanguage}</span> : null}
              </>
            ),
          }))}
          value={value !== null && MAIN.includes(value) ? value : ""}
          onChange={(code) => !disabled && onChange(code)}
          ariaLabel={t.deckLanguage}
          variant="primary"
          size="comfortable"
        />
        {/* Native select for the long list, with its own arrow hidden and a
            chevron pinned to the inline end so it sits centred in both
            directions. */}
        <div className="relative">
          <select
            aria-label={t.moreLanguages}
            disabled={disabled}
            value={pickedOther ? (value as string) : ""}
            onChange={(event) => event.target.value && onChange(event.target.value)}
            className={`h-full cursor-pointer appearance-none rounded-full border bg-[var(--tq-card)] pe-8 ps-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              pickedOther
                ? "border-[var(--tq-blue)] text-foreground"
                : "border-[var(--tq-border-hairline)] text-foreground/60 hover:text-foreground"
            }`}
          >
            <option value="">{t.moreLanguages}</option>
            {others.map((code) => (
              <option key={code} value={code}>
                {nameOf(code)}
                {suggested === code ? ` · ${t.suggestedLanguage}` : ""}
              </option>
            ))}
          </select>
          {/* The icon font sets direction:ltr, so the wrapper (page direction)
              carries the inline-end position. */}
          <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-foreground/60" aria-hidden>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              expand_more
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
