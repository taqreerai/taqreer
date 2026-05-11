"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PaletteMode = "manual" | "screenshot";
type SlideCountMode = "match" | "auto" | "custom";
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

const defaultPalette = {
  primary: "#370BF4",
  secondary: "#E036B8",
  background: "#03030D",
  text: "#FFFFFF",
};

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

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="settings-card p-4">
      <label className="mb-3 block text-sm text-[#9A94A8]">{label}</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="h-10 w-10 rounded-lg border border-[rgba(42,36,59,0.8)]"
        style={{ backgroundColor: value }}
        aria-label={label}
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="hidden"
      />
    </div>
  );
}

export default function CreateBrandPage() {
  const router = useRouter();
  const [content, setContent] = useState<StoredContent | null>(null);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("manual");
  const [palette, setPalette] = useState(defaultPalette);
  const [paletteScreenshot, setPaletteScreenshot] = useState<File | null>(null);
  const [useDefaultFonts, setUseDefaultFonts] = useState(true);
  const [headingFont, setHeadingFont] = useState<File | null>(null);
  const [bodyFont, setBodyFont] = useState<File | null>(null);
  const [headingFamily, setHeadingFamily] = useState("Cairo");
  const [bodyFamily, setBodyFamily] = useState("Poppins");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [slideSize, setSlideSize] = useState<"16:9" | "9:16">("16:9");
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState(8);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("taqreer:create:content");
    if (!raw) {
      router.replace("/create/content");
      return;
    }

    queueMicrotask(() => {
      setContent(JSON.parse(raw) as StoredContent);
    });
  }, [router]);

  useEffect(() => {
    if (!logo) {
      queueMicrotask(() => setLogoPreview(""));
      return;
    }

    const url = URL.createObjectURL(logo);
    queueMicrotask(() => setLogoPreview(url));
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const injectFont = (file: File, target: "heading" | "body") => {
    const url = URL.createObjectURL(file);
    const family = `Taqreer-${target}-${crypto.randomUUID()}`;
    const style = document.createElement("style");
    style.textContent = `@font-face { font-family: "${family}"; src: url("${url}"); }`;
    document.head.appendChild(style);

    if (target === "heading") setHeadingFamily(family);
    else setBodyFamily(family);
  };

  const handleNext = async () => {
    setError("");
    setLoading(true);

    try {
      const [paletteScreenshotAsset, headingFontAsset, bodyFontAsset, logoAsset, logoPreviewDataUrl] = await Promise.all([
        paletteMode === "screenshot" ? uploadAsset("brand-assets", "palette", paletteScreenshot) : Promise.resolve(null),
        !useDefaultFonts ? uploadAsset("brand-assets", "fonts", headingFont) : Promise.resolve(null),
        !useDefaultFonts ? uploadAsset("brand-assets", "fonts", bodyFont) : Promise.resolve(null),
        uploadAsset("brand-assets", "logos", logo),
        readFileAsDataUrl(logo),
      ]);

      sessionStorage.setItem(
        "taqreer:create:brand",
        JSON.stringify({
          paletteMode,
          palette,
          paletteScreenshotUrl: paletteScreenshotAsset?.storageUrl ?? null,
          fonts: {
            useDefaults: useDefaultFonts,
            heading: {
              name: useDefaultFonts ? "Cairo" : (headingFontAsset?.name ?? headingFont?.name ?? null),
              storageUrl: useDefaultFonts ? null : (headingFontAsset?.storageUrl ?? null),
              family: useDefaultFonts ? "Cairo" : headingFamily,
            },
            body: {
              name: useDefaultFonts ? "Poppins" : (bodyFontAsset?.name ?? bodyFont?.name ?? null),
              storageUrl: useDefaultFonts ? null : (bodyFontAsset?.storageUrl ?? null),
              family: useDefaultFonts ? "Poppins" : bodyFamily,
            },
          },
          logo: logoAsset ? { name: logoAsset.name, storageUrl: logoAsset.storageUrl, previewDataUrl: logoPreviewDataUrl } : null,
          slideSize,
          slideCount: {
            mode: slideCountMode,
            value: slideCountMode === "custom" ? slideCountValue : null,
          },
        })
      );

      router.push("/create/summary");
    } catch (caughtError) {
      console.error("Create brand upload error:", caughtError);
      setError(
        caughtError instanceof Error
          ? `تعذر حفظ ملفات الهوية البصرية: ${caughtError.message}`
          : "تعذر حفظ ملفات الهوية البصرية. حاول مرة أخرى."
      );
      setLoading(false);
    }
  };

  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">الهوية البصرية</h1>
        <p className="mt-2 text-[#9A94A8]">
          حدد ألوان علامتك التجارية وخطوطها لتصميم عرض يعكس هويتك
        </p>
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <h2 className="mb-4 font-semibold text-white">الألوان</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setPaletteMode("screenshot")}
            className={`cursor-pointer rounded-xl p-4 text-right transition-colors ${selectedClass(paletteMode === "screenshot")}`}
          >
            <span className="block font-semibold text-white">رفع لقطة شاشة</span>
            <span className="mt-1 block text-sm text-[#9A94A8]">استخرج الألوان من صورة مرجعية</span>
          </button>
          <button
            type="button"
            onClick={() => setPaletteMode("manual")}
            className={`cursor-pointer rounded-xl p-4 text-right transition-colors ${selectedClass(paletteMode === "manual")}`}
          >
            <span className="block font-semibold text-white">اختيار يدوي</span>
            <span className="mt-1 block text-sm text-[#9A94A8]">حدد الألوان الأساسية للعرض</span>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ColorField
              label="الأساسي"
              value={palette.primary}
              onChange={(value) => setPalette((current) => ({ ...current, primary: value }))}
            />
            <ColorField
              label="الثانوي"
              value={palette.secondary}
              onChange={(value) => setPalette((current) => ({ ...current, secondary: value }))}
            />
            <ColorField
              label="الخلفية"
              value={palette.background}
              onChange={(value) => setPalette((current) => ({ ...current, background: value }))}
            />
            <ColorField
              label="النص"
              value={palette.text}
              onChange={(value) => setPalette((current) => ({ ...current, text: value }))}
            />
          </div>
        )}
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <h2 className="mb-4 font-semibold text-white">الخطوط</h2>
        <label className="flex items-center gap-3 text-sm text-white">
          <input
            type="checkbox"
            checked={useDefaultFonts}
            onChange={(event) => setUseDefaultFonts(event.target.checked)}
            className="h-4 w-4 accent-[#370BF4]"
          />
          استخدم Cairo للعناوين و Poppins للنص
        </label>

        {useDefaultFonts ? (
          <div className="settings-card space-y-2">
            <p className="text-2xl font-semibold text-white">أبجد هوز</p>
            <p className="font-sans text-base text-white">The quick brown fox</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <CompactUploadZone
                label="خط العناوين"
                accept=".woff2,.woff,.ttf,.otf"
                file={headingFont}
                onSelect={(file) => {
                  setHeadingFont(file);
                  injectFont(file, "heading");
                }}
              />
              <p className="mt-3 text-2xl text-white" style={{ fontFamily: headingFamily }}>
                أبجد هوز
              </p>
            </div>
            <div>
              <CompactUploadZone
                label="خط النص"
                accept=".woff2,.woff,.ttf,.otf"
                file={bodyFont}
                onSelect={(file) => {
                  setBodyFont(file);
                  injectFont(file, "body");
                }}
              />
              <p className="mt-3 text-base text-white" style={{ fontFamily: bodyFamily }}>
                The quick brown fox
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <h2 className="mb-4 font-semibold text-white">الشعار</h2>
        <CompactUploadZone label="ارفع الشعار" accept=".svg,.png,.jpg,.jpeg" file={logo} onSelect={setLogo} />
        {logo ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/50 px-4 py-3">
            <div className="flex items-center gap-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="معاينة الشعار" className="max-h-[60px] max-w-24 object-contain" />
              ) : null}
              <p className="font-semibold text-white">{logo.name}</p>
            </div>
            <button type="button" onClick={() => setLogo(null)} className="badge-purple flex items-center gap-1">
              <span className="text-base leading-none">×</span>
              إزالة
            </button>
          </div>
        ) : null}
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <h2 className="mb-4 font-semibold text-white">إعدادات الشريحة</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              max={10}
              value={slideCountValue}
              onChange={(event) => setSlideCountValue(Number(event.target.value))}
              className="input-dark max-w-32"
            />
          ) : null}
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
