"use client";

// BrandFontPicker — the single brand-font selector (flow-card redesign).
//
// Replaces the old heading + body two-slot fonts UI. One control, two
// modes via a SegmentedToggle:
//   • "خط Google" → GoogleFontSlot, ONE family. Claude varies weights
//     across the deck (the named-weight embed handles every weight) and
//     uses the one family for headings + body, so there's no second slot.
//   • "رفع خطوط"  → a multi-file dropzone: drop up to MAX_UPLOADED_FONTS
//     family files in one go; Claude decides the pairings. Each picked
//     family shows as a chip with a remove button.
//
// Pure UI — the parent owns the `BrandFontState`. Reuses the shared
// SegmentedToggle + GoogleFontSlot primitives (reuse > build new).

import { useRef, useState } from "react";
import { SegmentedToggle } from "@/components/create/controls";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  FONT_ACCEPT_EXTS,
  MAX_UPLOADED_FONTS,
  addUploadedFontFile,
  type BrandFontState,
} from "@/lib/brand/fonts";

const MODE_OPTIONS = [
  { value: "google" as const, label: "خط Google" },
  { value: "upload" as const, label: "رفع خطوط" },
];

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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white/70">الخطوط</span>
        <SegmentedToggle
          options={MODE_OPTIONS}
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          ariaLabel="نوع الخط"
        />
      </div>

      {value.mode === "google" ? (
        <GoogleFontSlot
          selected={value.googleFamily}
          sampleText={sampleText}
          sampleSizeClass={sampleSizeClass}
          onSelect={(family) => onChange({ ...value, googleFamily: family })}
          hideSample
        />
      ) : (
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
            className={`flex items-center gap-2 rounded-xl border border-dashed bg-black/20 px-3 transition-colors ${
              atCap ? "cursor-not-allowed" : "cursor-pointer"
            } ${hasPills ? "justify-start" : "justify-center"} ${
              dragging
                ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
                : "border-white/15 hover:border-white/30"
            }`}
            style={{ height: 44 }}
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
      )}
    </div>
  );
}
