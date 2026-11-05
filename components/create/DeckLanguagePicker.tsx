"use client";

// The deck's language on Create (owner, 2026-11-05). A typed prompt must pick
// one: nothing is preselected, because a hidden default silently translated
// decks. An upload follows its file, and only asks when the file's language
// could not be read. The prompt's own language is marked Suggested, never
// chosen for the user. Names come from Intl.DisplayNames in the page's locale.

import { useMemo } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { WRITING_LANGUAGES } from "@/lib/language/detect";

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
      <div role="radiogroup" aria-label={t.deckLanguage} className="flex flex-wrap items-center gap-2">
        {MAIN.map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={value === code}
            disabled={disabled}
            onClick={() => onChange(code)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              value === code
                ? "border-[var(--tq-blue)] bg-[var(--tq-blue)] text-white"
                : "border-[var(--tq-border-hairline)] text-foreground hover:bg-foreground/5"
            }`}
          >
            {nameOf(code)}
            {suggested === code ? <span className="ms-1 text-xs opacity-80">· {t.suggestedLanguage}</span> : null}
          </button>
        ))}
        <select
          aria-label={t.moreLanguages}
          disabled={disabled}
          value={pickedOther ? (value as string) : ""}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          className={`rounded-full border bg-transparent px-3 py-1.5 text-sm text-foreground ${
            pickedOther ? "border-[var(--tq-blue)]" : "border-[var(--tq-border-hairline)]"
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
      </div>
    </div>
  );
}
