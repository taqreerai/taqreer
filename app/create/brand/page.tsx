"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
// colorthief was previously used here. Replaced by a direct pixel
// histogram (see `extractDominantColors` below) because median-cut
// quantisation returns CLUSTER CENTROIDS — averaging a bright brand
// colour with surrounding antialiased pixels and producing duller,
// off-by-many-RGB results. The histogram approach buckets the
// actual source pixels, ranks by frequency, and reconstructs the
// precise mean of each bucket so the swatches read back the pure
// brand hex (e.g. #BBF54B stays #BBF54B instead of #69F954).
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import { Pill } from "@/components/create/controls";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import { notifyCreateStateChange } from "@/components/create/CreateStepper";
import type { CornerPosition } from "@/components/create/controls";
import {
  LogoPositionFields,
  type StoredOutput,
} from "@/components/create/OutputCards";

// Brand page (step 2 of 3) — colours, fonts (Google + upload), and
// LOGO UPLOAD + PLACEMENT. The 4-step create flow was collapsed to
// 3 steps on 2026-05-19: logo placement moved back here (lives with
// the logo upload on the same card); slide-size / slide-count /
// generation rules moved to step 1's bottom row. Search history for
// the `/create/output` references — those are stale and should be
// updated when touched.

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
const MAX_COLORS = 6;

// Direct pixel histogram → dominant brand colours. Replaces
// colorthief because its median-cut quantiser returned cluster
// CENTROIDS — averaging a bright accent with surrounding pixels
// and producing duller hex values than the actual source.
//
// Algorithm:
//   1. Bucket every pixel by RGB at `STEP` resolution (16 = ~16
//      levels per channel, 4096 max buckets). Coarse enough to
//      collapse antialiasing into the dominant tone, fine enough
//      to keep distinct brand hues apart.
//   2. Track each bucket's pixel count AND the running RGB sum so
//      we can compute the exact mean of source pixels per bucket
//      after the loop — that mean IS the source colour for any
//      flat fill (no quantisation drift).
//   3. Sort buckets by count descending, walk them, accept the
//      first `maxColors` whose mean is at least `MIN_RGB_DISTANCE`
//      from every already-accepted colour. Stop early if a
//      candidate's proportion falls under `MIN_PROPORTION` — those
//      are antialiasing remnants, not brand colours, and padding
//      the swatches with them gave the user 6 shades of grey/green
//      instead of the 3 distinct hues they actually wanted.
function extractDominantColors(
  img: HTMLImageElement,
  maxColors: number,
): string[] {
  const STEP = 16;
  const MIN_RGB_DISTANCE = 60;
  const MIN_PROPORTION = 0.005; // 0.5 %

  const canvas = document.createElement("canvas");
  // Cap analysis at a reasonable size — exact pixel counts don't
  // change the dominant colours, and large source images turn
  // getImageData into a multi-MB allocation.
  const MAX_DIM = 800;
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height, 1));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const counts = new Map<string, number>();
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < data.length; i += 4) {
    // Skip transparent pixels — they're not brand colours.
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${Math.floor(r / STEP)},${Math.floor(g / STEP)},${Math.floor(b / STEP)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const s = sums.get(key) ?? [0, 0, 0];
    s[0] += r;
    s[1] += g;
    s[2] += b;
    sums.set(key, s);
  }

  const totalPixels = canvas.width * canvas.height;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dist = (
    a: [number, number, number],
    b: [number, number, number],
  ) =>
    Math.sqrt(
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
    );

  const accepted: Array<{ rgb: [number, number, number]; hex: string }> = [];
  for (const [key, count] of ranked) {
    if (count / totalPixels < MIN_PROPORTION) break;
    const s = sums.get(key)!;
    const rgb: [number, number, number] = [
      Math.round(s[0] / count),
      Math.round(s[1] / count),
      Math.round(s[2] / count),
    ];
    if (accepted.some((a) => dist(a.rgb, rgb) < MIN_RGB_DISTANCE)) continue;
    const hex =
      "#" +
      rgb
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    accepted.push({ rgb, hex });
    if (accepted.length >= maxColors) break;
  }
  return accepted.map((a) => a.hex);
}

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
    ? "border-2 border-[#370BF4] bg-[var(--tq-blue)]/10"
    : "border border-white/[var(--glass-border-opacity)]";
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

// Reverse of readFileAsDataUrl — used when handleNext has only a
// saved-draft previewDataUrl (user picked a logo, navigated away
// before clicking Next, came back). We need a File object to feed
// the storage upload API.
async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/svg+xml" });
}

// Three-state pane that fits inside the screenshot palette mode:
//   idle    → dropzone (same CompactUploadZone the manual flows use)
//   loading → spinner + caption inside a same-sized box
//   preview → fade-in row of swatches (piano-stagger) + Use / Try-again
//   error   → message + retry button
// Returns a single element occupying the same vertical footprint so the
// card doesn't shift size between states.
function ScreenshotExtractionPane({
  state,
  file,
  onSelect,
  onUse,
  onRetry,
}: {
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "preview"; colors: string[] }
    | { kind: "error"; message: string };
  file: File | null;
  onSelect: (file: File | null) => void;
  onUse: (colors: string[]) => void;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-6 text-white/60"
        aria-busy
        aria-live="polite"
      >
        <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
        <span className="text-xs">جارٍ استخراج الألوان...</span>
      </div>
    );
  }
  if (state.kind === "preview") {
    return (
      <div className="flex flex-col gap-3">
        {/* Swatch row — 6 fixed slots, each fade-in staggered (piano)
            so the user sees the result materialise rather than appear
            in one flash. 60 ms stagger × 6 ≈ 360 ms total — fast
            enough to feel snappy but slow enough to read as motion. */}
        <div className="grid grid-cols-6 gap-2">
          {state.colors.map((hex, i) => (
            <motion.div
              key={`${hex}-${i}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: i * 0.06, ease: "easeOut" }}
              className="aspect-square w-full rounded-lg border border-white/10"
              style={{ background: hex }}
              title={hex}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <PillButton variant="ghost" size="sm" onClick={onRetry}>
            حاول مرة أخرى
          </PillButton>
          <PillButton
            variant="primary"
            size="sm"
            onClick={() => onUse(state.colors)}
          >
            استخدم هذه الألوان
          </PillButton>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] py-6 text-center">
        <p className="text-xs text-red-300">{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-white/70 underline transition-colors hover:text-white"
        >
          حاول صورة أخرى
        </button>
      </div>
    );
  }
  // idle
  return (
    <CompactUploadZone
      label="ارفع لقطة شاشة"
      accept="image/*"
      file={file}
      onSelect={onSelect}
    />
  );
}

function CompactUploadZone({
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
  // `compact` shrinks the dropzone for the logo card so the always-
  // visible <LogoPositionFields> below it can share the same card
  // height it had when placement was conditional on upload. The
  // screenshot dropzone stays at its original height — there are no
  // controls below it competing for vertical space.
  compact?: boolean;
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
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/20 text-center transition-colors hover:border-white/30 ${compact ? "gap-1.5 p-2.5" : "p-4"}`}
        style={{ minHeight: compact ? 72 : 100 }}
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
          //
          // Surface recipe matches the quality-preset dropdown on
          // /create/summary: translucent-white fill at glass-opacity
          // over the dark backdrop, glass-border-opacity hairline,
          // backdrop-blur-glass blur token. Was previously a hardcoded
          // dark `rgba(15, 11, 30, 0.92)` that didn't respond to the
          // user's glass preset and read inconsistently against the
          // rest of the popovers in the flow.
          style={{
            top: 44,
            maxHeight: 240,
            background: "rgba(255, 255, 255, var(--glass-opacity))",
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
  // Persisted font selections (heading + body) — written by the
  // brand page on `handleNext`. Each slot mirrors what's sent to
  // /api/projects: `name`, `storageUrl`, `url`, `family`. The
  // uploaded File itself can't round-trip through sessionStorage,
  // but everything else (Google family name, uploaded storageUrl,
  // typed family) can — restoring them keeps the selectors populated
  // when the user navigates back from a later step.
  fonts?: {
    heading?: {
      name?: string | null;
      storageUrl?: string | null;
      url?: string | null;
      family?: string | null;
    } | null;
    body?: {
      name?: string | null;
      storageUrl?: string | null;
      url?: string | null;
      family?: string | null;
    } | null;
  } | null;
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
  // Restore colours + font selections from sessionStorage post-hydration.
  // useLayoutEffect (not useEffect) so the swap happens BEFORE the browser
  // paints — user never sees the default-palette / empty-font-selectors
  // flash if they're returning from a later step with their picks already
  // saved. The uploaded File itself can't be reconstructed (binary blobs
  // don't round-trip through sessionStorage), so for slots that were in
  // upload mode we restore the metadata (name + storageUrl + family) but
  // leave `uploadFile: null` — the slot displays as "filled" via the
  // stored name/url, and the user can re-pick only if they want to
  // replace it.
  useLayoutEffect(() => {
    const s = readStoredBrand();
    if (!s) return;
    if (Array.isArray(s.colors)) {
      const valid = (s.colors as unknown[]).filter(
        (c): c is string => typeof c === "string",
      );
      if (valid.length >= MIN_COLORS) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setColors(valid.slice(0, MAX_COLORS));
      }
    }
    const restoreSlot = (
      saved:
        | { name?: string | null; storageUrl?: string | null; url?: string | null; family?: string | null }
        | null
        | undefined,
    ): FontSlotState | null => {
      if (!saved) return null;
      // Google-family slot: `url` is set (Google CSS link) and
      // `storageUrl` is null. Stored `name`/`family` matches the
      // Google family.
      if (saved.url && !saved.storageUrl) {
        return {
          mode: "google",
          uploadFile: null,
          uploadName: null,
          uploadStorageUrl: null,
          uploadFamily: "",
          googleFamily: saved.family || saved.name || null,
        };
      }
      // Upload slot: `storageUrl` is set (Supabase path), `name` is
      // the original filename. The File blob is gone — slot still
      // reads as filled via name + storageUrl.
      if (saved.storageUrl) {
        return {
          mode: "upload",
          uploadFile: null,
          uploadName: saved.name ?? null,
          uploadStorageUrl: saved.storageUrl,
          uploadFamily: saved.family ?? "",
          googleFamily: null,
        };
      }
      return null;
    };
    const heading = restoreSlot(s.fonts?.heading);
    if (heading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeadingFontSlot(heading);
    }
    const body = restoreSlot(s.fonts?.body);
    if (body) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBodyFontSlot(body);
    }
  }, []);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("manual");
  const [paletteScreenshot, setPaletteScreenshot] = useState<File | null>(null);
  // Three-state machine for the screenshot extraction flow inside the
  // screenshot palette mode:
  //   idle    → empty dropzone, user hasn't picked a file yet
  //   loading → spinner inside the dropzone while colorthief quantises
  //   preview → row of extracted swatches + Use / Try-again buttons
  //   error   → extraction failed (CORS, decode, no pixels), show inline
  // `paletteScreenshot` is the source file; `extractedColors` is the
  // result we're about to (maybe) apply to `colors`.
  type ExtractionState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "preview"; colors: string[] }
    | { kind: "error"; message: string };
  const [extraction, setExtraction] = useState<ExtractionState>({ kind: "idle" });

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
  // Logo placement state — was on the deleted `/create/output` step;
  // moved here on 2026-05-19 so all logo-related controls live in the
  // same card. Persisted into `taqreer:create:output` (`.logo.*`)
  // because the summary page + the API stitcher already read it from
  // there. The brand-saved-snapshot fingerprint ignores these
  // fields (placement is per-deck, not per-brand-kit).
  const [logoPosition, setLogoPosition] = useState<CornerPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);

  // SVG-only logo policy (2026-05-15). Raster formats (PNG/JPG) are rejected
  // because we can't recolor them per slide for contrast — see context.md
  // Phase 9. Polychrome SVGs are accepted but can't be recolored either;
  // Claude is told in the prompt to design backgrounds compatible with
  // the logo's colors when it's not a monochrome SVG.
  //
  // Auto-save: also write the preview data URL to sessionStorage on
  // pick, so the preview survives navigating to the dashboard before
  // clicking Next. handleNext later reconstructs a File from the data
  // URL when no fresh File is in state.
  const acceptLogo = async (next: File) => {
    const isSvgMime = next.type === "image/svg+xml";
    const isSvgExt = next.name.toLowerCase().endsWith(".svg");
    if (!isSvgMime && !isSvgExt) {
      setLogoError("الشعار يجب أن يكون بصيغة SVG فقط — لضمان جودة الألوان والتباين على كل شريحة.");
      return;
    }
    setLogoError(null);
    setLogo(next);
    // Best-effort persist — failure leaves state in-memory only,
    // matching the pre-auto-save behaviour.
    try {
      const previewDataUrl = await readFileAsDataUrl(next);
      if (typeof window !== "undefined") {
        const raw = window.sessionStorage.getItem("taqreer:create:brand");
        const blob = raw ? JSON.parse(raw) : {};
        blob.logo = {
          name: next.name,
          previewDataUrl,
          // storageUrl intentionally left empty — set on Next.
          storageUrl: null,
        };
        window.sessionStorage.setItem(
          "taqreer:create:brand",
          JSON.stringify(blob),
        );
        notifyCreateStateChange();
      }
    } catch {
      /* persistence is best-effort */
    }
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
    // `null` storageUrl = the user picked a logo but hasn't clicked
    // Next yet (auto-save draft from `acceptLogo`). handleNext sees
    // the missing storageUrl and reconstructs a File from
    // previewDataUrl to do the actual storage upload at that point.
    storageUrl: string | null;
    name: string;
    previewDataUrl: string | null;
  } | null>(null);

  // Restore logo from sessionStorage post-hydration. Two paths:
  //   1. Full save (storageUrl + previewDataUrl) — after a previous
  //      Next click. handleNext can forward storageUrl directly.
  //   2. Draft (previewDataUrl only) — user picked a logo via the
  //      auto-save path and navigated away before clicking Next.
  //      handleNext reconstructs a File from previewDataUrl and
  //      uploads then.
  // Either way the preview chip appears immediately — no flash of
  // empty upload zone.
  useLayoutEffect(() => {
    const s = readStoredBrand();
    if (s?.logo?.previewDataUrl || s?.logo?.storageUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadedLogoMeta({
        storageUrl: s.logo.storageUrl ?? null,
        name: s.logo.name ?? "logo",
        previewDataUrl: s.logo.previewDataUrl ?? null,
      });
      if (s.logo.previewDataUrl) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLogoPreview(s.logo.previewDataUrl);
      }
    }
    // Hydrate logo placement from the output blob. Lives in the same
    // sessionStorage key as the rest of the output settings (which
    // step 1 owns), so this page only READS the logo.* slot then
    // WRITES it back when the controls change — preserving everything
    // else step 1 wrote.
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("taqreer:create:output");
      if (!raw) return;
      const out = JSON.parse(raw) as StoredOutput;
      if (out.logo?.position) setLogoPosition(out.logo.position);
      if (typeof out.logo?.excludeCover === "boolean") {
        setLogoExcludeCover(out.logo.excludeCover);
      }
      if (typeof out.logo?.excludeClosing === "boolean") {
        setLogoExcludeClosing(out.logo.excludeClosing);
      }
    } catch {
      /* corrupt blob — leave defaults */
    }
  }, []);

  // Auto-save logo placement back into the output blob whenever any
  // of its three fields change. Read-modify-write so step 1's slide
  // size / count / rules are preserved across edits here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("taqreer:create:output");
      const out: StoredOutput = raw ? JSON.parse(raw) : {};
      out.logo = {
        position: logoPosition,
        excludeCover: logoExcludeCover,
        excludeClosing: logoExcludeClosing,
      };
      window.sessionStorage.setItem("taqreer:create:output", JSON.stringify(out));
      notifyCreateStateChange();
    } catch {
      /* best-effort persistence */
    }
  }, [logoPosition, logoExcludeCover, logoExcludeClosing]);

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
    try {
      setContent(JSON.parse(rawContent) as StoredContent);
    } catch {
      // Corrupt session payload — bounce to step 1 instead of crashing
      // the whole page. Step 1 will hydrate fresh state.
      router.replace("/create/content");
      return;
    }

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

  // ─── Screenshot → palette extraction ──────────────────────────────────
  // Runs entirely client-side via colorthief's median-cut quantiser.
  // The file → Image element decode is async and CPU-bound; we stage
  // through `extraction` so the UI can show a loading state while
  // colorthief is working, then a "preview" state with the extracted
  // swatches and two actions (Use / Try-again). The user reviews
  // before committing, so we never overwrite their manual edits
  // without consent.
  const onPaletteScreenshotSelect = async (file: File | null) => {
    if (!file) {
      setPaletteScreenshot(null);
      setExtraction({ kind: "idle" });
      return;
    }
    // Hard cap on the source image. Extraction runs client-side via
    // colorthief; large images take noticeably longer on lower-end
    // devices and the result quality plateaus past ~1 MP anyway.
    // Reject UP-FRONT — don't even stash the File on state so we
    // never hold a multi-MB blob in memory.
    const SCREENSHOT_MAX_BYTES = 500 * 1024;
    if (file.size > SCREENSHOT_MAX_BYTES) {
      setPaletteScreenshot(null);
      const kb = Math.round(file.size / 1024);
      setExtraction({
        kind: "error",
        message: `حجم الصورة (${kb}KB) أكبر من الحد المسموح (500KB). اختر صورة أصغر.`,
      });
      return;
    }
    setPaletteScreenshot(file);
    setExtraction({ kind: "loading" });
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          // Same-origin object URL — no crossOrigin needed, but pin
          // it anyway in case the source is ever swapped to a remote
          // signed URL.
          el.crossOrigin = "anonymous";
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("decode failed"));
          el.src = url;
        });
        const hexes = extractDominantColors(img, MAX_COLORS);
        if (hexes.length === 0) {
          setExtraction({ kind: "error", message: "تعذر استخراج الألوان من هذه الصورة." });
          return;
        }
        setExtraction({ kind: "preview", colors: hexes });
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setExtraction({ kind: "error", message: "تعذر قراءة الصورة. جرّب صورة أخرى." });
    }
  };

  // Commit the extracted palette → switch to manual mode so the user
  // can edit any swatch via the existing custom picker. Drop the
  // screenshot reference too: extraction is done, no reason to hold
  // a multi-hundred-KB blob in memory. The mode-switch also gates
  // the handleNext upload path (`paletteMode === "screenshot"` gate)
  // so the file never reaches Supabase Storage either — palette
  // extraction is a one-shot client-side transform, not a stored
  // asset.
  const applyExtractedColors = (next: string[]) => {
    if (next.length === 0) return;
    setColors(next.slice(0, MAX_COLORS));
    setPaletteMode("manual");
    setPaletteScreenshot(null);
    setExtraction({ kind: "idle" });
  };

  // Discard the extraction result and return to the upload state so
  // the user can try a different screenshot.
  const retryPaletteScreenshot = () => {
    setPaletteScreenshot(null);
    setExtraction({ kind: "idle" });
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
  // A `storageUrl` represents a logo that's already been uploaded to
  // backend storage. A draft logo (only `previewDataUrl`) hasn't been
  // saved yet — it must still produce a non-null fingerprint so the
  // Save button correctly distinguishes "saved" from "has unsaved
  // logo draft." Using `name` as the draft token keeps the fingerprint
  // string short while changing whenever the user picks a different
  // file via the dropzone.
  const logoFingerprint = logo
    ? `${logo.name}:${logo.size}:${logo.lastModified}`
    : loadedLogoMeta
      ? (loadedLogoMeta.storageUrl ?? `draft:${loadedLogoMeta.name ?? ""}`)
      : null;
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
  // Resolve the File object we should upload for the logo. Three cases:
  //   1. Fresh File in state → use it directly.
  //   2. Auto-save draft only (loadedLogoMeta with previewDataUrl,
  //      no storageUrl) → reconstruct a File from the data URL.
  //   3. Already-uploaded logo (storageUrl present) → no File needed;
  //      caller falls back to `loadedLogoMeta` to forward the URL.
  const resolveLogoFileForUpload = async (): Promise<File | null> => {
    if (logo) return logo;
    if (
      loadedLogoMeta &&
      !loadedLogoMeta.storageUrl &&
      loadedLogoMeta.previewDataUrl
    ) {
      try {
        return await dataUrlToFile(
          loadedLogoMeta.previewDataUrl,
          loadedLogoMeta.name || "logo.svg",
        );
      } catch {
        return null;
      }
    }
    return null;
  };

  const handleSaveAsBrand = async () => {
    if (saveBrandState !== "idle") return;
    setError("");
    setSaveBrandState("saving");
    try {
      const logoFile = await resolveLogoFileForUpload();
      // Upload any pending File-typed assets so the kit holds permanent
      // URLs. Logo + per-slot uploaded fonts run in parallel. Each
      // upload is a no-op if the file is null. If a kit was previously
      // loaded with a real storageUrl, `loadedLogoMeta` carries it so
      // re-saving doesn't drop the logo.
      const [logoAsset, headingFontAsset, bodyFontAsset, freshLogoPreview] =
        await Promise.all([
          uploadAsset("brand-assets", "logos", logoFile),
          headingFontSlot.mode === "upload"
            ? uploadAsset("brand-assets", "fonts", headingFontSlot.uploadFile)
            : Promise.resolve(null),
          bodyFontSlot.mode === "upload"
            ? uploadAsset("brand-assets", "fonts", bodyFontSlot.uploadFile)
            : Promise.resolve(null),
          readFileAsDataUrl(logoFile),
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
      const logoFile = await resolveLogoFileForUpload();
      const [paletteScreenshotAsset, headingFontAsset, bodyFontAsset, logoAsset, logoPreviewDataUrl] =
        await Promise.all([
          paletteMode === "screenshot"
            ? uploadAsset("brand-assets", "palette", paletteScreenshot)
            : Promise.resolve(null),
          uploadAsset("brand-assets", "fonts", headingFontSlot.uploadFile),
          uploadAsset("brand-assets", "fonts", bodyFontSlot.uploadFile),
          uploadAsset("brand-assets", "logos", logoFile),
          readFileAsDataUrl(logoFile),
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

      router.push("/create/summary");
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
  const bottomBar = (
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
          // bg via preset-linked alpha; blur via Tailwind utility
          // (memory: feedback_tw_glass_system).
          style={{
            background: "rgba(255, 255, 255, var(--glass-opacity))",
            borderRadius: 9999,
          }}
          className={`backdrop-blur-glass backdrop-saturate-(--glass-saturation) group relative inline-flex h-11 items-center gap-2 border px-5 text-sm font-medium transition-colors ${
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
  );

  return (
    <CreateShell
      currentStep="brand"
      title="إعداد الهوية البصرية"
      subtitle="اختر الألوان والخطوط وارفع الشعار الخاص بك ليتناسب مع علامتك التجارية."
      bottomBar={bottomBar}
    >
      {/* No inner wrapper — direct children of CreateShell's column
          (`flex flex-col gap-4`) so the row→button gap is the same
          gap-4 as on steps 1 + 3 (visual continuity across the
          flow). */}
      <>
        {/* Layout — fonts first (full-width row), then colours + logo
            side-by-side below. Fonts lead because users typically pick
            them once per brand and rarely revisit, so they should land
            at the top of the visual scan order. Colours + logo cluster
            in a 2-col row below since they're often paired changes. */}

        {/* Fonts — full-width row so heading + body slots sit
            comfortably side-by-side with room for the upload-zone
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

        {/* Colours (start side) + logo (end side) — paired row. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              من 1 إلى 6 ألوان. نختار الخلفية والنص تلقائياً.
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
              <ScreenshotExtractionPane
                state={extraction}
                file={paletteScreenshot}
                onSelect={onPaletteScreenshotSelect}
                onUse={applyExtractedColors}
                onRetry={retryPaletteScreenshot}
              />
            ) : (
              // 3-column grid: at MAX_COLORS (6) the layout is 3+3
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
                    // Clear the draft logo from sessionStorage too — the
                    // accept path auto-saves into `taqreer:create:brand`,
                    // so without this a refresh / nav-away-and-back would
                    // resurrect the deleted logo. Best-effort: if storage
                    // is blocked (private mode etc.) we still clear
                    // in-memory state above.
                    if (typeof window !== "undefined") {
                      try {
                        const raw = window.sessionStorage.getItem("taqreer:create:brand");
                        if (raw) {
                          const blob = JSON.parse(raw) as Record<string, unknown>;
                          blob.logo = null;
                          window.sessionStorage.setItem(
                            "taqreer:create:brand",
                            JSON.stringify(blob),
                          );
                          notifyCreateStateChange();
                        }
                      } catch {
                        /* best effort — storage may be blocked */
                      }
                    }
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
                compact
              />
            )}
            {logoError && (
              <p className="status-error text-[12px]">{logoError}</p>
            )}
            {/* Logo placement — always rendered so the logo card has a
                stable footprint that matches step-1's two-row card
                density. When no logo is uploaded the picker + pills
                are visibly disabled (greyed out) rather than absent;
                the compact upload zone above absorbs the slack. */}
            <LogoPositionFields
              position={logoPosition}
              excludeCover={logoExcludeCover}
              excludeClosing={logoExcludeClosing}
              onPosition={setLogoPosition}
              onExcludeCover={setLogoExcludeCover}
              onExcludeClosing={setLogoExcludeClosing}
              disabled={!(logo || loadedLogoMeta)}
            />
          </div>
        </div>
      </>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </CreateShell>
  );
}
