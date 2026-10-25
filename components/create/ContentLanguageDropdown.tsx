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

export function ContentLanguageDropdown({
  value,
  detected,
  onChange,
  disabled = false,
}: {
  // The user's pick, or null for Auto.
  value: string | null;
  // What extraction found (null = nothing to go on).
  detected: string | null;
  onChange: (code: string | null) => void;
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
  const current = value
    ? nameOf(value)
    : detected
      ? `${auto} · ${nameOf(detected)}`
      : auto;

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
          open ? "border-foreground/40" : "border-foreground/15 hover:border-foreground/30"
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
