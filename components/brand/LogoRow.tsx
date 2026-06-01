"use client";

// LogoRow — compact logo upload + position picker on ONE row (flow-card
// redesign). Replaces the tall LogoUploadSlot + separate position grid +
// cover/closing exclude pills. The exclude control is gone entirely:
// Claude now decides which slides carry the logo; `position` is only a
// hint for WHERE it lands when it does.
//
// Layout: a flex-1 compact logo control (empty dropzone OR a picked
// preview row showing ONLY the white-flattened logo — sized to fill the
// row height — plus a remove button) on the reading edge, and the compact
// PositionDropdown pill at the other end — both at the same ~44 px height
// so the row reads as one band.
//
// SVG-only, same as LogoUploadSlot. White-flatten the preview for the
// dark glass chrome (preview only — saved bytes untouched).

import { useEffect, useRef, useState } from "react";
import { PositionDropdown, type CornerPosition } from "@/components/create/controls";

// Match the font dropzone / combobox height (44 px) so the logo row and
// the font selector above it read as one consistent column of inputs.
const ROW_H = 44;

export function LogoRow({
  file,
  previewUrl = null,
  position,
  onSelect,
  onRemove,
  onPosition,
  disabled = false,
}: {
  file: File | null;
  // Remote logo (signed URL) when hydrated from a saved brand kit.
  previewUrl?: string | null;
  position: CornerPosition;
  onSelect: (file: File) => void;
  onRemove: () => void;
  onPosition: (p: CornerPosition) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Blob-URL lifecycle for the local file preview (revoke on change /
  // unmount), mirroring LogoUploadSlot.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const liveUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (file === lastFileRef.current) return;
    lastFileRef.current = file;
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      const next = file ? URL.createObjectURL(file) : null;
      liveUrlRef.current = next;
      return next;
    });
  }, [file]);
  useEffect(
    () => () => {
      if (liveUrlRef.current) URL.revokeObjectURL(liveUrlRef.current);
    },
    [],
  );

  const activeUrl = objectUrl ?? previewUrl ?? null;

  const acceptSvg = (dropped: File | undefined) => {
    if (!dropped) return;
    if (!/\.svg$/i.test(dropped.name) && dropped.type !== "image/svg+xml") return;
    onSelect(dropped);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          const f = event.target.files?.[0];
          if (f) onSelect(f);
          event.currentTarget.value = "";
        }}
      />

      {activeUrl ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5 bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
          style={{ height: ROW_H }}
        >
          {/* Logo only — no filename label. Fills the row height (object-
              contain keeps the aspect ratio); max-w caps very wide marks so
              the remove button stays reachable. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeUrl}
            alt="معاينة الشعار"
            className="h-full max-w-[75%] shrink-0 object-contain object-right [filter:brightness(0)_invert(1)]"
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label="إزالة الشعار"
            className="ms-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
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
            acceptSvg(event.dataTransfer.files?.[0]);
          }}
          className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-dashed bg-black/20 px-2.5 transition-colors ${
            dragging
              ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
              : "border-white/15 hover:border-white/30"
          }`}
          style={{ height: ROW_H }}
        >
          <span
            className="material-symbols-outlined text-white/70"
            style={{ fontSize: 16 }}
          >
            image
          </span>
          <span className="text-xs font-semibold text-white">شعار SVG</span>
        </button>
      )}

      <PositionDropdown
        value={position}
        onChange={onPosition}
        disabled={disabled || !activeUrl}
      />
    </div>
  );
}
