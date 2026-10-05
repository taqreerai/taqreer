"use client";

// LogoRow — logo upload + preview (2026-06-02). Just the SVG dropzone now:
// the position picker was removed entirely — Claude decides WHERE the logo
// sits (chrome-locked across the deck), the same way it now owns pagination
// + the persistent footer. The exclude control is gone too; Claude decides
// which slides carry the logo. White-flatten the preview for the dark glass
// chrome (preview only — saved bytes untouched). SVG-only.

import { FREE_PLAN_FEATURE_LOCKS } from "@/lib/free-trial";
import { useEffect, useRef, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { LockedLogoSlot } from "@/components/brand/LogoUploadSlot";

// Logo dropzone / preview sizing. flex-1 + min-h lets the zone GROW to
// absorb any extra height the parent card hands down (e.g. /create's brand
// card, where the logo section is flex-1) while never shrinking below the
// visual-direction dropzone's 80 px. Where the parent doesn't grow it (the
// other flows), it just sits at the 80 px floor.
const ZONE_H = "min-h-20 flex-1";
// Compact (the /create Design step, 2026-10-02): a shorter fixed zone.
const ZONE_H_COMPACT = "h-14";

export function LogoRow({
  file,
  previewUrl = null,
  onSelect,
  onRemove,
  compact = false,
}: {
  compact?: boolean;
  file: File | null;
  // Remote logo (signed URL) when hydrated from a saved brand kit.
  previewUrl?: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const dict = useDict();
  const zoneH = compact ? ZONE_H_COMPACT : ZONE_H;
  // Logo upload is a paid feature (2026-10-02): free (non-admin) users get the
  // crowned locked slot. The server drops a free user's logo regardless
  // (app/api/projects/route.ts); this keeps the UI from offering it.
  const credits = useCreditBalance();
  const logoLocked =
    FREE_PLAN_FEATURE_LOCKS && !!credits && !credits.isAdmin && credits.plan === "free";
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Blob-URL lifecycle for the local file preview (revoke on change / unmount).
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

  if (logoLocked) {
    return (
      <div className={compact ? "h-14" : "h-20"}>
        <LockedLogoSlot compact fillHeight />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
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
          className={`relative flex w-full items-center justify-center rounded-xl border bg-[var(--tq-surface)] border-[var(--tq-border-hairline)] px-3 ${zoneH}`}
        >
          {/* Logo only — no filename label. object-contain keeps the aspect
              ratio; max-h fills the zone, max-w caps very wide marks. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeUrl}
            alt={dict.flows.brand.logoPreview}
            className="max-h-[80%] max-w-[80%] object-contain logo-monochrome"
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={dict.flows.brand.removeLogo}
            className="absolute end-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-foreground/70 transition-colors hover:bg-black/60 hover:text-foreground"
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
          className={`flex w-full items-center justify-center rounded-xl border border-dashed bg-overlay-soft transition-colors ${
            compact ? "gap-3 px-3" : "flex-col gap-1"
          } ${zoneH} ${
            dragging
              ? "border-[var(--tq-violet)]/60 bg-[var(--tq-violet)]/10"
              : "border-foreground/15 hover:border-foreground/30"
          }`}
        >
          {/* Compact (h-14): icon tile beside the two lines, so the stack
              never overflows the zone. Full size keeps the centred stack. */}
          <span
            className={`material-symbols-outlined text-foreground/70 ${
              compact
                ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tq-overlay-soft)]"
                : ""
            }`}
            style={{ fontSize: 20 }}
          >
            image
          </span>
          <span className={`flex flex-col ${compact ? "items-start" : "items-center gap-1"}`}>
            <span className="text-xs font-semibold leading-4 text-foreground">{dict.flows.brand.svgLogo}</span>
            <span className={`text-[10px] leading-4 text-foreground/40 ${compact ? "mt-0.5" : ""}`}>{dict.flows.brand.svgOnly}</span>
          </span>
        </button>
      )}
    </div>
  );
}
