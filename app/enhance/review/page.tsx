"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type EnhancementLevel = "light" | "medium" | "radical";
type SlideCountMode = "match" | "custom";
type UploadState = {
  fileName: string;
  fileSize: number;
  storageUrl: string;
  keepColors: boolean;
  keepFonts: boolean;
  instructions: string;
};

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

export default function EnhanceReviewPage() {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [level, setLevel] = useState<EnhancementLevel>("medium");
  const [brandOpen, setBrandOpen] = useState(false);
  const [palette, setPalette] = useState(defaultPalette);
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("match");
  const [slideCountValue, setSlideCountValue] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("taqreer:enhance:upload");
    if (!raw) {
      router.replace("/enhance");
      return;
    }

    queueMicrotask(() => {
      setUpload(JSON.parse(raw) as UploadState);
    });
  }, [router]);

  const updatePalette = (key: keyof typeof palette, value: string) => {
    setPalette((current) => ({ ...current, [key]: value }));
  };

  const handleGenerate = async () => {
    if (!upload) return;
    setError("");
    setLoading(true);

    try {
      const slideCount = slideCountMode === "custom" ? slideCountValue : null;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "enhance",
          content: {
            type: "file",
            fileName: upload.fileName,
            storageUrl: upload.storageUrl,
            fileSize: upload.fileSize,
          },
          enhance: {
            level,
            keepColors: upload.keepColors,
            keepFonts: upload.keepFonts,
            instructions: upload.instructions,
            slideCountMode,
            slideCountValue: slideCount,
          },
          brand: {
            palette,
            slideSize: "16:9",
            slideCount: { mode: slideCountMode, value: slideCount },
          },
          saveBrandKit: false,
          slideCount,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء مشروع التحسين");
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/create/generating?projectId=${data.projectId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "تعذر بدء التحسين. حاول مرة أخرى.");
      setLoading(false);
    }
  };

  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">راجع إعدادات التحسين</h1>
        <p className="mt-2 text-[#9A94A8]">حدد كيف تريد تحسين عرضك</p>
      </div>

      <div className="glass-card rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#7D2DFF]">description</span>
            <div>
              <p className="font-semibold text-white">{upload?.fileName}</p>
              <p className="text-sm text-[#9A94A8]">{formatFileSize(upload?.fileSize)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/enhance")}
            className="btn-outline-dark px-3 py-1.5 text-sm"
          >
            تغيير الملف
          </button>
        </div>

        <div className="divider-dark" />

        <div>
          <h2 className="mb-3 font-semibold text-white">مستوى التحسين</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { value: "light", label: "تحسين خفيف", subtitle: "تحسين الألوان والتباعد مع الحفاظ على الهيكل" },
              { value: "medium", label: "تحسين متوسط", subtitle: "إعادة تصميم كاملة مع الحفاظ على المحتوى" },
              { value: "radical", label: "تحسين جذري", subtitle: "تصميم جديد تماماً مع إعادة هيكلة المحتوى" },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setLevel(item.value as EnhancementLevel)}
                className={`rounded-xl p-4 text-right transition-colors ${selectedClass(level === item.value)}`}
              >
                <span className="block font-semibold text-white">{item.label}</span>
                <span className="mt-2 block text-sm leading-6 text-[#9A94A8]">{item.subtitle}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="divider-dark" />

        <div>
          <button
            type="button"
            onClick={() => setBrandOpen((current) => !current)}
            className="flex w-full items-center justify-between text-right text-white"
          >
            <span className="font-semibold">الهوية البصرية</span>
            <span className={`material-symbols-outlined text-[20px] text-[#9A94A8] transition-transform ${brandOpen ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${brandOpen ? "max-h-96" : "max-h-0"}`}>
            <div className="flex flex-wrap gap-5 pt-5">
              <Swatch label="الأساسي" value={palette.primary} onChange={(value) => updatePalette("primary", value)} />
              <Swatch label="الثانوي" value={palette.secondary} onChange={(value) => updatePalette("secondary", value)} />
              <Swatch label="الخلفية" value={palette.background} onChange={(value) => updatePalette("background", value)} />
              <Swatch label="النص" value={palette.text} onChange={(value) => updatePalette("text", value)} />
            </div>
          </div>
        </div>

        <div className="divider-dark" />

        <div>
          <h2 className="mb-3 font-semibold text-white">عدد الشرائح</h2>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSlideCountMode("match")}
              className={`w-full rounded-xl p-3 text-right transition-colors ${selectedClass(slideCountMode === "match")}`}
            >
              طابق عدد الشرائح الأصلية
            </button>
            <button
              type="button"
              onClick={() => setSlideCountMode("custom")}
              className={`w-full rounded-xl p-3 text-right transition-colors ${selectedClass(slideCountMode === "custom")}`}
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

        {upload && (upload.keepColors || upload.keepFonts || upload.instructions) ? (
          <>
            <div className="divider-dark" />
            <div className="space-y-3">
              <h2 className="font-semibold text-white">الخيارات المتقدمة</h2>
              <div className="flex flex-wrap gap-2">
                {upload.keepColors ? <span className="badge-purple">الحفاظ على الألوان الأصلية</span> : null}
                {upload.keepFonts ? <span className="badge-purple">الحفاظ على الخطوط الأصلية</span> : null}
              </div>
              {upload.instructions ? <p className="text-sm leading-7 text-[#9A94A8]">{upload.instructions}</p> : null}
            </div>
          </>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.back()} className="btn-outline-dark px-6 py-3">
          ← رجوع
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="btn-gradient inline-flex items-center gap-2 px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" /> : null}
          إنشاء التحسين ✦
        </button>
      </div>
    </section>
  );
}
