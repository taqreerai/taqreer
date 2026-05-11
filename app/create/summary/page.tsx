"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ContentState = {
  type: "file" | "text";
  fileName?: string;
  fileSize?: number;
  storageUrl?: string;
  text?: string;
};
type BrandState = {
  paletteMode: "manual" | "screenshot";
  palette: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  paletteScreenshotUrl?: string | null;
  fonts: {
    useDefaults: boolean;
    heading: { name?: string | null; storageUrl?: string | null; family: string };
    body: { name?: string | null; storageUrl?: string | null; family: string };
  };
  logo: { name: string; storageUrl: string; previewDataUrl?: string | null } | null;
  slideSize: "16:9" | "9:16";
  slideCount: { mode: "match" | "auto" | "custom"; value: number | null };
};

const fallbackBrand: BrandState = {
  paletteMode: "manual",
  palette: {
    primary: "#370BF4",
    secondary: "#E036B8",
    background: "#03030D",
    text: "#FFFFFF",
  },
  fonts: {
    useDefaults: true,
    heading: { name: "Cairo", storageUrl: null, family: "Cairo" },
    body: { name: "Poppins", storageUrl: null, family: "Poppins" },
  },
  logo: null,
  slideSize: "16:9",
  slideCount: { mode: "auto", value: null },
};

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

function Swatch({
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
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="h-12 w-12 rounded-full border border-[rgba(42,36,59,0.8)]"
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
      <span className="text-xs text-[#9A94A8]">{label}</span>
    </div>
  );
}

export default function CreateSummaryPage() {
  const router = useRouter();
  const [content, setContent] = useState<ContentState | null>(null);
  const [brand, setBrand] = useState<BrandState>(fallbackBrand);
  const [outline, setOutline] = useState(["شريحة العنوان", "المقدمة", "النقاط الرئيسية", "الخاتمة"]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loadingMode, setLoadingMode] = useState<"create" | "save" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");

    if (!rawContent || !rawBrand) {
      router.replace("/create/content");
      return;
    }

    queueMicrotask(() => {
      setContent(JSON.parse(rawContent) as ContentState);
      setBrand(JSON.parse(rawBrand) as BrandState);
    });
  }, [router]);

  const persistBrand = (nextBrand: BrandState) => {
    setBrand(nextBrand);
    sessionStorage.setItem("taqreer:create:brand", JSON.stringify(nextBrand));
  };

  const updatePalette = (key: keyof BrandState["palette"], value: string) => {
    persistBrand({
      ...brand,
      palette: {
        ...brand.palette,
        [key]: value,
      },
    });
  };

  const removeOutlineItem = (index: number) => {
    setOutline((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const addOutlineItem = () => {
    setOutline((current) => [...current, "شريحة جديدة"]);
  };

  const resolvedSlideCount =
    brand.slideCount.mode === "custom" && brand.slideCount.value ? brand.slideCount.value : null;

  const displaySlideCount =
    brand.slideCount.mode === "custom" && brand.slideCount.value
      ? String(brand.slideCount.value)
      : brand.slideCount.mode === "match"
        ? "يطابق الملف"
        : "تلقائي";

  const handleGenerate = async (saveBrandKit: boolean) => {
    setError("");
    setLoadingMode(saveBrandKit ? "save" : "create");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          outline,
          saveBrandKit,
          slideCount: resolvedSlideCount,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/create/generating?projectId=${data.projectId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "تعذر بدء الإنشاء. حاول مرة أخرى.");
      setLoadingMode(null);
    }
  };

  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">راجع ملخصك</h1>
        <p className="mt-2 text-[#9A94A8]">تحقق من الإعدادات قبل البدء في التصميم</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="glass-card rounded-xl p-6">
          <h2 className="mb-6 text-[22px] font-bold text-white">الهوية البصرية</h2>
          <div className="flex flex-wrap gap-5">
            <Swatch label="الأساسي" value={brand.palette.primary} onChange={(value) => updatePalette("primary", value)} />
            <Swatch label="الثانوي" value={brand.palette.secondary} onChange={(value) => updatePalette("secondary", value)} />
            <Swatch label="الخلفية" value={brand.palette.background} onChange={(value) => updatePalette("background", value)} />
            <Swatch label="النص" value={brand.palette.text} onChange={(value) => updatePalette("text", value)} />
          </div>

          <div className="divider-dark my-6" />

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm text-[#9A94A8]">خط العناوين</p>
              <p className="text-[24px] font-semibold text-white" style={{ fontFamily: brand.fonts.heading.family }}>
                أبجد هوز حطي كلمن
              </p>
            </div>
            <div>
              <p className="mb-2 text-sm text-[#9A94A8]">خط النص</p>
              <p className="text-[16px] text-white" style={{ fontFamily: brand.fonts.body.family }}>
                The quick brown fox jumps
              </p>
            </div>
          </div>

          {brand.logo ? (
            <div className="mt-6 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 p-4">
              {brand.logo.previewDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo.previewDataUrl} alt="الشعار" className="max-h-12 object-contain" />
              ) : (
                <span className="material-symbols-outlined text-[#9A94A8]">image</span>
              )}
              <p className="mt-2 text-xs text-[#9A94A8]">{brand.logo.name}</p>
            </div>
          ) : null}
        </div>

        <div className="glass-card rounded-xl p-6">
          <h2 className="mb-5 text-[22px] font-bold text-white">محتوى العرض</h2>
          <div className="mb-5">
            {content?.type === "file" ? (
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#7D2DFF]">description</span>
                <div>
                  <p className="font-semibold text-white">{content.fileName}</p>
                  <p className="text-sm text-[#9A94A8]">{formatFileSize(content.fileSize)}</p>
                </div>
              </div>
            ) : (
              <p className="leading-7 text-[#9A94A8]">
                {(content?.text ?? "").slice(0, 150)}
                {(content?.text?.length ?? 0) > 150 ? "..." : ""}
              </p>
            )}
          </div>

          <p className="mb-5 font-semibold text-white">عدد الشرائح: {displaySlideCount}</p>
          <div className="divider-dark mb-5" />

          <div>
            <h3 className="mb-3 text-sm font-semibold text-[#9A94A8]">مخطط الشرائح</h3>
            <div className="space-y-3">
              {outline.map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className="flex items-center gap-3 rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/30 px-4 py-3"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#9A94A8]">drag_indicator</span>
                  <div
                    role="textbox"
                    tabIndex={0}
                    contentEditable={editingIndex === index}
                    suppressContentEditableWarning
                    onClick={() => setEditingIndex(index)}
                    onFocus={() => setEditingIndex(index)}
                    onBlur={(event) => {
                      const nextText = event.currentTarget.textContent?.trim() || item;
                      setOutline((current) => current.map((value, itemIndex) => (itemIndex === index ? nextText : value)));
                      setEditingIndex(null);
                    }}
                    className="min-w-0 flex-1 text-white outline-none focus:border-b focus:border-[#370BF4]"
                  >
                    {item}
                  </div>
                  <button type="button" onClick={() => removeOutlineItem(index)} className="badge-purple">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addOutlineItem} className="mt-4 text-sm text-[#7D2DFF] hover:underline">
              + إضافة شريحة
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          className="btn-outline-dark inline-flex items-center justify-center gap-2 px-8 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => handleGenerate(false)}
          disabled={loadingMode !== null}
        >
          {loadingMode === "create" ? <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" /> : null}
          {loadingMode === "create" ? "جارٍ الإنشاء..." : "إنشاء"}
        </button>
        <button
          className="btn-gradient inline-flex items-center justify-center gap-2 px-8 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => handleGenerate(true)}
          disabled={loadingMode !== null}
        >
          {loadingMode === "save" ? <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" /> : null}
          {loadingMode === "save" ? "جارٍ الإنشاء..." : "إنشاء وحفظ كهوية بصرية ✦"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </section>
  );
}
