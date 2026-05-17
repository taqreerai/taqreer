"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import { Pill } from "@/components/create/controls";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";
import type { CornerPosition } from "@/components/create/controls";

// Brand page (step 2 of 4) — colours, fonts (Google + upload), and
// LOGO UPLOAD (just the file; placement + excludes moved to
// `/create/output` step 3). Output-side fields (slide size, slide
// count, generation rules, logo placement) were stripped on
// 2026-05-18 per `context/plan-create-flow.md`.

type PaletteMode = "manual" | "screenshot";
type FontMode = "upload" | "google";
type FontTarget = "heading" | "body";

type FontSlotState = {
  mode: FontMode;
  // Upload mode
  uploadFile: File | null;
  uploadName: string | null;
  uploadStorageUrl: string | null;
  uploadFamily: string;
  // Google Fonts mode
  googleFamily: string | null;
};

// Shape of a saved BrandKit's font slot (what POST /api/brand-kits stores
// + what GET returns). Used by hydrateFromBrandKit to rebuild the page's
// FontSlotState. Both modes may have a `name` field but the meaningful
// data lives in either googleFamily (mode=google) or storageUrl
// (mode=upload).
type SavedFontSlot = {
  mode?: "google" | "upload";
  name?: string | null;
  googleFamily?: string | null;
  url?: string | null;
  storageUrl?: string | null;
  family?: string | null;
};

type SavedLogo = {
  // Bucket-relative PATH (private bucket; not loadable as <img src>).
  storageUrl?: string | null;
  // 1-year signed HTTPS URL added by /api/brand-kits GET for preview.
  // The path stays in storageUrl so brief submission can re-sign it.
  displayUrl?: string | null;
  previewDataUrl?: string | null;
  position?: CornerPosition;
  exclude?: ("cover" | "closing")[];
};

// Reconstruct a FontSlotState from a saved kit's slot data. Defaults to
// the upload mode with empty fields if neither mode's data is present.
function fontSlotFromSaved(saved: SavedFontSlot): FontSlotState {
  if (saved.mode === "google" || saved.googleFamily) {
    return {
      mode: "google",
      uploadFile: null,
      uploadName: null,
      uploadStorageUrl: null,
      uploadFamily: "",
      googleFamily: saved.googleFamily ?? saved.name ?? null,
    };
  }
  return {
    mode: "upload",
    uploadFile: null,
    uploadName: saved.name ?? null,
    uploadStorageUrl: saved.storageUrl ?? null,
    uploadFamily: saved.family ?? "",
    googleFamily: null,
  };
}

const DEFAULT_COLORS = ["#370BF4", "#E036B8", "#7D2DFF"];
const MIN_COLORS = 1;
const MAX_COLORS = 5;

// Curated list — Arabic-capable + popular Latin. Avoids the full Google Fonts
// API dance and lets us hardcode a known-good set that all support 400/700.
const GOOGLE_FONTS: { family: string; arabic: boolean }[] = [
  { family: "Cairo", arabic: true },
  { family: "Tajawal", arabic: true },
  { family: "Almarai", arabic: true },
  { family: "Noto Sans Arabic", arabic: true },
  { family: "Amiri", arabic: true },
  { family: "Reem Kufi", arabic: true },
  { family: "Markazi Text", arabic: true },
  { family: "IBM Plex Sans Arabic", arabic: true },
  { family: "Inter", arabic: false },
  { family: "Poppins", arabic: false },
  { family: "Roboto", arabic: false },
  { family: "Open Sans", arabic: false },
  { family: "Lato", arabic: false },
  { family: "Montserrat", arabic: false },
  { family: "Space Grotesk", arabic: false },
  { family: "DM Sans", arabic: false },
];

function googleFontUrl(family: string): string {
  const encoded = family.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`;
}

const DESIGN_STYLE_OPTIONS = ["إبداعي", "بسيط", "احترافي", "مرح", "صحفي", "جريء", "كلاسيكي"];

type StoredContent = {
  type: "file" | "text";
  fileName?: string;
  fileSize?: number;
  storageUrl?: string;
  text?: string;
};
type UploadedAsset = {
  name: string;
  storageUrl: string;
  size?: number;
  type?: string;
} | null;

function selectedClass(isSelected: boolean) {
  return isSelected
    ? "border-2 border-[#370BF4] bg-[#370BF4]/10"
    : "border border-[rgba(42,36,59,0.8)]";
}

async function uploadAsset(bucket: "brand-assets", folder: string, file: File | null): Promise<UploadedAsset> {
  if (!file) return null;

  const formData = new FormData();
  formData.append("bucket", bucket);
  formData.append("folder", folder);
  formData.append("file", file);

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Upload failed");
  }

  return (await response.json()) as UploadedAsset;
}

function readFileAsDataUrl(file: File | null) {
  if (!file) return Promise.resolve(null);

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function CompactUploadZone({
  label,
  accept,
  file,
  onSelect,
}: {
  label: string;
  accept: string;
  file: File | null;
  onSelect: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

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
        // Tall dropzone for logo + colour-from-screenshot uploads —
        // these are user-attention features (one-tap of the brand
        // identity), so they keep room to breathe. White/15 dashed
        // border matches the step 1 + font upload vocabulary; glass-
        // circle icon hierarchy mirrors رفع ملفات السياق.
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/20 p-4 text-center transition-colors hover:border-white/30"
        style={{ minHeight: 100 }}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "rgba(255, 255, 255, var(--glass-opacity))" }}
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

function FontUploadSlot({
  label,
  file,
  family,
  sampleText,
  sampleSizeClass,
  onSelect,
  onRemove,
}: {
  label: string;
  file: File | null;
  family: string;
  sampleText: string;
  sampleSizeClass: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

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
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          style={{
            background: "rgba(255, 255, 255, var(--glass-opacity))",
            borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          }}
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
            aria-label={`إزالة ${label}`}
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
          // Compact dropzone — horizontal layout (icon + label inline)
          // so the slot stays the same height as the Google-fonts
          // combobox input. Same dashed white/15 surface as step 1
          // (just shorter), so the design vocabulary stays consistent.
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/20 px-3 py-2 text-center transition-colors hover:border-white/30"
          style={{ height: 44 }}
        >
          <span
            className="material-symbols-outlined text-white/70"
            style={{ fontSize: 18 }}
          >
            font_download
          </span>
          <span className="text-xs font-semibold text-white">{label}</span>
          <span className="text-[10px] text-white/40">— WOFF / TTF / OTF</span>
        </button>
      )}
      <p className={`${sampleSizeClass} text-right text-white${family ? ` ${family}` : ""}`}>
        {sampleText}
      </p>
    </div>
  );
}

// Searchable Google-Fonts combobox.
//
// Input + chevron in a single field. Click the field (or the chevron)
// to open a styled popup of all available families; type to filter the
// list to matches. Selecting an item closes the popup and writes the
// family back via `onSelect`. The popup keeps the same row styling as
// the previous always-visible list (active row = gradient pill, each
// row previews its own family on the trailing "Aa" chip).
//
// Native `<select>` was rejected because its OS popup doesn't honour
// the glass chrome — this gives us full control over the dropdown
// surface while still feeling like a standard searchable field.
function GoogleFontSlot({
  selected,
  sampleText,
  sampleSizeClass,
  onSelect,
}: {
  label: string;
  selected: string | null;
  sampleText: string;
  sampleSizeClass: string;
  onSelect: (family: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-click closes the popup. mousedown (not click) so the
  // popup dismisses on focus-shift to another element, not after the
  // bubble — keeps tab-out behaviour clean.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const filtered = query.trim()
    ? GOOGLE_FONTS.filter((font) =>
        font.family.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : GOOGLE_FONTS;

  const inputValue = open ? query : selected ?? "";
  const showPlaceholder = !inputValue;

  return (
    <div ref={wrapperRef} className="relative space-y-3">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          placeholder={showPlaceholder ? "اكتب أو اختر خط Google..." : ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          // Inline padding + height pin so the combobox matches the
          // FontUploadSlot button at 44 px EXACTLY — switching between
          // "رفع ملف" and "Google Fonts" produces zero card height
          // change. Padding override also makes room for the chevron
          // on the start edge (RTL → left).
          className="input-dark text-right text-sm"
          style={{ height: 44, padding: "0 16px 0 40px" }}
        />
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            if (!open) {
              setQuery("");
              inputRef.current?.focus();
            }
          }}
          aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 transition-colors hover:text-white"
        >
          <span
            className={`material-symbols-outlined block transition-transform ${
              open ? "rotate-180" : ""
            }`}
            style={{ fontSize: 18 }}
          >
            expand_more
          </span>
        </button>
      </div>
      {open ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-glass"
          // `top: 100%` would stack on the sample line; using `top: 44`
          // (input height) anchors the popup directly under the field.
          // 240 px max-h fits ~6 rows; the rest scrolls.
          style={{
            top: 44,
            maxHeight: 240,
            background: "rgba(15, 11, 30, 0.92)",
            borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
          }}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-white/40">لا توجد نتائج</p>
          ) : (
            filtered.map((font) => {
              const isActive = selected === font.family;
              return (
                <button
                  key={font.family}
                  type="button"
                  onClick={() => {
                    onSelect(isActive ? null : font.family);
                    setOpen(false);
                    setQuery("");
                  }}
                  // Active row uses the same vocabulary as the Pill
                  // primitive: white-stroke + white text on the glass
                  // surface (no purple gradient). Idle row is muted
                  // text with a faint hover lift.
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "text-white"
                      : "border-transparent text-white/70 hover:bg-white/5"
                  }`}
                  style={
                    isActive
                      ? {
                          borderColor: "rgba(255, 255, 255, 1)",
                          background:
                            "rgba(255, 255, 255, var(--glass-opacity))",
                        }
                      : undefined
                  }
                >
                  <span className="flex items-center gap-2">
                    <span>{font.family}</span>
                    <span
                      className={`text-[10px] ${isActive ? "text-white/80" : "text-white/40"}`}
                    >
                      {font.arabic ? "عربي + لاتيني" : "لاتيني"}
                    </span>
                  </span>
                  <span
                    className="text-base"
                    style={{
                      fontFamily: `"${font.family}", system-ui, sans-serif`,
                    }}
                  >
                    Aa
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
      <p
        className={`${sampleSizeClass} text-right text-white`}
        style={selected ? { fontFamily: `"${selected}", system-ui, sans-serif` } : undefined}
      >
        {sampleText}
      </p>
    </div>
  );
}

// (Pill, PositionPicker, Toggle moved to `components/create/controls.tsx`
// and are now imported above. The remaining inline component below —
// BrandColorRow — is brand-page-specific and stays here.)

function BrandColorRow({
  value,
  index,
  removable,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  removable: boolean;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  // Swatch → opens the custom ColorPickerPopover (replaces the OS
  // `<input type="color">` so the picker honours our glass chrome).
  // Popover always centers on the swatch — `align` is omitted so
  // the component falls back to its "center" default. Edge swatches
  // may extend the popover past the card boundary; that's fine,
  // overlapping siblings is normal popover behaviour.
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-12 w-full rounded-xl border border-white/15 transition-shadow hover:shadow-lg"
        style={{ backgroundColor: value }}
        aria-label={`اللون ${index + 1}`}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label="إزالة اللون"
        // Overlay × in the inline-start corner (RTL → top-right).
        // White-on-black chip so it's visible on any swatch colour.
        // Always rendered; disabled at MIN so the column doesn't
        // jump when the user is at the floor.
        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-0"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
          close
        </span>
      </button>
      <ColorPickerPopover
        open={pickerOpen}
        value={value}
        onChange={onChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

// Read the previously-saved brand blob from sessionStorage. Runs in each
// useState lazy initializer below; safe on the server (returns null) and only
// fires once per mount per call site.
type StoredBrandShape = {
  colors?: unknown;
  logo?: {
    name?: string;
    storageUrl?: string;
    previewDataUrl?: string | null;
  } | null;
  // Output-side fields (slideSize, slideCount, rules) used to live
  // in this blob too; they moved to `taqreer:create:output` in the
  // 4-step refactor (2026-05-18). Keep the legacy keys readable in
  // case the user is mid-flow with old session data — `/create/output`
  // migrates them on its own hydrate.
};
function readStoredBrand(): StoredBrandShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("taqreer:create:brand");
    return raw ? (JSON.parse(raw) as StoredBrandShape) : null;
  } catch {
    return null;
  }
}

export default function CreateBrandPage() {
  const router = useRouter();
  const [content, setContent] = useState<StoredContent | null>(null);

  // ─── Right column state ─────────────────────────────────────────────────
  // Brand colors — 3 default slots, expandable up to 5. No background/text
  // color inputs; Claude picks the surface colors based on contrast.
  //
  // Initial value MUST match server render exactly to avoid hydration
  // mismatches — sessionStorage is client-only so the previous
  // `useState(() => readStoredBrand()?.colors)` pattern silently
  // changed value on the first client render. Default seed renders
  // on the server; the `useLayoutEffect` below restores the user's
  // saved colours before paint (no flash).
  const [colors, setColors] = useState<string[]>(DEFAULT_COLORS);
  // Restore colours from sessionStorage post-hydration. useLayoutEffect
  // (not useEffect) so the swap happens BEFORE the browser paints —
  // user never sees the default-palette flash if they're returning
  // from a later step with their picked palette in storage.
  useLayoutEffect(() => {
    const s = readStoredBrand();
    if (s && Array.isArray(s.colors)) {
      const valid = (s.colors as unknown[]).filter(
        (c): c is string => typeof c === "string",
      );
      if (valid.length >= MIN_COLORS) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setColors(valid.slice(0, MAX_COLORS));
      }
    }
  }, []);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("manual");
  const [paletteScreenshot, setPaletteScreenshot] = useState<File | null>(null);

  // Fonts: each slot has a mode (upload | google) and corresponding state.
  // The upload File object can't be serialised back from sessionStorage, so
  // these always start blank; the user re-picks if they came back.
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>({
    mode: "upload",
    uploadFile: null,
    uploadName: null,
    uploadStorageUrl: null,
    uploadFamily: "",
    googleFamily: null,
  });
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>({
    mode: "upload",
    uploadFile: null,
    uploadName: null,
    uploadStorageUrl: null,
    uploadFamily: "",
    googleFamily: null,
  });

  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  // SVG-only logo policy (2026-05-15). Raster formats (PNG/JPG) are rejected
  // because we can't recolor them per slide for contrast — see context.md
  // Phase 9. Polychrome SVGs are accepted but can't be recolored either;
  // Claude is told in the prompt to design backgrounds compatible with
  // the logo's colors when it's not a monochrome SVG.
  const acceptLogo = (next: File) => {
    const isSvgMime = next.type === "image/svg+xml";
    const isSvgExt = next.name.toLowerCase().endsWith(".svg");
    if (!isSvgMime && !isSvgExt) {
      setLogoError("الشعار يجب أن يكون بصيغة SVG فقط — لضمان جودة الألوان والتباين على كل شريحة.");
      return;
    }
    setLogoError(null);
    setLogo(next);
  };

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Save-as-brand state machine: idle → saving → saved. The "saved" state
  // persists across forward/back navigation via a sessionStorage snapshot
  // of the saveable brand data (colours + font names). On mount we compare
  // the current state to the snapshot; an edit that breaks the match
  // resets to idle so the user can save again.
  const [saveBrandState, setSaveBrandState] = useState<"idle" | "saving" | "saved">("idle");
  // SSR / hydration guard. Many useState initialisers above lazy-read
  // sessionStorage; on SSR window is undefined so they return defaults,
  // on client they return stored values — different markup → hydration
  // mismatch. We gate the post-hydration-only conditional renders on
  // `mounted` so the first client render mirrors the SSR output, and
  // the populated UI swaps in on the next paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Logo metadata loaded from a BrandKit. When the user hasn't picked a
  // new logo file but a saved kit had one, we still want to propagate the
  // existing storage URL to the summary page (and to a re-save) so Claude
  // sees the logo on slides. `logo` (File) stays null because we don't
  // have the bytes; this holds the equivalent storage-side reference.
  const [loadedLogoMeta, setLoadedLogoMeta] = useState<{
    storageUrl: string;
    name: string;
    previewDataUrl: string | null;
  } | null>(null);

  // Restore logo from sessionStorage post-hydration. The original
  // File object can't survive a navigation round-trip, but the
  // previous "Next" click already uploaded the file and wrote
  // { name, storageUrl, previewDataUrl } into the brand blob.
  // useLayoutEffect (not useEffect) so the preview chip is in place
  // before the user sees the page — no flash of empty upload zone
  // when they hit "السابق" from /create/output.
  useLayoutEffect(() => {
    const s = readStoredBrand();
    if (s?.logo?.storageUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadedLogoMeta({
        storageUrl: s.logo.storageUrl,
        name: s.logo.name ?? "logo",
        previewDataUrl: s.logo.previewDataUrl ?? null,
      });
      if (s.logo.previewDataUrl) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLogoPreview(s.logo.previewDataUrl);
      }
    }
  }, []);

  // Constants + helpers hoisted above hydrateFromBrandKit so they're
  // accessible (the original declarations sat farther down the component
  // and triggered the "accessed before declared" TDZ lint error).
  const BRAND_SAVED_SNAPSHOT_KEY = "taqreer:create:brand:savedSnapshot";
  const fontName = (slot: FontSlotState): string | null =>
    slot.mode === "google"
      ? slot.googleFamily ?? null
      : slot.uploadFamily || slot.uploadName || null;

  // Track injected @font-face <style> tags (upload mode) and <link> tags
  // (Google mode) so we can revoke / remove them cleanly across switches.
  const uploadStyleRef = useRef<Record<FontTarget, { style: HTMLStyleElement; url: string } | null>>({
    heading: null,
    body: null,
  });
  const googleLinkRef = useRef<Record<FontTarget, HTMLLinkElement | null>>({
    heading: null,
    body: null,
  });

  // Rehydrate brand-page state from a saved BrandKit row + side effects:
  //   - Inject Google font <link>s so the typography preview actually loads
  //     (state alone doesn't trigger the font; that's done in
  //     onSelectGoogleFont normally).
  //   - Stash logo storage metadata in `loadedLogoMeta` so handleNext /
  //     handleSaveAsBrand can pass the URL through even though we never
  //     reconstruct the original File from bytes.
  //   - Compute the fingerprint manually + write the saved-snapshot key,
  //     then flip the save button to "saved" so the UI reflects that the
  //     current state matches the persisted kit. Without this the button
  //     would stay "idle" on every fresh session.
  const hydrateFromBrandKit = (kit: {
    logo: string | null;
    colors: unknown;
    fonts: unknown;
    assetUrls: unknown;
  }) => {
    let nextColors: string[] | null = null;
    if (Array.isArray(kit.colors)) {
      const valid = (kit.colors as unknown[]).filter(
        (c): c is string => typeof c === "string",
      );
      if (valid.length >= MIN_COLORS) {
        nextColors = valid.slice(0, MAX_COLORS);
        setColors(nextColors);
      }
    }

    const fonts = kit.fonts as
      | { heading?: SavedFontSlot | null; body?: SavedFontSlot | null }
      | null;
    let nextHeading: FontSlotState | null = null;
    let nextBody: FontSlotState | null = null;
    // Inline the Google-font <link> injection (the proper helper
    // `injectGoogleFont` is defined later in the component; calling it
    // here would TDZ-error). We do the same thing the helper does: drop
    // any previous link for this target and append a fresh one.
    const injectGoogleLink = (family: string, target: FontTarget) => {
      const prevLink = googleLinkRef.current[target];
      if (prevLink && prevLink.parentNode) {
        prevLink.parentNode.removeChild(prevLink);
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = googleFontUrl(family);
      document.head.appendChild(link);
      googleLinkRef.current[target] = link;
    };
    if (fonts?.heading) {
      nextHeading = fontSlotFromSaved(fonts.heading);
      setHeadingFontSlot(nextHeading);
      if (nextHeading.mode === "google" && nextHeading.googleFamily) {
        injectGoogleLink(nextHeading.googleFamily, "heading");
      }
    }
    if (fonts?.body) {
      nextBody = fontSlotFromSaved(fonts.body);
      setBodyFontSlot(nextBody);
      if (nextBody.mode === "google" && nextBody.googleFamily) {
        injectGoogleLink(nextBody.googleFamily, "body");
      }
    }

    const assetUrls = kit.assetUrls as { logo?: SavedLogo | null } | null;
    const savedLogo = assetUrls?.logo;
    if (savedLogo?.storageUrl) {
      // Prefer the signed displayUrl for the <img> preview; fall back
      // through previewDataUrl (legacy kits saved with base64) to the
      // raw storageUrl as a last resort (will 404 on private buckets
      // — same broken-state as before this fix, no regression).
      setLogoPreview(
        savedLogo.displayUrl ||
          savedLogo.previewDataUrl ||
          savedLogo.storageUrl,
      );
      setLoadedLogoMeta({
        // Keep the PATH here so the brief submission can re-sign it.
        storageUrl: savedLogo.storageUrl,
        name: (savedLogo as { name?: string }).name ?? "logo",
        previewDataUrl: savedLogo.previewDataUrl ?? null,
      });
      // Logo position + excludes now live on /create/output; the
      // brand-page no longer reads or sets them.
    }

    // Compute the fingerprint over the values we just set and persist it
    // as the saved snapshot. Must be computed manually here (not via
    // brandFingerprint) because React state setters above are async and
    // brandFingerprint still reflects the pre-hydrate render.
    //
    // MUST mirror brandFingerprint's shape EXACTLY (line ~967 below) —
    // any field present there must be present here, or the saved
    // snapshot won't match the live fingerprint and the save button
    // will stay "idle" right after hydration ("asks to save again"
    // even though nothing changed).
    const headingName =
      nextHeading?.mode === "google"
        ? nextHeading.googleFamily
        : (nextHeading?.uploadFamily || nextHeading?.uploadName) ?? null;
    const bodyName =
      nextBody?.mode === "google"
        ? nextBody.googleFamily
        : (nextBody?.uploadFamily || nextBody?.uploadName) ?? null;
    const savedLogoForFingerprint = assetUrls?.logo ?? null;
    // Brand-page fingerprint covers ONLY brand-side data now:
    // colours, font names, and logo presence (by storageUrl). Logo
    // position + excludes live on /create/output, so they don't
    // affect whether the user has unsaved brand changes here.
    const fingerprint = JSON.stringify({
      colors: nextColors ?? colors,
      headingFont: headingName ?? fontName(headingFontSlot),
      bodyFont: bodyName ?? fontName(bodyFontSlot),
      logo: savedLogoForFingerprint?.storageUrl ?? null,
    });
    try {
      sessionStorage.setItem(BRAND_SAVED_SNAPSHOT_KEY, fingerprint);
    } catch {
      /* quota — best effort */
    }
    setSaveBrandState("saved");
  };

  // ─── Initial load ───────────────────────────────────────────────────────
  // Brand state restoration happens in the useState lazy initializers above;
  // this effect handles content navigation guard + auto-loading the most
  // recent saved BrandKit when there's no sessionStorage brand data (i.e.
  // user is starting a fresh create flow).
  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    if (!rawContent) {
      router.replace("/create/content");
      return;
    }
    setContent(JSON.parse(rawContent) as StoredContent);

    // Auto-load most recent BrandKit when sessionStorage brand is empty.
    // If the user came back here via "رجوع" from summary, the lazy
    // initializers already rehydrated state from sessionStorage; we don't
    // override that.
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");
    if (rawBrand) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/brand-kits");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          kits?: Array<{
            id: string;
            name: string;
            logo: string | null;
            colors: unknown;
            fonts: unknown;
            assetUrls: unknown;
          }>;
        };
        const kit = data.kits?.[0];
        if (!kit || cancelled) return;
        hydrateFromBrandKit(kit);
      } catch {
        /* offline / network — silently fall back to defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
    // hydrateFromBrandKit is component-scoped and we only want this
    // effect to fire on mount (driven by router).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Live preview for logo. When the user picks a fresh File via the
  // upload zone we build an Object URL. When `logo` is null we only
  // clear the preview if there's no `loadedLogoMeta` either — that
  // way a session-restored logo (no File, only previewDataUrl) keeps
  // its preview, but an explicit "Remove" (which nulls both `logo`
  // and `loadedLogoMeta`) still wipes the chip.
  // Live preview for a newly-picked logo File. We DON'T clear
  // `logoPreview` when `logo` is null — explicit removal already
  // clears it via the in-card "إزالة" button, and a session-restored
  // logo (no File, only previewDataUrl) needs the preview to survive
  // until the user removes it. The cleanup callback revokes the
  // object URL when the File is replaced or unmounted.
  useEffect(() => {
    if (!logo) return;
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  // ─── Font injection ─────────────────────────────────────────────────────
  // Replace any previously-injected resources for this target before injecting
  // a new one. Cleans the upload-style + Google-link both since the user could
  // be switching modes.
  const clearFontResources = (target: FontTarget) => {
    const prevStyle = uploadStyleRef.current[target];
    if (prevStyle) {
      prevStyle.style.remove();
      URL.revokeObjectURL(prevStyle.url);
      uploadStyleRef.current[target] = null;
    }
    const prevLink = googleLinkRef.current[target];
    if (prevLink) {
      prevLink.remove();
      googleLinkRef.current[target] = null;
    }
  };

  const injectUploadedFont = (file: File, target: FontTarget): string => {
    clearFontResources(target);
    const url = URL.createObjectURL(file);
    const family = `Taqreer-${target}-${crypto.randomUUID()}`;
    const style = document.createElement("style");
    style.textContent = `@font-face { font-family: "${family}"; src: url("${url}"); } .${family} { font-family: "${family}"; }`;
    document.head.appendChild(style);
    uploadStyleRef.current[target] = { style, url };
    return family;
  };

  const injectGoogleFont = (family: string, target: FontTarget) => {
    clearFontResources(target);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = googleFontUrl(family);
    document.head.appendChild(link);
    googleLinkRef.current[target] = link;
  };

  // Cleanup on unmount.
  useEffect(() => {
    const uploads = uploadStyleRef.current;
    const links = googleLinkRef.current;
    return () => {
      for (const t of ["heading", "body"] as const) {
        const u = uploads[t];
        if (u) {
          u.style.remove();
          URL.revokeObjectURL(u.url);
          uploads[t] = null;
        }
        const l = links[t];
        if (l) {
          l.remove();
          links[t] = null;
        }
      }
    };
  }, []);

  // ─── Color slot helpers ─────────────────────────────────────────────────
  const updateColor = (index: number, next: string) => {
    setColors((current) => current.map((c, i) => (i === index ? next : c)));
  };
  const addColor = () => {
    setColors((current) => (current.length >= MAX_COLORS ? current : [...current, "#FFFFFF"]));
  };
  const removeColor = (index: number) => {
    setColors((current) => (current.length <= MIN_COLORS ? current : current.filter((_, i) => i !== index)));
  };

  // ─── Font slot handlers ─────────────────────────────────────────────────
  const setFontMode = (target: FontTarget, mode: FontMode) => {
    clearFontResources(target);
    const reset = (s: FontSlotState): FontSlotState => ({
      ...s,
      mode,
      uploadFile: null,
      uploadName: null,
      uploadStorageUrl: null,
      uploadFamily: "",
      googleFamily: null,
    });
    if (target === "heading") setHeadingFontSlot(reset);
    else setBodyFontSlot(reset);
  };

  const onUploadFont = (target: FontTarget, file: File) => {
    const family = injectUploadedFont(file, target);
    const update = (s: FontSlotState): FontSlotState => ({
      ...s,
      mode: "upload",
      uploadFile: file,
      uploadName: file.name,
      uploadFamily: family,
    });
    if (target === "heading") setHeadingFontSlot(update);
    else setBodyFontSlot(update);
  };

  const onRemoveUploadFont = (target: FontTarget) => {
    clearFontResources(target);
    const update = (s: FontSlotState): FontSlotState => ({
      ...s,
      uploadFile: null,
      uploadName: null,
      uploadStorageUrl: null,
      uploadFamily: "",
    });
    if (target === "heading") setHeadingFontSlot(update);
    else setBodyFontSlot(update);
  };

  const onSelectGoogleFont = (target: FontTarget, family: string | null) => {
    if (family) injectGoogleFont(family, target);
    else clearFontResources(target);
    const update = (s: FontSlotState): FontSlotState => ({ ...s, googleFamily: family });
    if (target === "heading") setHeadingFontSlot(update);
    else setBodyFontSlot(update);
  };

  // Fingerprint over the SAVEABLE brand data — colours, font names,
  // and logo identity (File or kit storageUrl). MUST stay in sync
  // with the hydrate-fingerprint above (line ~628); see
  // `feedback_*` memory if you ever see the Save button stuck idle
  // after a clean hydration. Logo position + excludes intentionally
  // omitted — those live on the new `/create/output` step.
  const logoFingerprint = logo
    ? `${logo.name}:${logo.size}:${logo.lastModified}`
    : (loadedLogoMeta?.storageUrl ?? null);
  const brandFingerprint = JSON.stringify({
    colors,
    headingFont: fontName(headingFontSlot),
    bodyFont: fontName(bodyFontSlot),
    logo: logoFingerprint,
  });

  // On mount: if a snapshot from a previous save matches the current
  // state, show the saved (check) state. setState-in-effect intentional —
  // initial state can't read sessionStorage during SSR.
  useEffect(() => {
    const snapshot = sessionStorage.getItem(BRAND_SAVED_SNAPSHOT_KEY);
    if (snapshot && snapshot === brandFingerprint) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaveBrandState("saved");
    }
    // Only on mount — subsequent comparisons run via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user edits the brand AFTER saving, the fingerprint diverges
  // from the snapshot — reset to idle so they can save the new state.
  useEffect(() => {
    if (saveBrandState !== "saved") return;
    const snapshot = sessionStorage.getItem(BRAND_SAVED_SNAPSHOT_KEY);
    if (snapshot !== brandFingerprint) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaveBrandState("idle");
    }
  }, [brandFingerprint, saveBrandState]);

  // Save the current brand as a reusable BrandKit — colours + fonts +
  // logo. Uploads the logo (and any uploaded font files) to storage at
  // save time so the kit holds storage URLs ready for the load flow to
  // rehydrate. The button morphs save → check via framer-motion; on
  // error we revert.
  const handleSaveAsBrand = async () => {
    if (saveBrandState !== "idle") return;
    setError("");
    setSaveBrandState("saving");
    try {
      // Upload any pending File-typed assets so the kit holds permanent
      // URLs. Logo + per-slot uploaded fonts run in parallel. Each
      // upload is a no-op if the file is null. If a kit was previously
      // loaded (no new File picked), `loadedLogoMeta` carries the
      // existing storage URL so re-saving doesn't drop the logo.
      const [logoAsset, headingFontAsset, bodyFontAsset, freshLogoPreview] =
        await Promise.all([
          uploadAsset("brand-assets", "logos", logo),
          headingFontSlot.mode === "upload"
            ? uploadAsset("brand-assets", "fonts", headingFontSlot.uploadFile)
            : Promise.resolve(null),
          bodyFontSlot.mode === "upload"
            ? uploadAsset("brand-assets", "fonts", bodyFontSlot.uploadFile)
            : Promise.resolve(null),
          readFileAsDataUrl(logo),
        ]);
      // Fall back to the loaded kit's logo metadata when the user didn't
      // pick a new file.
      const effectiveLogo = logoAsset
        ? {
            name: logoAsset.name,
            storageUrl: logoAsset.storageUrl,
            previewDataUrl: freshLogoPreview,
          }
        : loadedLogoMeta
          ? {
              name: loadedLogoMeta.name,
              storageUrl: loadedLogoMeta.storageUrl,
              previewDataUrl: loadedLogoMeta.previewDataUrl,
            }
          : null;

      const resolveFontSlot = (slot: FontSlotState, asset: UploadedAsset) => {
        if (slot.mode === "google" && slot.googleFamily) {
          return {
            mode: "google" as const,
            name: slot.googleFamily,
            googleFamily: slot.googleFamily,
            url: googleFontUrl(slot.googleFamily),
            storageUrl: null,
            family: slot.googleFamily,
          };
        }
        return {
          mode: "upload" as const,
          name: asset?.name ?? slot.uploadName ?? null,
          googleFamily: null,
          url: null,
          storageUrl: asset?.storageUrl ?? slot.uploadStorageUrl ?? null,
          family: slot.uploadFamily || null,
        };
      };

      // Logo placement + excludes used to be saved alongside the
      // logo file here, but they're now owned by `/create/output`.
      // The brand-kit row keeps `position` / `exclude` from the
      // previous schema (so existing kits load correctly), it just
      // doesn't receive new values from this page. The next time
      // the user reaches `/create/output`, that page reads its own
      // sessionStorage and persists position there.
      const res = await fetch("/api/brand-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colors,
          fonts: {
            heading: resolveFontSlot(headingFontSlot, headingFontAsset),
            body: resolveFontSlot(bodyFontSlot, bodyFontAsset),
          },
          logo: effectiveLogo
            ? {
                name: effectiveLogo.name,
                storageUrl: effectiveLogo.storageUrl,
                previewDataUrl: effectiveLogo.previewDataUrl,
              }
            : null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر حفظ الهوية البصرية");
      }
      // Remember THIS fingerprint as the last-saved one. Next mount of
      // the brand page (e.g. after navigating to summary and back) will
      // see the snapshot, compare against current state, and show
      // "saved" if unchanged.
      sessionStorage.setItem(BRAND_SAVED_SNAPSHOT_KEY, brandFingerprint);
      setSaveBrandState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الهوية البصرية");
      setSaveBrandState("idle");
    }
  };

  // ─── Submit ─────────────────────────────────────────────────────────────
  const handleNext = async () => {
    setError("");
    setLoading(true);

    try {
      const [paletteScreenshotAsset, headingFontAsset, bodyFontAsset, logoAsset, logoPreviewDataUrl] =
        await Promise.all([
          paletteMode === "screenshot"
            ? uploadAsset("brand-assets", "palette", paletteScreenshot)
            : Promise.resolve(null),
          uploadAsset("brand-assets", "fonts", headingFontSlot.uploadFile),
          uploadAsset("brand-assets", "fonts", bodyFontSlot.uploadFile),
          uploadAsset("brand-assets", "logos", logo),
          readFileAsDataUrl(logo),
        ]);

      // Resolve each font slot to the API-facing shape: { name, storageUrl,
      // url, family }. Google-mode populates url with the Google CSS link.
      const resolveFontSlot = (slot: FontSlotState, asset: UploadedAsset) => {
        if (slot.mode === "google" && slot.googleFamily) {
          return {
            name: slot.googleFamily,
            storageUrl: null,
            url: googleFontUrl(slot.googleFamily),
            family: slot.googleFamily,
          };
        }
        return {
          name: asset?.name ?? slot.uploadName ?? null,
          storageUrl: asset?.storageUrl ?? null,
          url: null,
          family: slot.uploadFamily || null,
        };
      };

      // Brand-page payload — colours, fonts, logo upload metadata.
      // Output-side fields (slideSize, slideCount, rules, logo
      // placement) write to `taqreer:create:output` from the next
      // step, not from here.
      sessionStorage.setItem(
        "taqreer:create:brand",
        JSON.stringify({
          colors,
          paletteMode,
          paletteScreenshotUrl: paletteScreenshotAsset?.storageUrl ?? null,
          fonts: {
            heading: resolveFontSlot(headingFontSlot, headingFontAsset),
            body: resolveFontSlot(bodyFontSlot, bodyFontAsset),
          },
          logo: logoAsset
            ? {
                name: logoAsset.name,
                storageUrl: logoAsset.storageUrl,
                previewDataUrl: logoPreviewDataUrl,
              }
            : loadedLogoMeta
              ? {
                  // Brand-kit was auto-loaded; user didn't re-pick a file.
                  // Forward the saved storage URL + metadata so the
                  // /create/output step can decide whether to show the
                  // logo-placement card as enabled.
                  name: loadedLogoMeta.name,
                  storageUrl: loadedLogoMeta.storageUrl,
                  previewDataUrl: loadedLogoMeta.previewDataUrl,
                }
              : null,
        }),
      );
      notifyCreateStateChange();

      router.push("/create/output");
    } catch (caughtError) {
      console.error("Create brand upload error:", caughtError);
      setError(
        caughtError instanceof Error
          ? `تعذر حفظ ملفات الهوية البصرية: ${caughtError.message}`
          : "تعذر حفظ ملفات الهوية البصرية. حاول مرة أخرى.",
      );
      setLoading(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <CreateShell
      currentStep="brand"
      title="إعداد الهوية البصرية"
      subtitle="اختر الألوان والخطوط وارفع الشعار الخاص بك ليتناسب مع علامتك التجارية."
    >
      <div className="space-y-6">
        {/* Row 1 — colours (start side) + fonts (end side). Row 2 —
            logo full width. The brand page used to nest these inside
            a single grid column, which made `lg:grid-cols-2` render
            as one column because there was only one child. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Brand colors — header pattern matches step 1 + step 3
              (icon + title above a hairline separator). Inner body is
              gap-driven instead of `space-y-*` so the layout follows
              the same vocabulary as the other steps. */}
          <div className="glass-card flex flex-col gap-4 rounded-2xl p-5">
            <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: "18px" }}
              >
                palette
              </span>
              <h2 className="text-sm font-semibold text-white">ألوان العلامة التجارية</h2>
            </header>
            <p className="text-xs text-muted">
              من 1 إلى 5 ألوان. نختار الخلفية والنص تلقائياً.
            </p>

            {/* Palette mode chooser — same Pill primitive as the font
                mode toggle below, so the two cards share one button
                vocabulary instead of two parallel implementations. */}
            <div className="flex flex-wrap gap-2">
              <Pill
                active={paletteMode === "manual"}
                onClick={() => setPaletteMode("manual")}
              >
                اختيار يدوي
              </Pill>
              <Pill
                active={paletteMode === "screenshot"}
                onClick={() => setPaletteMode("screenshot")}
              >
                رفع لقطة شاشة
              </Pill>
            </div>

            {/* Fixed-height mode slot so the colours card doesn't
                shrink/expand when the user toggles between اختيار
                يدوي (swatch grid) and رفع لقطة شاشة (taller dropzone).
                Block layout (not flex) so child elements naturally
                stretch to the full card width — the previous flex
                wrapper was sizing the screenshot zone to content
                width instead of card width. */}
            <div className="w-full" style={{ minHeight: 116 }}>
            {paletteMode === "screenshot" ? (
              <CompactUploadZone
                label="ارفع لقطة شاشة"
                accept="image/*"
                file={paletteScreenshot}
                onSelect={setPaletteScreenshot}
              />
            ) : (
              // 3-column grid: at MAX_COLORS (5) the layout is 3+2
              // = 2 rows. At MIN (1) → swatch + dashed add-tile sits
              // on row 1 only, still bounded by the wrapper height.
              <div className="grid grid-cols-3 gap-2">
                {colors.map((color, index) => (
                  <BrandColorRow
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_COLORS}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                  />
                ))}
                {colors.length < MAX_COLORS ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label="إضافة لون"
                    className="flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-white/20 text-white/60 transition-colors hover:border-white/40 hover:text-white"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                      add
                    </span>
                  </button>
                ) : null}
              </div>
            )}
            </div>
          </div>

          {/* Logo card — promoted into row 1 next to colours so the
              two essentials of the brand kit (palette + mark) sit
              side-by-side. Fonts then claim a full-width row below,
              giving heading + body slots enough room to breathe. */}
          <div className="glass-card flex flex-col gap-4 rounded-2xl p-5">
            <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 18 }}
              >
                image
              </span>
              <h2 className="text-sm font-semibold text-white">الشعار</h2>
            </header>
            <p className="text-xs text-muted">
              يُقبل SVG لإعادة تلوينه على كل شريحة.
            </p>
            {/* Upload zone OR preview chip — never both. Once a
                logo is in place the dropzone is redundant; the user
                removes via the × on the preview, which restores the
                dropzone for re-upload. */}
            {logo || loadedLogoMeta ? (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                style={{
                  background: "rgba(255, 255, 255, var(--glass-opacity))",
                  borderColor: "rgba(255, 255, 255, var(--glass-border-opacity))",
                }}
              >
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview}
                    alt="معاينة الشعار"
                    className="max-h-[60px] max-w-32 object-contain"
                  />
                ) : (
                  <span className="material-symbols-outlined text-white/60">image</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setLogo(null);
                    setLoadedLogoMeta(null);
                    setLogoPreview("");
                  }}
                  className="badge-purple flex items-center gap-1"
                >
                  <span className="text-base leading-none">×</span>
                  إزالة
                </button>
              </div>
            ) : (
              <CompactUploadZone
                label="ارفع الشعار (SVG فقط)"
                accept=".svg,image/svg+xml"
                file={logo}
                onSelect={acceptLogo}
              />
            )}
            {logoError && (
              <p className="status-error text-[12px]">{logoError}</p>
            )}
          </div>
        </div>
        {/* /Row 1 — colours + logo. Row 2 — fonts full width below. */}

        {/* Fonts — full-width row so heading + body slots sit
            comfortably side-by-side with room for the new dropzone
            visuals + Google-fonts combobox. */}
        <div className="glass-card flex flex-col gap-4 rounded-2xl p-5">
          <header className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 18 }}
            >
              text_fields
            </span>
            <h2 className="text-sm font-semibold text-white">الخطوط</h2>
          </header>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Heading font */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">خط العناوين</p>
              <div className="flex gap-2">
                <Pill
                  active={headingFontSlot.mode === "upload"}
                  onClick={() => setFontMode("heading", "upload")}
                >
                  رفع ملف
                </Pill>
                <Pill
                  active={headingFontSlot.mode === "google"}
                  onClick={() => setFontMode("heading", "google")}
                >
                  Google Fonts
                </Pill>
              </div>
              {headingFontSlot.mode === "upload" ? (
                <FontUploadSlot
                  label="ارفع خط العناوين"
                  file={headingFontSlot.uploadFile}
                  family={headingFontSlot.uploadFamily}
                  sampleText="أبجد هوز"
                  sampleSizeClass="text-2xl"
                  onSelect={(file) => onUploadFont("heading", file)}
                  onRemove={() => onRemoveUploadFont("heading")}
                />
              ) : (
                <GoogleFontSlot
                  label="خط العناوين"
                  selected={headingFontSlot.googleFamily}
                  sampleText="أبجد هوز"
                  sampleSizeClass="text-2xl"
                  onSelect={(family) => onSelectGoogleFont("heading", family)}
                />
              )}
            </div>

            {/* Body font */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">خط النص</p>
              <div className="flex gap-2">
                <Pill
                  active={bodyFontSlot.mode === "upload"}
                  onClick={() => setFontMode("body", "upload")}
                >
                  رفع ملف
                </Pill>
                <Pill
                  active={bodyFontSlot.mode === "google"}
                  onClick={() => setFontMode("body", "google")}
                >
                  Google Fonts
                </Pill>
              </div>
              {bodyFontSlot.mode === "upload" ? (
                <FontUploadSlot
                  label="ارفع خط النص"
                  file={bodyFontSlot.uploadFile}
                  family={bodyFontSlot.uploadFamily}
                  sampleText="النص الأساسي يُستخدم في فقرات المحتوى."
                  sampleSizeClass="text-base"
                  onSelect={(file) => onUploadFont("body", file)}
                  onRemove={() => onRemoveUploadFont("body")}
                />
              ) : (
                <GoogleFontSlot
                  label="خط النص"
                  selected={bodyFontSlot.googleFamily}
                  sampleText="النص الأساسي يُستخدم في فقرات المحتوى."
                  sampleSizeClass="text-base"
                  onSelect={(family) => onSelectGoogleFont("body", family)}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-between">
        {/* Explicit route — `router.back()` would land on /create/output
            when the user reached this page via the stepper from step 3,
            which broke the linear "previous = one step earlier" mental
            model. */}
        <PillButton
          variant="secondary"
          onClick={() => router.push("/create/content")}
          icon="arrow_forward"
        >
          السابق
        </PillButton>
        <div className="flex items-center gap-3">
          {/* Save-as-brand — glass icon button. Save icon morphs to a
              check on success via a one-shot 360° rotation + cross-fade
              (same recipe as the sidebar burger ↔ close morph). Disabled
              while saving; stays as check once saved. */}
          <button
            type="button"
            onClick={handleSaveAsBrand}
            disabled={saveBrandState !== "idle"}
            aria-label={
              saveBrandState === "saved"
                ? "تم الحفظ كهوية بصرية"
                : "حفظ كهوية بصرية"
            }
            // Pill height + radius to match the PillButton secondary
            // variant used by السابق / الخطوة التالية — keeps the
            // bottom-bar visually one row of pills instead of one
            // rounded-rect + two pills.
            style={{
              background: "rgba(255, 255, 255, var(--glass-opacity))",
              backdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
              WebkitBackdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturation))",
              borderRadius: 9999,
            }}
            className={`group relative inline-flex h-11 items-center gap-2 border px-5 text-sm font-medium transition-colors ${
              saveBrandState === "saved"
                ? "border-white/40 text-white cursor-default"
                : saveBrandState === "saving"
                  ? "border-white/30 text-white/80 cursor-wait"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
            }`}
          >
            <motion.div
              animate={{ rotate: saveBrandState === "saved" ? 360 : 0 }}
              transition={{ rotate: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
              className="flex h-[22px] w-[22px] items-center justify-center"
            >
              <AnimatePresence mode="wait" initial={false}>
                {saveBrandState === "saved" ? (
                  <motion.span
                    key="check"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="material-symbols-outlined text-[20px]"
                  >
                    check
                  </motion.span>
                ) : saveBrandState === "saving" ? (
                  <motion.span
                    key="saving"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="spinner h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                  />
                ) : (
                  <motion.span
                    key="save"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="material-symbols-outlined text-[20px]"
                  >
                    save
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
            <span>
              {saveBrandState === "saved" ? "محفوظ كهوية بصرية" : "حفظ كهوية بصرية"}
            </span>
          </button>
          <PillButton
            variant="primary"
            onClick={handleNext}
            disabled={loading}
            loading={loading}
            icon="arrow_back"
          >
            الخطوة التالية
          </PillButton>
        </div>
      </div>
    </CreateShell>
  );
}
