"use client";

// Font-file upload slot — one of the two modes a brand font slot can
// be in (the other is GoogleFontSlot's combobox).
//
// Two render states:
//   • Empty   → 44 px-high dashed dropzone matching the Google slot's
//               combobox height (so toggling modes produces zero
//               card-height shift).
//   • Picked  → glass row with the filename + an X button to clear.
//
// Below either state, a sample line previews the slot's family. The
// preview uses `dir="auto"` so Latin sample text renders L→R and
// Arabic stays RTL — added 2026-05-22 for the Latin-only Google
// families that ship with the catalog.
//
// `family` is a CSS class name (NOT a font family). /create/brand
// generates a per-slot @font-face block + class when an upload lands,
// and passes the class here for the live preview. /enhance leaves
// this empty (no live preview); the family still applies to the
// generated deck via the file's actual contents.
//
// Extracted from /create/brand/page.tsx (2026-05-25) for /enhance
// reuse. Per the "reuse > extend > fork > build new" rule.

import { useRef, useState } from "react";
import { FONT_ACCEPT_EXTS } from "@/lib/brand/fonts";
import { useDict } from "@/components/i18n/LocaleProvider";

export function FontUploadSlot({
  label,
  file,
  family,
  sampleText,
  sampleSizeClass,
  onSelect,
  onRemove,
  // When true, the dropzone-button content (icon + label + format
  // hint) anchors to the inline-start edge (visual right in RTL)
  // instead of centering, AND the sample paragraph below is forced
  // to RTL + right-aligned regardless of script. Used by /mimic
  // where the brand-first product wants both the CTA and the live
  // preview pinned to the page's reading edge. /create + /enhance
  // keep their centered button + dir="auto" sample (the default).
  alignStart = false,
  // Skip the sample-text paragraph below the dropzone entirely.
  // Used by /create where space is at a premium and the live
  // preview wasn't earning its vertical band — the user uploads
  // a font, that's signal enough; rendering the sample again
  // pushed the branding card past /enhance's 387-px envelope.
  hideSample = false,
  // Shrink the dropzone button to match the height/text-size of
  // the persistent-text input on /create (30 px tall, text-xs).
  // Default false keeps the legacy 44-px height for /enhance + /mimic.
  compact = false,
}: {
  label: string;
  file: File | null;
  family: string;
  sampleText: string;
  sampleSizeClass: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
  alignStart?: boolean;
  hideSample?: boolean;
  compact?: boolean;
}) {
  const dict = useDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Drag-drop validator. Native `<input accept>` filters the OS
  // picker but drag-drop bypasses it, so we check the extension here
  // before forwarding the file.
  const acceptDroppedFont = (dropped: File | undefined) => {
    if (!dropped) return;
    const name = dropped.name.toLowerCase();
    if (!FONT_ACCEPT_EXTS.some((ext) => name.endsWith(ext))) return;
    onSelect(dropped);
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".woff2,.woff,.ttf,.otf"
        className="hidden"
        onChange={(event) => {
          const nextFile = event.target.files?.[0];
          if (nextFile) onSelect(nextFile);
          event.currentTarget.value = "";
        }}
      />
      {file ? (
        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 bg-[var(--tq-surface)] border-[var(--tq-border-hairline)]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="material-symbols-outlined text-white/80"
              style={{ fontSize: 16 }}
            >
              font_download
            </span>
            <span className="truncate text-xs font-semibold text-white">{file.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              onRemove();
            }}
            aria-label={dict.flows.brand.removeFont.replace("{label}", label)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              close
            </span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            acceptDroppedFont(event.dataTransfer.files?.[0]);
          }}
          // Compact dropzone — horizontal layout (icon + label inline)
          // so the slot stays the same height as the Google-fonts
          // combobox input. 1 px dashed border (was 2 px, unified
          // 2026-05-22 with every other upload area). When `compact`,
          // the row shrinks to 30 px (matching the persistent-text
          // input on /create) and the label switches to text-xs +
          // smaller icon.
          className={`flex w-full items-center gap-2 rounded-xl border border-dashed bg-black/20 transition-colors ${
            compact ? "px-2.5 py-1" : "px-3 py-2"
          } ${
            alignStart ? "justify-start text-start" : "justify-center text-center"
          } ${
            dragging
              ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
              : "border-white/15 hover:border-white/30"
          }`}
          style={{ height: compact ? 30 : 44 }}
        >
          <span
            className="material-symbols-outlined text-white/70"
            style={{ fontSize: compact ? 14 : 18 }}
          >
            font_download
          </span>
          <span className={`${compact ? "text-[11px]" : "text-xs"} font-semibold text-white`}>{label}</span>
          {compact ? null : <span className="text-[10px] text-white/40">— WOFF / TTF / OTF</span>}
        </button>
      )}
      {hideSample ? null : (
        <p
          // `dir="auto"` + `text-start` so Latin sample text (when the
          // picked font is Latin-only — added 2026-05-22) reads
          // left-aligned + L→R, while Arabic samples keep their
          // right-aligned RTL flow.
          //
          // alignStart=true forces RTL + text-right regardless of script.
          // hideSample=true skips this paragraph entirely (see prop doc).
          dir={alignStart ? "rtl" : "auto"}
          className={`${sampleSizeClass} ${alignStart ? "text-right" : "text-start"} text-white${family ? ` ${family}` : ""}`}
        >
          {sampleText}
        </p>
      )}
    </div>
  );
}
