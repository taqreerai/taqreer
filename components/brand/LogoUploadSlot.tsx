"use client";

// LogoUploadSlot — the standard logo-upload primitive for /create,
// /enhance, /mimic, /datasheet (Phase 17.E follow-up).
//
// Two states, ONE outer height so the surrounding card never reflows
// between empty → picked:
//
//   • Empty   → `CompactUploadZone` with the standard "شعار SVG فقط"
//                empty-label + dashed border.
//   • Picked  → preview pane with a WHITE-FILTERED render of the SVG
//                (any color → solid white via `brightness(0) invert(1)`),
//                close button in the corner to clear, dashed border
//                matching the dropzone so the visual rhythm doesn't
//                shift.
//
// Why white-flatten the preview?
// The brand-page chrome is a dark glass surface. A black wordmark or
// dark monogram would disappear into the surface; a colored mark might
// pick up the surface tint and read off-brand. Flattening to pure
// white via CSS filter gives a clean silhouette readable on every
// supported theme. PREVIEW ONLY — the saved SVG bytes are untouched,
// so the actual deck's per-slide contrast logic still picks the right
// fill per slide background.
//
// Polychrome logos flatten to white here too. That's the trade-off:
// the preview shows a silhouette instead of the real colors. The user
// already saw the file in their file picker; the preview's job is to
// confirm "the upload worked, here's what shape it is", not to
// faithfully reproduce brand colors.
//
// Height contract: container pins at 100 px in both states (matches
// CompactUploadZone's default minHeight). The card row this slot
// lives in stays exactly the same height before and after upload.

import { useEffect, useRef, useState } from "react";
import { CompactUploadZone } from "@/components/brand/CompactUploadZone";

// Outer heights pinned to CompactUploadZone's two modes:
//   • default → 100 px (matches CompactUploadZone's stacked default)
//   • compact → 72 px (matches `compact={true}` on CompactUploadZone)
// /enhance's logo card uses `compact` to share the brand card with
// fonts above it; /create + /mimic + /datasheet use the default
// taller slot. Whichever the caller picks, BOTH the empty + picked
// states render at the same outer height — that's the whole point
// of this primitive: the card row never grows on first upload.
const SLOT_HEIGHT_DEFAULT_PX = 100;
const SLOT_HEIGHT_COMPACT_PX = 72;

export function LogoUploadSlot({
  file,
  onSelect,
  onRemove,
  // When true, the slot pins at 72 px instead of 100 px to match the
  // surrounding card chrome. Mirrors the `compact` prop on
  // CompactUploadZone. /enhance is the only caller using this today.
  compact = false,
  // When true, the slot stretches to fill its parent's height
  // (`h-full`) instead of using the fixed compact/default px values.
  // Used by /mimic where the logo sits beside a taller sibling
  // (stacked ratio tiles) and would leave an awkward gap below it
  // at 72/100 px. Mirrors the `fillHeight` prop on
  // CompactUploadZone. When true, `compact` is ignored — the parent
  // controls the height.
  fillHeight = false,
  // Empty-state label override — defaults to "شعار SVG فقط" to match
  // the Arabic-first chrome on every flow. Callers can pass an empty
  // string or a flow-specific copy without rewriting the primitive.
  emptyLabel = "شعار SVG فقط",
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  compact?: boolean;
  fillHeight?: boolean;
  emptyLabel?: string;
}) {
  const slotHeightPx = compact ? SLOT_HEIGHT_COMPACT_PX : SLOT_HEIGHT_DEFAULT_PX;
  // Logo image's max height — leaves ~12 px breathing room above +
  // below inside the compact 72 px slot, ~20 px in the default 100 px.
  // For fillHeight callers the image caps at the compact value too
  // (parent height is typically ~96-120 px when stretched).
  const logoMaxHeightPx = compact || fillHeight ? 48 : 60;
  // Object URL lifecycle — create on file pick, revoke when the file
  // changes OR the component unmounts. Without revoke we leak blob:
  // URLs every time the user replaces the logo (the browser holds
  // them until tab close). useRef + useEffect cleanup is the
  // canonical React shape for this pattern.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);

  useEffect(() => {
    // Skip the setState dance when the file ref is unchanged — React
    // would re-run this effect on every parent re-render otherwise
    // and we'd churn blob URLs needlessly.
    if (file === lastFileRef.current) return;
    lastFileRef.current = file;

    if (!file) {
      // setState inside an effect is OK here — we're syncing the
      // blob-URL cache to an EXTERNAL resource (the File object the
      // parent owns) which is exactly the canonical "subscribe to
      // external state" shape the lint rule allows. The functional
      // updater also revokes the prior URL so the cleanup is atomic.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const url = URL.createObjectURL(file);
    // Same shape — external file changed, sync the URL cache. See
    // comment above for the lint-suppression rationale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [file]);

  useEffect(() => {
    // Final cleanup on unmount — revoke whatever URL is still live.
    return () => {
      if (lastFileRef.current && objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // objectUrl intentionally NOT in deps — we only want this to
    // fire on unmount, not on every URL swap (which the effect above
    // handles).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Empty state → exactly the dropzone every flow used before this
  // primitive landed. The `compact` + `fillHeight` props forward
  // so /enhance keeps its tighter 72 px stack, /mimic stretches to
  // its sibling's height, and /create + /datasheet get the standard
  // 100 px slot. No layout shift, no visual change.
  if (!file || !objectUrl) {
    return (
      <CompactUploadZone
        label={emptyLabel}
        accept=".svg,image/svg+xml"
        file={null}
        onSelect={onSelect}
        compact={compact}
        fillHeight={fillHeight}
        hideFilename
        muted
      />
    );
  }

  // Picked state → preview pane at the SAME outer height. Border
  // style matches CompactUploadZone (dashed, white/15) so the
  // transition reads as a state swap, not a layout swap. Logo image
  // gets max-w + max-h so wide/tall logos both fit cleanly inside
  // the 100 px container with breathing room.
  // Picked state — fixed-height by default, `h-full` when fillHeight
  // is on. Both render the same border + bg as CompactUploadZone so
  // the transition reads as a state swap, not a layout swap.
  const containerStyle: React.CSSProperties = fillHeight
    ? {}
    : { minHeight: slotHeightPx, height: slotHeightPx };
  const containerClass = `relative flex w-full items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 px-3${
    fillHeight ? " h-full" : ""
  }`;
  return (
    <div className={containerClass} style={containerStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={objectUrl}
        alt="معاينة الشعار"
        // `brightness(0) invert(1)` flattens any color (mono OR
        // polychrome) to solid white. See file header for the
        // rationale — preview only, saved bytes untouched. max-w pins
        // wide logos so they don't crowd the close button.
        className="max-w-[140px] object-contain [filter:brightness(0)_invert(1)]"
        style={{ maxHeight: logoMaxHeightPx }}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label="إزالة الشعار"
        // Top-start positioning (visual top-right in RTL, top-left
        // in LTR) — same corner /create's old logo card used for
        // the close button. start-2/top-2 = ~8 px inset from the
        // border so it sits clear of the dashed edge.
        className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          close
        </span>
      </button>
    </div>
  );
}
