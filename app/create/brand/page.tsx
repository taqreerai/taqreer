"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PaletteMode = "manual" | "screenshot";
type SlideCountMode = "match" | "auto" | "custom";
type CornerPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
type LogoPosition = CornerPosition;
type PersistentPosition = CornerPosition;
type FontMode = "upload" | "google";
type FontTarget = "heading" | "body";

// 6-button position picker: 3 top + 3 bottom, with directional arrow icons.
// Default to top-right (RTL convention for chrome marks).
const CORNER_OPTIONS: { value: CornerPosition; icon: string; label: string }[] = [
  { value: "top-left", icon: "north_west", label: "أعلى يسار" },
  { value: "top-center", icon: "north", label: "أعلى الوسط" },
  { value: "top-right", icon: "north_east", label: "أعلى يمين" },
  { value: "bottom-left", icon: "south_west", label: "أسفل يسار" },
  { value: "bottom-center", icon: "south", label: "أسفل الوسط" },
  { value: "bottom-right", icon: "south_east", label: "أسفل يمين" },
];

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

const DEFAULT_COLORS = ["#370BF4", "#E036B8", "#7D2DFF"];
const MIN_COLORS = 3;
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
        className="flex max-h-[120px] min-h-[100px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#370BF4]/60 bg-[#03030D]/40 p-4 text-center transition-colors hover:border-[#7D2DFF] hover:bg-[#7D2DFF]/10"
      >
        <span className="material-symbols-outlined mb-2 text-[28px] text-[#7D2DFF]">upload</span>
        <span className="font-semibold text-white">{label}</span>
        {file ? <span className="mt-2 max-w-full truncate text-sm text-[#9A94A8]">{file.name}</span> : null}
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
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="material-symbols-outlined text-[#7D2DFF]">font_download</span>
            <span className="truncate font-semibold text-white">{file.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              onRemove();
            }}
            aria-label={`إزالة ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex max-h-[120px] min-h-[100px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#370BF4]/60 bg-[#03030D]/40 p-4 text-center transition-colors hover:border-[#7D2DFF] hover:bg-[#7D2DFF]/10"
        >
          <span className="material-symbols-outlined mb-2 text-[28px] text-[#7D2DFF]">font_download</span>
          <span className="font-semibold text-white">{label}</span>
          <span className="mt-1 text-xs text-muted">اختياري — Arial افتراضياً</span>
        </button>
      )}
      <p className={`${sampleSizeClass} text-white${family ? ` ${family}` : ""}`}>
        {sampleText}
      </p>
    </div>
  );
}

function GoogleFontSlot({
  label,
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
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 p-3">
        <p className="mb-2 text-xs text-muted">{label} — اختر من Google Fonts</p>
        <div className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
          {GOOGLE_FONTS.map((font) => {
            const isActive = selected === font.family;
            return (
              <button
                key={font.family}
                type="button"
                onClick={() => onSelect(isActive ? null : font.family)}
                // Family name kept in the site default font so the list stays
                // visually uniform; the live preview at the bottom is the
                // single place where the selected face renders.
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-[#370BF4]/20 text-white"
                    : "text-white hover:bg-white/5"
                }`}
              >
                <span>{font.family}</span>
                {font.arabic ? (
                  <span className="text-[10px] text-[#9A94A8]">عربي + لاتيني</span>
                ) : (
                  <span className="text-[10px] text-[#9A94A8]">لاتيني</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p
        className={`${sampleSizeClass} text-white`}
        style={selected ? { fontFamily: `"${selected}", system-ui, sans-serif` } : undefined}
      >
        {sampleText}
      </p>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        active
          ? "btn-gradient text-white"
          : "border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 text-white hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

// 6-button position picker: 3 top + 3 bottom, each button shows a directional
// arrow (north_west, north, north_east, south_west, south, south_east). Used
// for both the logo position and the persistent-overlay position.
// `dir="ltr"` is intentional: it locks the grid so the visually-rightmost
// button always maps to the *right* side of the canvas, regardless of the
// page's RTL context. Without this, the array's first entry (top-left) ends
// up on the visual right under RTL — which would silently flip the mapping.
function PositionPicker({
  value,
  onChange,
}: {
  value: CornerPosition;
  onChange: (next: CornerPosition) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {CORNER_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            title={option.label}
            className={`flex h-12 items-center justify-center rounded-xl transition-colors ${
              active
                ? "btn-gradient text-white"
                : "border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 text-white hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{option.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-white">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${
          value ? "tq-switch-on" : "bg-white/10"
        }`}
        dir="ltr"
      >
        <span
          className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

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
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 p-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="h-10 w-10 shrink-0 rounded-lg border border-[rgba(42,36,59,0.8)]"
        style={{ backgroundColor: value }}
        aria-label={`اللون ${index + 1}`}
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="hidden"
      />
      <input
        type="text"
        value={value.toUpperCase()}
        onChange={(event) => onChange(event.target.value)}
        className="input-dark flex-1 font-mono text-sm"
        spellCheck={false}
      />
      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="إزالة اللون"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      ) : null}
    </div>
  );
}

// Read the previously-saved brand blob from sessionStorage. Runs in each
// useState lazy initializer below; safe on the server (returns null) and only
// fires once per mount per call site.
type StoredBrandShape = {
  colors?: unknown;
  slideSize?: unknown;
  slideCount?: { mode?: SlideCountMode; value?: number | null };
  rules?: {
    designStyle?: string | null;
    fixTypos?: boolean;
    pagination?: boolean;
    persistent?:
      | { text?: string; position?: PersistentPosition; exclude?: ("cover" | "closing")[] }
      | null;
  };
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
  // Lazy initializers restore from sessionStorage when the user comes back
  // via the summary's "رجوع" button (no in-effect prop sync needed).
  const [colors, setColors] = useState<string[]>(() => {
    const s = readStoredBrand();
    if (s && Array.isArray(s.colors)) {
      const valid = (s.colors as unknown[]).filter((c): c is string => typeof c === "string");
      if (valid.length >= MIN_COLORS) return valid.slice(0, MAX_COLORS);
    }
    return DEFAULT_COLORS;
  });
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
  const [logoPreview, setLogoPreview] = useState("");
  const [logoPosition, setLogoPosition] = useState<LogoPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState(false);

  // ─── Left column state ──────────────────────────────────────────────────
  // Generation rules — moved here from /create/summary so the summary step
  // is content-only. Tone removed (will live on /enhance later).
  const [designStyle, setDesignStyle] = useState<string | null>(() => {
    return readStoredBrand()?.rules?.designStyle ?? null;
  });
  const [fixTypos, setFixTypos] = useState<boolean>(() => {
    return Boolean(readStoredBrand()?.rules?.fixTypos);
  });
  const [pagination, setPagination] = useState<boolean>(() => {
    return readStoredBrand()?.rules?.pagination !== false;
  });
  const [persistentText, setPersistentText] = useState<string>(() => {
    return readStoredBrand()?.rules?.persistent?.text ?? "";
  });
  const [persistentPosition, setPersistentPosition] = useState<PersistentPosition>(() => {
    return readStoredBrand()?.rules?.persistent?.position ?? "top-right";
  });
  const [excludeCover, setExcludeCover] = useState<boolean>(() => {
    return readStoredBrand()?.rules?.persistent?.exclude?.includes("cover") ?? false;
  });
  const [excludeClosing, setExcludeClosing] = useState<boolean>(() => {
    return readStoredBrand()?.rules?.persistent?.exclude?.includes("closing") ?? false;
  });
  const [slideSize, setSlideSize] = useState<"16:9" | "9:16">(() => {
    const ss = readStoredBrand()?.slideSize;
    return ss === "9:16" ? "9:16" : "16:9";
  });
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>(() => {
    const m = readStoredBrand()?.slideCount?.mode;
    return m === "match" || m === "custom" ? m : "auto";
  });
  const [slideCountValue, setSlideCountValue] = useState<number>(() => {
    const sc = readStoredBrand()?.slideCount;
    return sc?.mode === "custom" && typeof sc.value === "number" ? sc.value : 8;
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  // ─── Initial load ───────────────────────────────────────────────────────
  // Brand state restoration happens in the useState lazy initializers above;
  // this effect only handles the content navigation guard.
  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    if (!rawContent) {
      router.replace("/create/content");
      return;
    }
    queueMicrotask(() => {
      setContent(JSON.parse(rawContent) as StoredContent);
    });
  }, [router]);

  // Live preview for logo
  useEffect(() => {
    if (!logo) {
      queueMicrotask(() => setLogoPreview(""));
      return;
    }
    const url = URL.createObjectURL(logo);
    queueMicrotask(() => setLogoPreview(url));
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

      const trimmedPersistent = persistentText.trim();
      const exclude = [
        excludeCover ? "cover" : null,
        excludeClosing ? "closing" : null,
      ].filter((value): value is "cover" | "closing" => value !== null);
      const rules = {
        designStyle,
        fixTypos,
        pagination,
        persistent: trimmedPersistent
          ? { text: trimmedPersistent, position: persistentPosition, exclude }
          : null,
      };

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
                position: logoPosition,
                exclude: [
                  logoExcludeCover ? "cover" : null,
                  logoExcludeClosing ? "closing" : null,
                ].filter((value): value is "cover" | "closing" => value !== null),
              }
            : null,
          slideSize,
          slideCount: {
            mode: slideCountMode,
            value: slideCountMode === "custom" ? slideCountValue : null,
          },
          rules,
        }),
      );

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
  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">الهوية البصرية</h1>
        <p className="mt-2 text-[#9A94A8]">
          ألوان علامتك، خطوطها، شعار، وقواعد التوليد — كل ذلك قبل المراجعة النهائية
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ─── LEFT COLUMN ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Generation rules */}
          <div className="glass-card rounded-xl p-6 space-y-6">
            <h2 className="font-semibold text-white">قواعد التوليد</h2>

            <div>
              <p className="mb-2 text-sm text-white">نمط التصميم</p>
              <div className="flex flex-wrap gap-2">
                {DESIGN_STYLE_OPTIONS.map((option) => (
                  <Pill
                    key={option}
                    active={designStyle === option}
                    onClick={() => setDesignStyle(designStyle === option ? null : option)}
                  >
                    {option}
                  </Pill>
                ))}
              </div>
              {designStyle ? (
                <p className="mt-2 text-xs text-muted">سيُصمَّم العرض بأسلوب «{designStyle}».</p>
              ) : (
                <p className="mt-2 text-xs text-muted">اتركها فارغة ليختار كلود الأسلوب المناسب.</p>
              )}
            </div>

            <Toggle
              label="تصحيح الأخطاء الإملائية والنحوية"
              value={fixTypos}
              onChange={setFixTypos}
            />

            <Toggle
              label="ترقيم الشرائح (مثل: 1 / 10)"
              value={pagination}
              onChange={setPagination}
            />

            <div className="space-y-3">
              <p className="text-sm text-white">عنصر ثابت على كل الشرائح</p>
              <input
                type="text"
                value={persistentText}
                onChange={(event) => setPersistentText(event.target.value)}
                placeholder="مثل: التاريخ، الموقع الإلكتروني"
                className="input-dark"
              />
              {persistentText.trim() ? (
                <div className="space-y-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/30 p-4">
                  <div>
                    <p className="mb-2 text-xs text-muted">الموقع</p>
                    <PositionPicker
                      value={persistentPosition}
                      onChange={setPersistentPosition}
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-muted">استثناء</p>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={excludeCover}
                        onClick={() => setExcludeCover((current) => !current)}
                      >
                        صفحة الغلاف
                      </Pill>
                      <Pill
                        active={excludeClosing}
                        onClick={() => setExcludeClosing((current) => !current)}
                      >
                        صفحة الشكر
                      </Pill>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Slide size */}
          <div className="glass-card rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-white">حجم الشريحة</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSlideSize("16:9")}
                className={`cursor-pointer rounded-xl p-4 text-right transition-colors ${selectedClass(slideSize === "16:9")}`}
              >
                <span className="font-semibold text-white">16:9 — أفقي</span>
              </button>
              <button
                type="button"
                onClick={() => setSlideSize("9:16")}
                className={`cursor-pointer rounded-xl p-4 text-right transition-colors ${selectedClass(slideSize === "9:16")}`}
              >
                <span className="font-semibold text-white">9:16 — عمودي</span>
              </button>
            </div>
          </div>

          {/* Slide count */}
          <div className="glass-card rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-white">عدد الشرائح</h2>
            <div className="space-y-3">
              {content?.type === "file" ? (
                <button
                  type="button"
                  onClick={() => setSlideCountMode("match")}
                  className={`w-full cursor-pointer rounded-xl p-3 text-right transition-colors ${selectedClass(slideCountMode === "match")}`}
                >
                  طابق عدد صفحات الملف المرفوع
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSlideCountMode("auto")}
                className={`w-full cursor-pointer rounded-xl p-3 text-right transition-colors ${selectedClass(slideCountMode === "auto")}`}
              >
                اتركها لنا — سنقرر بناءً على المحتوى
              </button>
              <button
                type="button"
                onClick={() => setSlideCountMode("custom")}
                className={`w-full cursor-pointer rounded-xl p-3 text-right transition-colors ${selectedClass(slideCountMode === "custom")}`}
              >
                حدد عدداً
              </button>
              {slideCountMode === "custom" ? (
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={slideCountValue}
                  onChange={(event) => setSlideCountValue(Number(event.target.value))}
                  className="input-dark max-w-32"
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* ─── RIGHT COLUMN ────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Brand colors */}
          <div className="glass-card rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-white">ألوان العلامة التجارية</h2>
              <p className="mt-1 text-xs text-muted">
                ٣ ألوان على الأقل، حتى ٥. كلود يختار لون الخلفية ولون النص تلقائياً ليطابق ألوانك.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPaletteMode("manual")}
                className={`cursor-pointer rounded-xl p-3 text-right text-sm transition-colors ${selectedClass(paletteMode === "manual")}`}
              >
                <span className="font-semibold text-white">اختيار يدوي</span>
              </button>
              <button
                type="button"
                onClick={() => setPaletteMode("screenshot")}
                className={`cursor-pointer rounded-xl p-3 text-right text-sm transition-colors ${selectedClass(paletteMode === "screenshot")}`}
              >
                <span className="font-semibold text-white">رفع لقطة شاشة</span>
              </button>
            </div>

            {paletteMode === "screenshot" ? (
              <CompactUploadZone
                label="ارفع لقطة شاشة"
                accept="image/*"
                file={paletteScreenshot}
                onSelect={setPaletteScreenshot}
              />
            ) : (
              <div className="space-y-3">
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#370BF4]/60 px-3 py-2 text-sm text-white transition-colors hover:bg-[#7D2DFF]/10"
                  >
                    <span className="material-symbols-outlined text-base">add</span>
                    إضافة لون ({colors.length}/{MAX_COLORS})
                  </button>
                ) : (
                  <p className="text-center text-xs text-muted">الحد الأقصى {MAX_COLORS} ألوان</p>
                )}
              </div>
            )}
          </div>

          {/* Fonts */}
          <div className="glass-card rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-white">الخطوط</h2>
              <p className="mt-1 text-xs text-muted">
                ارفع خطوطك الخاصة أو اختر من Google Fonts. اتركها فارغة لاستخدام Arial.
              </p>
            </div>

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
                    label="رفع خط العناوين"
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
                    label="رفع خط النص"
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

          {/* Logo */}
          <div className="glass-card rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-white">الشعار</h2>
            <CompactUploadZone
              label="ارفع الشعار"
              accept=".svg,.png,.jpg,.jpeg"
              file={logo}
              onSelect={setLogo}
            />
            {logo ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/50 px-4 py-3">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoPreview}
                      alt="معاينة الشعار"
                      className="max-h-[60px] max-w-32 object-contain"
                    />
                  ) : (
                    <span className="material-symbols-outlined text-muted">image</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLogo(null)}
                    className="badge-purple flex items-center gap-1"
                  >
                    <span className="text-base leading-none">×</span>
                    إزالة
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-sm text-white">موقع الشعار</p>
                  <PositionPicker value={logoPosition} onChange={setLogoPosition} />
                </div>

                <div className="space-y-3">
                  <p className="text-sm text-white">استثناء الشعار من</p>
                  <div className="flex flex-wrap gap-2">
                    <Pill
                      active={logoExcludeCover}
                      onClick={() => setLogoExcludeCover((current) => !current)}
                    >
                      صفحة الغلاف
                    </Pill>
                    <Pill
                      active={logoExcludeClosing}
                      onClick={() => setLogoExcludeClosing((current) => !current)}
                    >
                      صفحة الشكر
                    </Pill>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-between">
        <button className="btn-outline-dark px-6 py-3" onClick={() => router.back()}>
          → رجوع
        </button>
        <button
          className="btn-gradient inline-flex items-center gap-2 px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleNext}
          disabled={loading}
        >
          {loading ? <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" /> : null}
          التالي ←
        </button>
      </div>
    </section>
  );
}
