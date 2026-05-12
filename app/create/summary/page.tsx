"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ContentState = {
  type: "file" | "text";
  fileName?: string;
  fileSize?: number;
  storageUrl?: string;
  text?: string;
  keepVerbatim?: boolean;
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

type PersistentPosition = "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";

const TONE_OPTIONS = ["رسمي", "احترافي", "تنفيذي", "ودود", "تقني", "تسويقي", "أكاديمي"];

const DESIGN_STYLE_OPTIONS = ["إبداعي", "بسيط", "احترافي", "مرح", "صحفي", "جريء", "كلاسيكي"];

const POSITION_OPTIONS: { value: PersistentPosition; label: string }[] = [
  { value: "auto", label: "اتركها لنا" },
  { value: "top-right", label: "أعلى يمين" },
  { value: "top-left", label: "أعلى يسار" },
  { value: "bottom-right", label: "أسفل يمين" },
  { value: "bottom-left", label: "أسفل يسار" },
];

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

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  // Don't use .btn-gradient on the pill — its padding + border-radius bleed
  // into the toggle geometry. Pull the brand gradient from the design token
  // directly. Knob is anchored at left:0 so its translate-x is unambiguous in
  // any dir context.
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
          value ? "" : "bg-white/10"
        }`}
        style={value ? { backgroundImage: "var(--tq-gradient-brand)" } : undefined}
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
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  // Generation rules — fed into Claude's brief, not the schema.
  const [tone, setTone] = useState<string | null>(null);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  const [fixTypos, setFixTypos] = useState(false);
  const [pagination, setPagination] = useState(true);
  const [persistentText, setPersistentText] = useState("");
  const [persistentPosition, setPersistentPosition] = useState<PersistentPosition>("auto");
  const [excludeCover, setExcludeCover] = useState(false);
  const [excludeClosing, setExcludeClosing] = useState(false);
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

  const startEditContent = () => {
    setContentDraft(content?.text ?? "");
    setEditingContent(true);
  };

  const saveEditContent = () => {
    if (!content) return;
    const next: ContentState = { ...content, text: contentDraft };
    setContent(next);
    sessionStorage.setItem("taqreer:create:content", JSON.stringify(next));
    setEditingContent(false);
  };

  const cancelEditContent = () => {
    setEditingContent(false);
    setContentDraft("");
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
      const trimmedPersistent = persistentText.trim();
      const exclude = [
        excludeCover ? "cover" : null,
        excludeClosing ? "closing" : null,
      ].filter((value): value is "cover" | "closing" => value !== null);
      const rules = {
        tone,
        designStyle,
        fixTypos,
        pagination,
        persistent: trimmedPersistent
          ? { text: trimmedPersistent, position: persistentPosition, exclude }
          : null,
      };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          rules,
          saveBrandKit,
          slideCount: resolvedSlideCount,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/preview/${data.projectId}`);
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

          <div className="divider-dark my-6" />

          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-muted">قواعد التوليد</h3>

            {/* Tone of voice */}
            <div>
              <p className="mb-2 text-sm text-white">نبرة الصوت</p>
              <div className="flex flex-wrap gap-2">
                {TONE_OPTIONS.map((option) => (
                  <Pill
                    key={option}
                    active={tone === option}
                    onClick={() => setTone(tone === option ? null : option)}
                  >
                    {option}
                  </Pill>
                ))}
              </div>
              {tone ? (
                <p className="mt-2 text-xs text-muted">سيُكتب المحتوى بنبرة «{tone}».</p>
              ) : (
                <p className="mt-2 text-xs text-muted">اتركها فارغة لمطابقة المحتوى المقدّم.</p>
              )}
            </div>

            {/* Design style */}
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

            {/* Fix typos */}
            <Toggle
              label="تصحيح الأخطاء الإملائية والنحوية"
              value={fixTypos}
              onChange={setFixTypos}
            />

            {/* Pagination */}
            <Toggle
              label="ترقيم الشرائح (مثل: 1 / 10)"
              value={pagination}
              onChange={setPagination}
            />

            {/* Persistent element */}
            <div className="space-y-3">
              <p className="text-sm text-white">عنصر ثابت على كل الشرائح</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">استثناء:</span>
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
              <input
                type="text"
                value={persistentText}
                onChange={(event) => setPersistentText(event.target.value)}
                placeholder="مثل: التاريخ، الموقع الإلكتروني"
                className="input-dark"
              />
              {persistentText.trim() ? (
                <div className="rounded-xl border border-[rgba(42,36,59,0.8)] bg-[#03030D]/30 p-4">
                  <p className="mb-2 text-xs text-muted">الموقع</p>
                  <div className="flex flex-wrap gap-2">
                    {POSITION_OPTIONS.map((option) => (
                      <Pill
                        key={option.value}
                        active={persistentPosition === option.value}
                        onClick={() => setPersistentPosition(option.value)}
                      >
                        {option.label}
                      </Pill>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-[22px] font-bold text-white">محتوى العرض</h2>
            {content?.type === "text" && !editingContent ? (
              <button
                type="button"
                onClick={startEditContent}
                aria-label="تعديل المحتوى"
                className="inline-flex items-center gap-1 rounded-lg border border-[rgba(42,36,59,0.8)] bg-[#03030D]/40 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                تعديل
              </button>
            ) : null}
          </div>
          <div className="mb-5 space-y-3">
            {content?.type === "file" ? (
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#7D2DFF]">description</span>
                <div>
                  <p className="font-semibold text-white">{content.fileName}</p>
                  <p className="text-sm text-muted">{formatFileSize(content.fileSize)}</p>
                </div>
              </div>
            ) : editingContent ? (
              <>
                <textarea
                  value={contentDraft}
                  onChange={(event) => setContentDraft(event.target.value)}
                  rows={12}
                  className="input-dark w-full resize-y leading-7"
                  dir="rtl"
                  placeholder="اكتب أو الصق محتوى عرضك هنا..."
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveEditContent}
                    className="btn-gradient inline-flex items-center gap-1 px-4 py-2 text-sm"
                  >
                    <span className="material-symbols-outlined text-base">check</span>
                    حفظ
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditContent}
                    className="btn-outline-dark px-4 py-2 text-sm"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            ) : (
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[rgba(42,36,59,0.8)] bg-[#03030D]/30 p-4 text-sm leading-7 text-white">
                {content?.text || <span className="text-muted">لا يوجد محتوى</span>}
              </div>
            )}
          </div>

          <p className="font-semibold text-white">عدد الشرائح: {displaySlideCount}</p>
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
