"use client";

// Searchable Google-Fonts combobox.
//
// Input + chevron in a single field. Click the field (or the chevron)
// to open a styled popup of all available families; type to filter the
// list to matches. Selecting an item closes the popup and writes the
// family back via `onSelect`. The popup keeps the same row styling as
// the previous always-visible list (active row = white-stroke pill,
// each row previews its own family on the trailing "Aa" chip).
//
// Native `<select>` was rejected because its OS popup doesn't honour
// the glass chrome — this gives us full control over the dropdown
// surface while still feeling like a standard searchable field.
//
// Extracted from /create/brand/page.tsx (2026-05-25) for /enhance
// reuse. Per the "reuse > extend > fork > build new" rule.

import { useEffect, useRef, useState } from "react";
import { GOOGLE_FONTS } from "@/lib/brand/fonts";

export function GoogleFontSlot({
  selected,
  sampleText,
  sampleSizeClass,
  onSelect,
  // Mirrors FontUploadSlot's alignStart — when true the live sample
  // preview is forced to `dir="rtl"` + text-right regardless of
  // script. Used by /mimic where the brand-first product wants the
  // preview pinned to the reading edge. /create + /enhance keep the
  // BiDi-aware default (dir="auto" + text-start).
  alignStart = false,
  // Skip the sample-text paragraph below the combobox. Mirrors
  // FontUploadSlot's `hideSample` — used by /create.
  hideSample = false,
  // Shrink the combobox input to match FontUploadSlot's compact
  // mode (30 px tall, text-xs). Used by /create for consistent
  // input sizing across the branding card.
  compact = false,
}: {
  // `label` was previously passed but never rendered — combobox doesn't
  // own its own heading. Card-level <h3> sits above the slot in the
  // brand layout. Dropped from props to keep the API honest.
  selected: string | null;
  sampleText: string;
  sampleSizeClass: string;
  onSelect: (family: string | null) => void;
  alignStart?: boolean;
  hideSample?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-click closes the popup. mousedown (not click) so the
  // popup dismisses on focus-shift to another element, not after the
  // bubble — keeps tab-out behaviour clean.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const filtered = query.trim()
    ? GOOGLE_FONTS.filter((font) =>
        font.family.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : GOOGLE_FONTS;

  const inputValue = open ? query : selected ?? "";
  const showPlaceholder = !inputValue;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          placeholder={showPlaceholder ? "اكتب أو اختر خط Google..." : ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          // Inline padding + height pin so the combobox matches the
          // FontUploadSlot button at 44 px EXACTLY — switching between
          // "رفع ملف" and "Google Fonts" produces zero card height
          // change. Padding override also makes room for the chevron
          // on the start edge (RTL → left).
          className={`input-dark text-right ${compact ? "text-xs" : "text-sm"}`}
          style={{
            height: compact ? 30 : 44,
            padding: compact ? "0 12px 0 30px" : "0 16px 0 40px",
          }}
        />
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            if (!open) {
              setQuery("");
              inputRef.current?.focus();
            }
          }}
          aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-white/60 transition-colors hover:text-white"
        >
          <span
            className={`material-symbols-outlined block leading-none transition-transform ${
              open ? "rotate-180" : ""
            }`}
            style={{ fontSize: 18 }}
          >
            expand_more
          </span>
        </button>
      </div>
      {open ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1 overflow-y-auto rounded-xl border p-1 bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]"
          // `top: 100%` would stack on the sample line; anchor at the
          // input's actual height — 44 px regular, 30 px compact — so
          // the menu sits directly under the field in both modes.
          // Pre-fix this was hardcoded 44 and the menu floated 14 px
          // below the bottom edge of the compact input on /create.
          // 240 px max-h fits ~6 rows; the rest scrolls.
          //
          // Surface recipe matches the quality-preset dropdown on
          // /create/summary: translucent-white fill at glass-opacity
          // over the dark backdrop, glass-border-opacity hairline,
          // blur token — all via the
          // --tq-surface / --tq-border-hairline tokens.
          style={{
            top: compact ? 30 : 44,
            maxHeight: 240,
          }}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-white/40">لا توجد نتائج</p>
          ) : (
            filtered.map((font) => {
              const isActive = selected === font.family;
              return (
                <button
                  key={font.family}
                  type="button"
                  onClick={() => {
                    onSelect(isActive ? null : font.family);
                    setOpen(false);
                    setQuery("");
                  }}
                  // Active row uses the same vocabulary as the Pill
                  // primitive: white-stroke + white text on the glass
                  // surface (no purple gradient). Idle row is muted
                  // text with a faint hover lift.
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "text-white"
                      : "border-transparent text-white/70 hover:bg-white/5"
                  }`}
                  style={
                    isActive
                      ? {
                          borderColor: "var(--tq-text-primary)",
                          background: "var(--tq-surface)",
                        }
                      : undefined
                  }
                >
                  <span className="flex items-center gap-2">
                    <span>{font.family}</span>
                    <span
                      className={`text-[10px] ${isActive ? "text-white/80" : "text-white/40"}`}
                    >
                      {font.arabic ? "عربي + لاتيني" : "لاتيني"}
                    </span>
                  </span>
                  <span
                    className="text-base"
                    style={{
                      fontFamily: `"${font.family}", system-ui, sans-serif`,
                    }}
                  >
                    Aa
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {hideSample ? null : (
        <p
          dir={alignStart ? "rtl" : "auto"}
          className={`mt-3 ${sampleSizeClass} ${alignStart ? "text-right" : "text-start"} text-white`}
          style={
            selected
              ? { fontFamily: `"${selected}", system-ui, sans-serif` }
              : undefined
          }
        >
          {sampleText}
        </p>
      )}
    </div>
  );
}
