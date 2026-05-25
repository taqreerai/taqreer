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
}: {
  // `label` was previously passed but never rendered — combobox doesn't
  // own its own heading. Card-level <h3> sits above the slot in the
  // brand layout. Dropped from props to keep the API honest.
  selected: string | null;
  sampleText: string;
  sampleSizeClass: string;
  onSelect: (family: string | null) => void;
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
    <div ref={wrapperRef} className="relative space-y-3">
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
          className="input-dark text-right text-sm"
          style={{ height: 44, padding: "0 16px 0 40px" }}
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
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 transition-colors hover:text-white"
        >
          <span
            className={`material-symbols-outlined block transition-transform ${
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
          className="absolute left-0 right-0 z-30 mt-1 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-glass"
          // `top: 100%` would stack on the sample line; using `top: 44`
          // (input height) anchors the popup directly under the field.
          // 240 px max-h fits ~6 rows; the rest scrolls.
          //
          // Surface recipe matches the quality-preset dropdown on
          // /create/summary: translucent-white fill at glass-opacity
          // over the dark backdrop, glass-border-opacity hairline,
          // backdrop-blur-glass blur token.
          style={{
            top: 44,
            maxHeight: 240,
            background: "rgba(255, 255, 255, var(--glass-opacity))",
            borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
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
                          borderColor: "rgba(255, 255, 255, 1)",
                          background:
                            "rgba(255, 255, 255, var(--glass-opacity))",
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
      <p
        // `dir="auto"` + `text-start` so Latin samples (when the
        // picked Google family is flagged `arabic: false` — added
        // 2026-05-22) align left and read L→R; Arabic samples keep
        // their right-aligned RTL flow.
        dir="auto"
        className={`${sampleSizeClass} text-start text-white`}
        style={
          selected
            ? { fontFamily: `"${selected}", system-ui, sans-serif` }
            : undefined
        }
      >
        {sampleText}
      </p>
    </div>
  );
}
