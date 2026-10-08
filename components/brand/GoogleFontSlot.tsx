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
//
// Searches the full bundled Google Fonts catalog (2026-10-04; was a curated
// 16-family list), Arabic-capable families first, same search as the
// editor's FontControl.

import { useEffect, useMemo, useRef, useState } from "react";
import { previewCss2Url, searchGoogleFonts } from "@/lib/editor/font-search";

// One shared stylesheet that loads the default weight of the families
// currently listed, so each row renders in its own typeface. Re-pointed at
// the visible results as the query changes (same approach as FontControl).
const PREVIEW_LINK_ID = "tq-brand-font-preview";
const RESULT_LIMIT = 60;
import { useDict } from "@/components/i18n/LocaleProvider";

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
  // Open the result list ABOVE the input (studio font menu, which sits near
  // the bottom of the screen).
  dropUp = false,
  // Compact rows (BrandFontPicker compact) render <FontInstallHint> under the
  // WHOLE row instead, so the label + upload button stay on one aligned line.
  hideInstallHint = false,
  // An "Auto" row on top of the list (creation tools, 2026-10-08): null
  // `selected` reads as Auto and the server picks the family.
  autoOption = false,
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
  dropUp?: boolean;
  hideInstallHint?: boolean;
  autoOption?: boolean;
}) {
  const dict = useDict();
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

  const filtered = useMemo(
    () =>
      searchGoogleFonts(query, { limit: RESULT_LIMIT }).map((e) => ({
        family: e.f,
        arabic: e.a === 1,
      })),
    [query],
  );

  useEffect(() => {
    if (!open || filtered.length === 0) return;
    let link = document.getElementById(PREVIEW_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = PREVIEW_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = previewCss2Url(filtered.map((font) => font.family));
  }, [open, filtered]);

  const inputValue = open ? query : selected ?? (autoOption ? dict.flows.brand.fontAuto : "");
  const showPlaceholder = !inputValue;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          placeholder={showPlaceholder ? dict.flows.brand.googleFontPlaceholder : ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          // Inline padding + height pin so the combobox matches the
          // FontUploadSlot button at 44 px EXACTLY. Logical padding leaves room
          // for the chevron on the inline-END edge (left in RTL, right in LTR);
          // text-start keeps the typed family on the reading edge in both dirs.
          className={`input-dark text-start ${compact ? "text-xs" : "text-sm"}`}
          style={{
            height: compact ? 30 : 44,
            paddingInlineStart: compact ? 12 : 16,
            paddingInlineEnd: compact ? 30 : 40,
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
          aria-label={open ? dict.flows.brand.closeMenu : dict.flows.brand.openMenu}
          className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-foreground/60 transition-colors hover:text-foreground"
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
          className={`absolute left-0 right-0 z-30 ${dropUp ? "bottom-full mb-1" : "mt-1"} overflow-y-auto rounded-xl border p-1 bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]`}
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
            top: dropUp ? undefined : compact ? 30 : 44,
            maxHeight: 240,
          }}
        >
          {autoOption && !query ? (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
                setQuery("");
              }}
              className={`mb-1 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
                selected === null
                  ? "text-foreground"
                  : "border-transparent text-foreground/70 hover:bg-foreground/5"
              }`}
              style={
                selected === null
                  ? { borderColor: "var(--tq-text-primary)", background: "var(--tq-surface)" }
                  : undefined
              }
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                    auto_awesome
                  </span>
                  {dict.flows.brand.fontAuto}
                </span>
                <span className="text-[11px] text-foreground/50">{dict.flows.brand.fontAutoHint}</span>
              </span>
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-foreground/40">{dict.flows.brand.noResults}</p>
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
                      ? "text-foreground"
                      : "border-transparent text-foreground/70 hover:bg-foreground/5"
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
                    {/* The name in its own typeface, so the list itself is
                        the preview. */}
                    <span style={{ fontFamily: `"${font.family}", system-ui, sans-serif` }}>
                      {font.family}
                    </span>
                    <span
                      className={`text-[10px] ${isActive ? "text-foreground/80" : "text-foreground/40"}`}
                    >
                      {font.arabic ? dict.flows.brand.scriptArabicLatin : dict.flows.brand.scriptLatin}
                    </span>
                  </span>
                  {/* Sample glyphs in the family: Arabic letters for fonts
                      that carry Arabic (what the user is choosing for),
                      "Aa" for Latin-only ones. */}
                  <span
                    className="text-base"
                    dir={font.arabic ? "rtl" : "ltr"}
                    style={{
                      fontFamily: `"${font.family}", system-ui, sans-serif`,
                    }}
                  >
                    {font.arabic ? "أبجد" : "Aa"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {selected && !hideInstallHint ? <FontInstallHint family={selected} /> : null}
      {hideSample ? null : (
        <p
          // alignStart pins the sample to the chrome's reading edge (inherit
          // dir + text-start → right in RTL, left in LTR); default is BiDi-aware
          // (dir=auto picks direction from the sample's own script).
          dir={alignStart ? undefined : "auto"}
          className={`mt-3 ${sampleSizeClass} text-start text-foreground`}
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

/**
 * "Install this font" hint (2026-10-05). PPTX exports embed only the glyphs a
 * deck uses, so EDITING in PowerPoint is smoothest with the font installed.
 * Links straight to the family's Google Fonts page in a new tab.
 */
export function FontInstallHint({
  family,
  className = "mt-1.5",
}: {
  family: string;
  className?: string;
}) {
  const dict = useDict();
  return (
    <p className={`text-start text-[11px] leading-4 text-foreground/50 ${className}`}>
      {dict.flows.brand.fontInstallHint}{" "}
      <a
        href={`https://fonts.google.com/specimen/${encodeURIComponent(family).replace(/%20/g, "+")}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-[var(--tq-violet)] underline-offset-2 hover:underline"
      >
        <span>{dict.flows.brand.fontInstallCta.replace("{font}", family)}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 12 }} aria-hidden>
          open_in_new
        </span>
      </a>
    </p>
  );
}

