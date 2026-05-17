"use client";

// Step 4 — Summary. Three stacked cards, one per previous step,
// each with an Edit button that jumps back to that step (state
// preserved via sessionStorage). The "Generate" CTA POSTs every
// piece into `/api/projects` — that endpoint expects ONE merged
// brand payload (colours + fonts + logo + slide size + slide
// count + rules + logo placement), so this page reads brand +
// output and stitches them at submit.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";

type ContentState = {
  type: "file" | "text";
  fileName?: string;
  fileSize?: number;
  storageUrl?: string;
  text?: string;
  keepVerbatim?: boolean;
};

type StoredBrand = {
  colors?: string[];
  paletteMode?: string;
  paletteScreenshotUrl?: string | null;
  fonts?: {
    heading?: { name?: string | null; url?: string | null; storageUrl?: string | null };
    body?: { name?: string | null; url?: string | null; storageUrl?: string | null };
  };
  logo?: {
    name?: string | null;
    storageUrl?: string | null;
    previewDataUrl?: string | null;
  } | null;
};

type StoredOutput = {
  slideSize?: "16:9" | "9:16";
  slideCount?: { mode?: "match" | "auto" | "custom"; value?: number | null };
  logo?: {
    position?: string;
    excludeCover?: boolean;
    excludeClosing?: boolean;
  };
  rules?: {
    designStyle?: string | null;
    fixTypos?: boolean;
    pagination?: boolean;
    persistent?: {
      text?: string;
      position?: string;
      excludeCover?: boolean;
      excludeClosing?: boolean;
    } | null;
  };
};

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

function readableFileName(raw: string | undefined): string {
  if (!raw) return "";
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const POSITION_LABELS: Record<string, string> = {
  "top-left": "أعلى يسار",
  "top-center": "أعلى الوسط",
  "top-right": "أعلى يمين",
  "bottom-left": "أسفل يسار",
  "bottom-center": "أسفل الوسط",
  "bottom-right": "أسفل يمين",
};

export default function CreateSummaryPage() {
  const router = useRouter();
  const [content, setContent] = useState<ContentState | null>(null);
  const [brand, setBrand] = useState<StoredBrand | null>(null);
  const [output, setOutput] = useState<StoredOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");
    const rawOutput = sessionStorage.getItem("taqreer:create:output");
    if (!rawContent || !rawBrand) {
      router.replace("/create/content");
      return;
    }
    setContent(JSON.parse(rawContent) as ContentState);
    setBrand(JSON.parse(rawBrand) as StoredBrand);
    if (rawOutput) setOutput(JSON.parse(rawOutput) as StoredOutput);
  }, [router]);

  const handleGenerate = async () => {
    if (!content || !brand) return;
    setError("");
    setLoading(true);
    try {
      // Stitch brand + output into the legacy "brand" payload Claude
      // expects: logo carries position + exclude as the API has
      // always seen it; slide size, slide count, and rules live at
      // the brand root (where /api/projects + the inngest brief
      // builder already look). Future cleanup could split these into
      // their own top-level fields in the request body; for now we
      // keep wire compatibility.
      const logoExclude = output?.logo
        ? [
            output.logo.excludeCover ? "cover" : null,
            output.logo.excludeClosing ? "closing" : null,
          ].filter((v): v is "cover" | "closing" => v !== null)
        : [];
      const persistent = output?.rules?.persistent;
      const persistentExclude = persistent
        ? [
            persistent.excludeCover ? "cover" : null,
            persistent.excludeClosing ? "closing" : null,
          ].filter((v): v is "cover" | "closing" => v !== null)
        : [];

      const mergedBrand = {
        colors: brand.colors,
        paletteMode: brand.paletteMode,
        paletteScreenshotUrl: brand.paletteScreenshotUrl,
        fonts: brand.fonts,
        logo: brand.logo
          ? {
              ...brand.logo,
              position: output?.logo?.position ?? "top-right",
              exclude: logoExclude,
            }
          : null,
        slideSize: output?.slideSize ?? "16:9",
        slideCount: output?.slideCount ?? { mode: "auto", value: null },
      };

      const rules = output?.rules
        ? {
            designStyle: output.rules.designStyle ?? null,
            fixTypos: Boolean(output.rules.fixTypos),
            pagination: output.rules.pagination !== false,
            persistent: persistent?.text
              ? {
                  text: persistent.text,
                  position: persistent.position ?? "bottom-center",
                  exclude: persistentExclude,
                }
              : null,
          }
        : null;

      const resolvedSlideCount =
        output?.slideCount?.mode === "custom" && output.slideCount.value
          ? output.slideCount.value
          : null;

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand: mergedBrand,
          rules,
          saveBrandKit: false,
          slideCount: resolvedSlideCount,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      // Clear sessionStorage so the next "create new" starts fresh.
      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      sessionStorage.removeItem("taqreer:create:output");
      router.push(`/preview/${data.projectId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "تعذر بدء الإنشاء. حاول مرة أخرى.",
      );
      setLoading(false);
    }
  };

  // Pre-compute display strings so the cards don't ternary their
  // way through three layers of undefined.
  const slideSizeLabel =
    output?.slideSize === "9:16" ? "9:16 — عمودي" : "16:9 — أفقي";
  const slideCountLabel =
    output?.slideCount?.mode === "custom" && output.slideCount.value
      ? `${output.slideCount.value} شريحة`
      : output?.slideCount?.mode === "match"
        ? "يطابق الملف"
        : "تلقائي";
  const logoPositionLabel =
    output?.logo?.position && POSITION_LABELS[output.logo.position]
      ? POSITION_LABELS[output.logo.position]
      : "غير محدد";

  return (
    <CreateShell
      currentStep="summary"
      title="كل شيء جاهز للإنشاء"
      subtitle="لقد قمنا بجمع البيانات المطلوبة. راجع الملخص أدناه قبل البدء."
    >
      <div className="flex flex-col gap-4">
        <SummaryCard
          title="المحتوى المدخل"
          icon="description"
          onEdit={() => router.push("/create/content")}
        >
          {content?.type === "file" ? (
            <div>
              <p className="text-sm font-semibold text-white">
                {readableFileName(content.fileName)}
              </p>
              <p className="text-xs text-white/50">
                {formatFileSize(content.fileSize)}
                {content.keepVerbatim === false ? " · سيُعاد تنظيمه" : ""}
              </p>
            </div>
          ) : (
            <div>
              <p className="line-clamp-2 text-sm text-white/80 leading-relaxed">
                {content?.text || "لا يوجد محتوى"}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {content?.text ? `${content.text.trim().split(/\s+/).filter(Boolean).length} كلمة` : ""}
                {content?.keepVerbatim === false ? " · سيُعاد تنظيمه" : ""}
              </p>
            </div>
          )}
        </SummaryCard>

        <SummaryCard
          title="الهوية البصرية"
          icon="palette"
          onEdit={() => router.push("/create/brand")}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-1 flex-col gap-2 min-w-0">
              {brand?.colors && brand.colors.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  {brand.colors.map((c, i) => (
                    <span
                      key={i}
                      className="h-5 w-5 rounded-md border border-white/10"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-white/60">
                {brand?.fonts?.heading?.name ?? "خط افتراضي"}
                {" · "}
                {brand?.fonts?.body?.name ?? "خط افتراضي"}
              </p>
            </div>
            {brand?.logo?.previewDataUrl ? (
              <span
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5"
                style={{
                  backgroundImage: `url(${brand.logo.previewDataUrl})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }}
                aria-label="الشعار"
              />
            ) : (
              <span className="text-xs text-white/40">بدون شعار</span>
            )}
          </div>
        </SummaryCard>

        <SummaryCard
          title="إعدادات الإخراج"
          icon="tune"
          onEdit={() => router.push("/create/output")}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <SummaryStat label="حجم الشريحة" value={slideSizeLabel} />
            <SummaryStat label="عدد الشرائح" value={slideCountLabel} />
            <SummaryStat
              label="موقع الشعار"
              value={brand?.logo ? logoPositionLabel : "بدون شعار"}
            />
            <SummaryStat
              label="نمط التصميم"
              value={output?.rules?.designStyle ?? "تلقائي"}
            />
            {output?.rules?.persistent?.text ? (
              <div className="col-span-2 pt-1">
                <span className="text-white/40">عنصر ثابت: </span>
                <span className="text-white/80">{output.rules.persistent.text}</span>
              </div>
            ) : null}
          </div>
        </SummaryCard>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex items-center justify-between pt-2">
        <PillButton
          variant="secondary"
          onClick={() => router.push("/create/output")}
          icon="arrow_forward"
        >
          السابق
        </PillButton>
        {/* Generate CTA — reuses `.btn-gradient-anim` (the animated
            mesh-gradient ring + full-fill on hover used by the deck's
            regen button in the slide-preview toolbar). Pill shape via
            inline `borderRadius: 9999` since `.btn-gradient-anim`
            ships with no border-radius rule and inheriting from the
            class would tie the shape to the regen square. */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          aria-label="إنشاء"
          className="btn-gradient-anim relative inline-flex h-11 items-center justify-center gap-2 px-6 text-sm font-medium transition-shadow disabled:cursor-not-allowed"
          style={{ borderRadius: 9999 }}
        >
          {loading ? (
            <span className="spinner h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <span
              className="material-symbols-outlined leading-none"
              style={{ fontSize: 18 }}
            >
              auto_awesome
            </span>
          )}
          <span>{loading ? "جارٍ الإنشاء..." : "إنشاء"}</span>
        </button>
      </div>
    </CreateShell>
  );
}

// One row of the summary stack. Header has the step title + an Edit
// button on the end side. Body is whatever the page passes in.
function SummaryCard({
  title,
  icon,
  onEdit,
  children,
}: {
  title: string;
  icon: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span
            className="material-symbols-outlined text-[#7D2DFF]"
            style={{ fontSize: "18px" }}
          >
            {icon}
          </span>
          {title}
        </h2>
        <PillButton variant="ghost" size="sm" onClick={onEdit} icon="edit">
          تعديل
        </PillButton>
      </header>
      <div className="text-sm text-white/80">{children}</div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/40">{label}:</span>
      <span className="text-white/90">{value}</span>
    </div>
  );
}
