"use client";

// Compact file-drop zone — used for the logo card on both /create/brand
// and /enhance/content, and for the screenshot palette extractor.
//
// One small dropzone that:
//   • opens the OS file picker on click
//   • accepts a drag-dropped file
//   • re-validates the extension/MIME on drop (the native `<input
//     accept>` filter only applies to the picker, not to drops)
//   • surfaces the selected filename underneath
//
// `compact` shrinks the vertical footprint for cards that pair the
// dropzone with other controls underneath (e.g. /create/brand's logo
// position picker). Default heights match the original brand-page
// implementation.
//
// Extracted from /create/brand/page.tsx (2026-05-25) for /enhance
// reuse. Per the "reuse > extend > fork > build new" rule.

import { useRef, useState } from "react";

export function CompactUploadZone({
  label,
  accept,
  file,
  onSelect,
  compact = false,
}: {
  label: string;
  accept: string;
  file: File | null;
  onSelect: (file: File) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Native `<input accept>` filters the OS picker but drag-drop bypasses
  // it — caller passes the same accept string here so we can validate
  // a dropped file by extension before forwarding. Empty / wildcard
  // accept = accept anything.
  const acceptDropped = (dropped: File | undefined) => {
    if (!dropped) return;
    if (accept.trim() && accept !== "*") {
      const exts = accept.split(",").map((s) => s.trim().toLowerCase());
      const mime = dropped.type.toLowerCase();
      const name = dropped.name.toLowerCase();
      const matches = exts.some((ext) => {
        if (ext.startsWith(".")) return name.endsWith(ext);
        // MIME pattern (e.g. "image/*", "image/svg+xml")
        if (ext.endsWith("/*")) return mime.startsWith(ext.slice(0, -1));
        return mime === ext;
      });
      if (!matches) return;
    }
    onSelect(dropped);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const nextFile = event.target.files?.[0];
          if (nextFile) onSelect(nextFile);
          event.currentTarget.value = "";
        }}
      />
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
          acceptDropped(event.dataTransfer.files?.[0]);
        }}
        // 1 px dashed border (unified with every other upload zone
        // in the app since 2026-05-22 — was `border-2`). Dragging
        // brightens the border + adds a faint brand wash for clear
        // drop-target affordance.
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-black/20 text-center transition-colors ${
          dragging
            ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
            : "border-white/15 hover:border-white/30"
        } ${compact ? "gap-1.5 p-2.5" : "p-4"}`}
        style={{ minHeight: compact ? 72 : 100 }}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-bg-glass)]"
        >
          <span
            className="material-symbols-outlined text-white/80"
            style={{ fontSize: 22 }}
          >
            upload
          </span>
        </span>
        <span className="text-sm font-semibold text-white">{label}</span>
        {file ? (
          <span className="max-w-full truncate text-xs text-white/60">
            {file.name}
          </span>
        ) : null}
      </button>
    </div>
  );
}
