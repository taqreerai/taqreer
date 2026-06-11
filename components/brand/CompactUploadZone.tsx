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
  // When true, the picked filename is NOT rendered under the icon +
  // label. Used by /mimic's content card where the dropzone shares
  // space with other controls and any post-upload height growth
  // would reflow the whole 3-card row. Defaults to false so /create
  // + /enhance keep their existing "show the filename" behaviour.
  hideFilename = false,
  // When true, the dropzone button stretches vertically via h-full
  // instead of sitting at its natural minHeight. Used by /mimic's
  // content card where the logo upload sits beside a taller sibling
  // (stacked ratio tiles); without h-full the logo button stays at
  // ~86 px while the column is stretched to ~96 px by items-stretch,
  // leaving an awkward gap below it. Default false so /create +
  // /enhance keep their existing self-sized dropzone.
  fillHeight = false,
  // Horizontal layout: icon on the inline-start side (visual right
  // in RTL), label + optional sub-text on the inline-end side, all
  // in one row. Used by /create's branding-card logo upload where
  // a tall stacked dropzone would unbalance the row against the
  // single-line font slots. Default false keeps /enhance + /mimic
  // stacked.
  horizontal = false,
  // Muted second line shown beneath the primary label (e.g. "SVG /
  // PNG only", "Max 5 MB"). Renders in both stacked and horizontal
  // modes when provided.
  subText,
  // Renders the primary `label` in muted color (text-foreground/40)
  // instead of the default `text-foreground`. Used by the logo upload
  // slots on /create + /enhance + /mimic where the empty-state
  // label doubles as a format hint ("SVG فقط") and should read as
  // a sub-message, not a CTA. Callers flip this OFF as soon as a
  // file lands so the filename pops at full contrast.
  muted = false,
}: {
  label: string;
  accept: string;
  file: File | null;
  onSelect: (file: File) => void;
  compact?: boolean;
  hideFilename?: boolean;
  fillHeight?: boolean;
  horizontal?: boolean;
  subText?: string;
  muted?: boolean;
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
    <div className={fillHeight ? "h-full" : undefined}>
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
        //
        // Axis switches between flex-col (stacked, default) and
        // flex-row (horizontal). In horizontal mode the start side
        // (visual right in RTL) holds the icon, the end side holds
        // the label + sub-text stacked vertically — same pattern
        // /mimic's inline FileDropzone uses.
        className={`flex w-full rounded-xl border border-dashed bg-black/20 transition-colors ${
          horizontal
            ? "flex-row items-center gap-3 p-2.5 text-start"
            : "flex-col items-center justify-center gap-2 text-center"
        } ${
          dragging
            ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
            : "border-foreground/15 hover:border-foreground/30"
        } ${horizontal ? "" : compact ? "gap-1.5 p-2.5" : "p-4"} ${
          fillHeight ? "h-full" : ""
        }`}
        style={{
          minHeight: horizontal ? 48 : compact ? 72 : 100,
        }}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--tq-surface)] ${
            horizontal ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          <span
            className="material-symbols-outlined text-foreground/80"
            style={{ fontSize: horizontal ? 18 : 22 }}
          >
            upload
          </span>
        </span>
        {horizontal ? (
          <div className="min-w-0 flex-1">
            <p
              className={`truncate font-semibold ${
                muted ? "text-[11px] text-foreground/40" : "text-sm text-foreground"
              }`}
            >
              {label}
            </p>
            {/* Sub-text — show subText when provided, otherwise show
                the picked filename (when not hidden). Falls back to
                nothing so the row stays a single line in the empty
                + no-subText case. */}
            {subText ? (
              <p className="mt-0.5 truncate text-[11px] text-foreground/40">
                {subText}
              </p>
            ) : file && !hideFilename ? (
              <p className="mt-0.5 truncate text-[11px] text-foreground/60">
                {file.name}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <span
              className={`font-semibold ${
                muted ? "text-[11px] text-foreground/40" : "text-sm text-foreground"
              }`}
            >
              {label}
            </span>
            {file && !hideFilename ? (
              <span className="max-w-full truncate text-xs text-foreground/60">
                {file.name}
              </span>
            ) : null}
            {subText ? (
              <span className="mt-0.5 truncate text-[10px] text-foreground/40">
                {subText}
              </span>
            ) : null}
          </>
        )}
      </button>
    </div>
  );
}
