"use client";

// ContentLanguageDropdown - the "Auto" language picker of the Enhance card
// title row (owner, 2026-10-25). The file's language is detected at extraction
// (lib/language/detect.ts); this shows what was found and lets the user correct
// a wrong guess before generating. `value` null = Auto (use the detected one).
// Names come from Intl.DisplayNames in the page's locale, so no per-language
// dictionary. Same menu pattern as BrandKitDropdown.

import { useEffect, useMemo, useRef, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { LANGUAGE_CODES } from "@/lib/language/detect";
import { TRANSLATE_TARGETS, type TranslatePick, type TranslateTarget } from "@/lib/enhance/translate";

export function ContentLanguageDropdown({
  value,
  detected,
  onChange,
  translatePick,
  noteTarget = null,
  onTranslateChange,
  disabled = false,
}: {
  // The user's pick, or null for Auto.
  value: string | null;
  // What extraction found (null = nothing to go on).
  detected: string | null;
  onChange: (code: string | null) => void;
  // Translate to (lib/enhance/translate.ts): undefined = Auto (follow the
  // user's note, whose target is noteTarget), "keep", or a target. Without
  // onTranslateChange the menu has no translate section.
  translatePick?: TranslatePick;
  noteTarget?: TranslateTarget | null;
  onTranslateChange?: (pick: TranslatePick) => void;
  disabled?: boolean;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nameOf = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      names = null;
    }
    return (code: string) => names?.of(code) ?? code;
  }, [locale]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const auto = dict.flows.enhance.langAuto;
  const fileLang = value ?? detected;
  // The translation that will run: the pick, else what the note asks for.
  const translateTo: TranslateTarget | null =
    translatePick === "keep" ? null : (translatePick ?? noteTarget ?? null);
  const translating = !!onTranslateChange && !!translateTo && translateTo !== fileLang;
  const current = translating
    ? dict.flows.enhance.langTranslateChip.replace("{lang}", nameOf(translateTo))
    : value
      ? nameOf(value)
      : detected
        ? `${auto} · ${nameOf(detected)}`
        : auto;
  const heading = (text: string) => (
    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-foreground/50">{text}</div>
  );
  const optionClass = (selected: boolean) =>
    `flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-start text-sm transition-colors hover:bg-foreground/5 hover:text-foreground ${
      selected ? "text-foreground" : "text-foreground/80"
    }`;
  const check = (
    <span className="material-symbols-outlined ms-auto text-foreground/60" style={{ fontSize: 15 }}>
      check
    </span>
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={dict.flows.enhance.langAria}
        className={`flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          translating
            ? "border-[var(--tq-brand-blue)]"
            : open
              ? "border-foreground/40"
              : "border-foreground/15 hover:border-foreground/30"
        }`}
        style={{ background: "var(--tq-surface)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
          translate
        </span>
        <span>{current}</span>
        <span
          className={`material-symbols-outlined transition-transform ${open ? "rotate-180" : ""}`}
          style={{ fontSize: 13 }}
        >
          expand_more
        </span>
      </button>
      {open ? (
        <div
          className="absolute end-0 top-full z-30 mt-1 max-h-64 min-w-[180px] overflow-y-auto rounded-xl border bg-[var(--tq-surface)] p-1 border-[var(--tq-border-hairline)]"
          role="listbox"
          aria-label={dict.flows.enhance.langAria}
        >
          {onTranslateChange ? (
            <>
              {heading(dict.flows.enhance.langTranslateHeading)}
              {(["keep", ...TRANSLATE_TARGETS] as const).map((pick) => {
                if (pick !== "keep" && pick === fileLang) return null;
                const selected = pick === "keep" ? !translating : translating && translateTo === pick;
                return (
                  <button
                    key={pick}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onTranslateChange(pick);
                      setOpen(false);
                    }}
                    className={optionClass(selected)}
                  >
                    <span className="truncate">
                      {pick === "keep" ? dict.flows.enhance.langKeep : nameOf(pick)}
                      {pick !== "keep" && translatePick === undefined && noteTarget === pick ? (
                        <span className="ms-1 text-foreground/50">· {dict.flows.enhance.langFromNote}</span>
                      ) : null}
                    </span>
                    {selected ? check : null}
                  </button>
                );
              })}
              {heading(dict.flows.enhance.langFileHeading)}
            </>
          ) : null}
          {[null, ...LANGUAGE_CODES].map((code) => {
            const selected = code === value;
            return (
              <button
                key={code ?? "auto"}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(code);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-start text-sm transition-colors hover:bg-foreground/5 hover:text-foreground ${
                  selected ? "text-foreground" : "text-foreground/80"
                }`}
              >
                <span className="truncate">
                  {code === null ? (detected ? `${auto} · ${nameOf(detected)}` : auto) : nameOf(code)}
                </span>
                {selected ? (
                  <span className="material-symbols-outlined ms-auto text-foreground/60" style={{ fontSize: 15 }}>
                    check
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
