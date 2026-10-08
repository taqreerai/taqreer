"use client";

// BrandFontPicker — the brand-font selector (flow-card redesign).
//
// BOTH inputs are shown, stacked (the mode SegmentedToggle was removed
// 2026-06-02 to fill the branding-card height the logo position editor used
// to take):
//   • Google family → GoogleFontSlot, ONE family. Claude varies weights
//     across the deck (the named-weight embed handles every weight) and
//     uses the one family for headings + body, so there's no second slot.
//   • Upload (under Google) → a multi-file dropzone: drop up to
//     MAX_UPLOADED_FONTS family files in one go; Claude decides the
//     pairings. Each picked family shows as a chip with a remove button.
//
// RESOLUTION: each flow's submit prefers UPLOADED families when present,
// else the Google family (the `mode` field is now vestigial). Pure UI —
// the parent owns the `BrandFontState`.

import { useRef, useState } from "react";
import { FontInstallHint, GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  FONT_ACCEPT_EXTS,
  MAX_UPLOADED_FONTS,
  addUploadedFontFile,
  type BrandFontState,
} from "@/lib/brand/fonts";
import { useDict } from "@/components/i18n/LocaleProvider";

export function BrandFontPicker({
  value,
  onChange,
  sampleText,
  sampleSizeClass = "text-sm",
  compact = false,
  tall = false,
  allowAuto = false,
}: {
  // Offer "Auto" (no family = the server picks, 2026-10-08).
  allowAuto?: boolean;
  // One row (2026-10-02, /create Design step): label + the Google combobox
  // + a small upload button; uploaded families show as chips under it.
  compact?: boolean;
  // With `compact`: the row at the regular 44px input height (/create's
  // Brand card, 2026-10-07), the upload button matching it.
  tall?: boolean;
  value: BrandFontState;
  onChange: (next: BrandFontState) => void;
  // Live-preview copy for the Google combobox sample line.
  sampleText: string;
  sampleSizeClass?: string;
}) {
  const dict = useDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const atCap = value.uploaded.length >= MAX_UPLOADED_FONTS;
  const hasPills = value.uploaded.length > 0;

  const addFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    // Group every dropped file by family (weight word stripped) and by
    // weight within a family, so dropping "Brand-Light/Regular/Bold.otf"
    // yields ONE family with three weight faces — not three families.
    let next = value.uploaded;
    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      if (!FONT_ACCEPT_EXTS.some((ext) => name.endsWith(ext))) continue;
      next = addUploadedFontFile(next, file);
    }
    // Uploading makes uploaded the active source (both submit flows prefer
    // uploaded families), so clear any Google pick — otherwise a stale Google
    // selection stays visible but is silently ignored on submit.
    if (next !== value.uploaded)
      onChange({ ...value, googleFamily: null, uploaded: next });
  };

  const removeAt = (index: number) =>
    onChange({
      ...value,
      uploaded: value.uploaded.filter((_, i) => i !== index),
    });

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".woff2,.woff,.ttf,.otf"
      multiple
      className="hidden"
      onChange={(event) => {
        addFiles(event.target.files);
        event.currentTarget.value = "";
      }}
    />
  );
  const chips = value.uploaded.map((u, index) => (
    <span
      key={`${u.name}-${index}`}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-foreground bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]"
    >
      <span className="material-symbols-outlined text-foreground/60" style={{ fontSize: 13 }}>
        font_download
      </span>
      <span className="max-w-[120px] truncate">{u.name}</span>
      {u.faces.length > 1 ? (
        <span className="text-[10px] text-foreground/40">
          {dict.flows.fonts.weights.replace("{count}", String(u.faces.length))}
        </span>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          removeAt(index);
        }}
        aria-label={dict.flows.brand.removeFont.replace("{label}", u.name)}
        className="flex h-4 w-4 items-center justify-center rounded-full text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
          close
        </span>
      </button>
    </span>
  ));

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={`shrink-0 font-semibold ${tall ? "text-sm text-foreground/80" : "text-xs text-foreground/70"}`}
          >
            {dict.flows.fonts.fonts}
          </span>
          <div className="min-w-0 flex-1">
            <GoogleFontSlot
              selected={value.googleFamily}
              autoOption={allowAuto}
              sampleText={sampleText}
              sampleSizeClass={sampleSizeClass}
              onSelect={(family) =>
                onChange({ ...value, googleFamily: family, uploaded: [] })
              }
              hideSample
              compact={!tall}
              hideInstallHint
            />
          </div>
          {fileInput}
          <button
            type="button"
            onClick={() => !atCap && inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!atCap) addFiles(event.dataTransfer.files);
            }}
            disabled={atCap}
            title={`${dict.flows.fonts.uploadFonts} (${dict.flows.fonts.fontFormats.replace("{max}", String(MAX_UPLOADED_FONTS))})`}
            aria-label={dict.flows.fonts.uploadFonts}
            className={`flex ${tall ? "h-11 rounded-full px-3" : "h-[30px] rounded-lg px-2"} shrink-0 items-center gap-1 border border-dashed border-foreground/20 text-[11px] font-medium text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
              upload
            </span>
            {dict.flows.fonts.uploadShort}
          </button>
        </div>
        {hasPills ? (
          <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">{chips}</div>
        ) : value.googleFamily ? (
          // Full-width line under the row (not inside the dropdown's column),
          // so the label, dropdown and upload button stay on one aligned line.
          <FontInstallHint family={value.googleFamily} className="" />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* pb-1 (4px) + the stack's space-y-3 (12px) = a 16px title→selector
          gap, unified with the logo section's gap-4 across every flow. */}
      <span className="block pb-1 text-xs font-semibold text-foreground/70">
        {dict.flows.fonts.fonts}
      </span>

      <GoogleFontSlot
        selected={value.googleFamily}
        autoOption={allowAuto}
        sampleText={sampleText}
        sampleSizeClass={sampleSizeClass}
        onSelect={(family) =>
          // Picking a Google family clears uploaded families so the two sources
          // stay mutually exclusive and the visible choice matches what submit
          // uses (uploaded would otherwise win and silently ignore this pick).
          onChange({ ...value, googleFamily: family, uploaded: [] })
        }
        hideSample
      />

      {/* أو — both inputs are shown now (the mode toggle was removed); each
          flow's submit prefers uploaded font families when present, else the
          chosen Google family. */}
      <div className="flex items-center gap-2" aria-hidden>
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="shrink-0 text-[10px] text-foreground/40">{dict.flows.fonts.orUpload}</span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>

      <div className="space-y-2">
          {fileInput}
          {/* Drop zone — when families are picked, their chips live INSIDE
              here on one horizontally-scrollable row. The leading icon is a
              real upload button (the AT-/keyboard-accessible trigger), so you
              can keep adding families even when chips fill the row; clicking
              empty space in the zone also uploads. The container is a plain
              div (not a button) so the chips can carry their own remove
              buttons without nesting interactive controls. */}
          <div
            onClick={() => !atCap && inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!atCap) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!atCap) addFiles(event.dataTransfer.files);
            }}
            className={`flex h-16 items-center gap-2 rounded-xl border border-dashed bg-overlay-soft px-3 transition-colors ${
              atCap ? "cursor-not-allowed" : "cursor-pointer"
            } ${hasPills ? "justify-start" : "justify-center"} ${
              dragging
                ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
                : "border-foreground/15 hover:border-foreground/30"
            }`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!atCap) inputRef.current?.click();
              }}
              disabled={atCap}
              aria-label={dict.flows.fonts.uploadFonts}
              className="flex shrink-0 items-center justify-center text-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-foreground/30"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                {hasPills ? "add" : "font_download"}
              </span>
            </button>

            {hasPills ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto hide-scrollbar">
                {chips}
              </div>
            ) : (
              <>
                <span className="text-xs font-semibold text-foreground">
                  {atCap
                    ? dict.flows.fonts.maxFonts.replace("{max}", String(MAX_UPLOADED_FONTS))
                    : dict.flows.fonts.uploadFonts}
                </span>
                {atCap ? null : (
                  <span className="text-[10px] text-foreground/40">
                    {dict.flows.fonts.fontFormats.replace("{max}", String(MAX_UPLOADED_FONTS))}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}
