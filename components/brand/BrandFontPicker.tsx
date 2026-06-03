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
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  FONT_ACCEPT_EXTS,
  MAX_UPLOADED_FONTS,
  addUploadedFontFile,
  type BrandFontState,
} from "@/lib/brand/fonts";

export function BrandFontPicker({
  value,
  onChange,
  sampleText,
  sampleSizeClass = "text-sm",
}: {
  value: BrandFontState;
  onChange: (next: BrandFontState) => void;
  // Live-preview copy for the Google combobox sample line.
  sampleText: string;
  sampleSizeClass?: string;
}) {
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
    if (next !== value.uploaded) onChange({ ...value, uploaded: next });
  };

  const removeAt = (index: number) =>
    onChange({
      ...value,
      uploaded: value.uploaded.filter((_, i) => i !== index),
    });

  return (
    <div className="space-y-3">
      {/* pb-1 (4px) + the stack's space-y-3 (12px) = a 16px title→selector
          gap, unified with the logo section's gap-4 across every flow. */}
      <span className="block pb-1 text-xs font-semibold text-white/70">
        الخطوط
      </span>

      <GoogleFontSlot
        selected={value.googleFamily}
        sampleText={sampleText}
        sampleSizeClass={sampleSizeClass}
        onSelect={(family) => onChange({ ...value, googleFamily: family })}
        hideSample
      />

      {/* أو — both inputs are shown now (the mode toggle was removed); each
          flow's submit prefers uploaded font families when present, else the
          chosen Google family. */}
      <div className="flex items-center gap-2" aria-hidden>
        <span className="h-px flex-1 bg-white/10" />
        <span className="shrink-0 text-[10px] text-white/40">أو ارفع خطوطك</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <div className="space-y-2">
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
            className={`flex h-16 items-center gap-2 rounded-xl border border-dashed bg-black/20 px-3 transition-colors ${
              atCap ? "cursor-not-allowed" : "cursor-pointer"
            } ${hasPills ? "justify-start" : "justify-center"} ${
              dragging
                ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
                : "border-white/15 hover:border-white/30"
            }`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!atCap) inputRef.current?.click();
              }}
              disabled={atCap}
              aria-label="رفع عائلات خطوط"
              className="flex shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-white/30"
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
                {value.uploaded.map((u, index) => (
                  <span
                    key={`${u.name}-${index}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-white bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
                  >
                    <span
                      className="material-symbols-outlined text-white/60"
                      style={{ fontSize: 13 }}
                    >
                      font_download
                    </span>
                    <span className="max-w-[120px] truncate">{u.name}</span>
                    {u.faces.length > 1 ? (
                      <span className="text-[10px] text-white/40">
                        {u.faces.length} أوزان
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeAt(index);
                      }}
                      aria-label={`إزالة ${u.name}`}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 12 }}
                      >
                        close
                      </span>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <>
                <span className="text-xs font-semibold text-white">
                  {atCap
                    ? `الحد الأقصى ${MAX_UPLOADED_FONTS} خطوط`
                    : "رفع عائلات خطوط"}
                </span>
                {atCap ? null : (
                  <span className="text-[10px] text-white/40">
                    — حتى {MAX_UPLOADED_FONTS} · WOFF / TTF / OTF
                  </span>
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}
