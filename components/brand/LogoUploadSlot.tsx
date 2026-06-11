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
import { useDict } from "@/components/i18n/LocaleProvider";

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
  // Empty-state label override — defaults to the localized "SVG logo only"
  // (dict.flows.brand.svgLogoOnly) to match the chrome on every flow. Callers
  // can pass an empty string or a flow-specific copy without rewriting the
  // primitive.
  emptyLabel,
  // Optional remote preview URL — when set AND no `file` is picked,
  // render the picked-state preview using this URL instead of the
  // empty dropzone. Used by the four landing flows when hydrating
  // from a saved brand kit: the logo lives in storage already, so
  // the user shouldn't have to re-upload it. `onRemove` still
  // clears the parent state when the user wants to swap it out.
  previewUrl = null,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  compact?: boolean;
  fillHeight?: boolean;
  emptyLabel?: string;
  previewUrl?: string | null;
}) {
  const dict = useDict();
  const resolvedEmptyLabel = emptyLabel ?? dict.flows.brand.svgLogoOnly;
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
  // Mirror of the currently-live blob URL, written from inside the
  // sync effect via a functional setter. Used by the unmount cleanup
  // below — the previous version captured `objectUrl` from the
  // initial render via empty-deps closure, which meant the LAST
  // created URL could survive unmount (the closure still pointed at
  // the URL from render-0 even though the current state had moved
  // on). The ref always carries the latest value because it's
  // mutated synchronously inside the sync effect. CR #3 (PR #39).
  const liveObjectUrlRef = useRef<string | null>(null);

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
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        liveObjectUrlRef.current = null;
        return null;
      });
      return;
    }

    const url = URL.createObjectURL(file);
    // Same shape — external file changed, sync the URL cache. See
    // comment above for the lint-suppression rationale.
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      liveObjectUrlRef.current = url;
      return url;
    });
  }, [file]);

  useEffect(() => {
    // Final cleanup on unmount — revoke whatever URL is still live.
    // Reads from `liveObjectUrlRef` (mutated synchronously inside the
    // sync effect) instead of the closed-over `objectUrl` so the
    // cleanup always sees the latest URL, not the value from initial
    // render. CR #3 (PR #39).
    return () => {
      if (liveObjectUrlRef.current) {
        URL.revokeObjectURL(liveObjectUrlRef.current);
        liveObjectUrlRef.current = null;
      }
    };
  }, []);

  // Pick the active preview URL: the local blob takes precedence
  // when the user has just picked a file; otherwise we fall back to
  // the optional remote `previewUrl` (e.g. logo signed URL from a
  // saved brand kit). Falsey on both → render the empty dropzone.
  const activePreviewUrl = objectUrl ?? previewUrl ?? null;

  // Empty state → exactly the dropzone every flow used before this
  // primitive landed. The `compact` + `fillHeight` props forward
  // so /enhance keeps its tighter 72 px stack, /mimic stretches to
  // its sibling's height, and /create + /datasheet get the standard
  // 100 px slot. No layout shift, no visual change.
  if (!activePreviewUrl) {
    return (
      <CompactUploadZone
        label={resolvedEmptyLabel}
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
  const containerClass = `relative flex w-full items-center justify-center rounded-xl border border-dashed border-foreground/15 bg-overlay-soft px-3${
    fillHeight ? " h-full" : ""
  }`;
  return (
    <div className={containerClass} style={containerStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={activePreviewUrl}
        alt={dict.flows.brand.logoPreview}
        // `brightness(0) invert(1)` flattens any color (mono OR
        // polychrome) to solid white. See file header for the
        // rationale — preview only, saved bytes untouched. max-w pins
        // wide logos so they don't crowd the close button.
        className="max-w-[140px] object-contain logo-monochrome"
        style={{ maxHeight: logoMaxHeightPx }}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label={dict.flows.brand.removeLogo}
        // Top-start positioning (visual top-right in RTL, top-left
        // in LTR) — same corner /create's old logo card used for
        // the close button. start-2/top-2 = ~8 px inset from the
        // border so it sits clear of the dashed edge.
        className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          close
        </span>
      </button>
    </div>
  );
}
