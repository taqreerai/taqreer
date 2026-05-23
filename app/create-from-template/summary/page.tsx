"use client";

// Step 2 of the "create from template" flow.
//
// Forked from /create/summary/page.tsx (2026-05-22, Phase D). Same
// 3-card layout (content / brand / output) and same split-button
// "generate" CTA. Differences from the fork base:
//
//   • Wraps in CreateFromTemplateShell (2-step stepper + pill).
//   • Hides the "edit" affordance on the brand card — the user
//     cannot edit a template's brand from inside the create flow
//     (the brand is what the template IS). They can still see the
//     palette + fonts + logo.
//   • "Previous" / "edit content" / "edit output" all route to
//     /create-from-template/content (the brand step doesn't exist
//     in this flow).
//   • Submits with `sourceTemplateId` so the server can attribute
//     the deck to its source template.
//   • Clears `taqreer:create:templateSeed` alongside the existing
//     sessionStorage clears on successful submit, so a return to
//     /create starts in the normal 3-step flow.
//   • Missing-seed guard: bouncing to /create/content if templateSeed
//     is absent. This page only makes sense as the closing step of
//     the template flow.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CreateFromTemplateShell } from "@/components/create-from-template/CreateFromTemplateShell";
import { PillButton } from "@/components/create/PillButton";
import {
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  estimateMinutes,
  isQuality,
  type Quality,
} from "@/lib/types/quality";
import { readTemplateSeed } from "@/lib/create/seed-from-template";

const QUALITY_KEY = "taqreer:create:quality";

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
  language?: "ar" | "en";
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

export default function CreateFromTemplateSummaryPage() {
  const router = useRouter();
  const [templateTitle, setTemplateTitle] = useState<string | null>(null);
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  const [content, setContent] = useState<ContentState | null>(null);
  const [brand, setBrand] = useState<StoredBrand | null>(null);
  const [output, setOutput] = useState<StoredOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [quality, setQualityState] = useState<Quality>(DEFAULT_QUALITY);
  const [contentEditing, setContentEditing] = useState(false);

  useLayoutEffect(() => {
    const stored = window.sessionStorage.getItem(QUALITY_KEY);
    if (isQuality(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQualityState(stored);
    }
  }, []);

  const setQuality = (q: Quality) => {
    setQualityState(q);
    try {
      window.sessionStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* quota — best-effort persistence */
    }
  };

  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const splitButtonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!presetMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!splitButtonRef.current?.contains(event.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresetMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [presetMenuOpen]);

  useEffect(() => {
    // Seed guard — landing here without a templateSeed means a stale
    // tab / deep link / mid-flow refresh after the seed was cleared.
    // Bounce to the normal create flow so the user has a coherent
    // entry point.
    const seed = readTemplateSeed();
    if (!seed) {
      router.replace("/create/content");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setTemplateTitle(seed.title);
    setSourceTemplateId(seed.id);
    /* eslint-enable react-hooks/set-state-in-effect */

    const rawContent = sessionStorage.getItem("taqreer:create:content");
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");
    const rawOutput = sessionStorage.getItem("taqreer:create:output");
    if (!rawContent || !rawBrand) {
      router.replace("/create-from-template/content");
      return;
    }
    try {
      setContent(JSON.parse(rawContent) as ContentState);
      setBrand(JSON.parse(rawBrand) as StoredBrand);
      if (rawOutput) setOutput(JSON.parse(rawOutput) as StoredOutput);
    } catch {
      router.replace("/create-from-template/content");
    }
  }, [router]);

  const handleGenerate = async () => {
    if (!content || !brand) return;
    setError("");
    if (content.type === "text" && !content.text?.trim()) {
      setError("لا يمكن إنشاء عرض بدون محتوى. عُد إلى الخطوة الأولى لإدخال النص.");
      return;
    }
    setLoading(true);
    try {
      // Same stitching as /create/summary — wire compatibility means
      // the API stays oblivious to which flow produced the payload.
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
            fixTypos: false,
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

      const language: "ar" | "en" =
        output?.language === "en" ? "en" : "ar";

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand: mergedBrand,
          rules,
          language,
          saveBrandKit: false,
          slideCount: resolvedSlideCount,
          quality,
          // Phase D attribution — API ignores unknown fields if it
          // hasn't been updated to read this yet, so wire-safe.
          sourceTemplateId,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      // Clear all create-flow sessionStorage including the template
      // seed so the next /create visit starts in normal 3-step mode.
      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      sessionStorage.removeItem("taqreer:create:output");
      sessionStorage.removeItem("taqreer:create:templateSeed");
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

  const slideSizeLabel =
    output?.slideSize === "9:16" ? "9:16 — عمودي" : "16:9 — أفقي";
  const slideCountLabel =
    output?.slideCount?.mode === "custom" && output.slideCount.value
      ? `${output.slideCount.value} شريحة`
      : "تلقائي";
  const logoPositionLabel =
    output?.logo?.position && POSITION_LABELS[output.logo.position]
      ? POSITION_LABELS[output.logo.position]
      : "غير محدد";

  // Don't render the shell while we're still verifying the seed —
  // flashing a pill with an empty title before the redirect would be
  // ugly.
  if (templateTitle === null) {
    return null;
  }

  const bottomBar = (
    <div className="flex items-center justify-between">
      <PillButton
        variant="secondary"
        onClick={() => router.push("/create-from-template/content")}
        icon="arrow_forward"
      >
        السابق
      </PillButton>

      {/* Generate split-button — identical to /create/summary's */}
      <div ref={splitButtonRef} className="relative">
        <div
          dir="ltr"
          className="btn-gradient-anim flex h-11 items-stretch transition-shadow"
          style={{ borderRadius: 9999 }}
        >
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            aria-label="إنشاء"
            className="relative inline-flex items-center justify-center gap-2 bg-transparent px-6 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderRadius: "9999px 0 0 9999px" }}
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
          <span
            aria-hidden
            className="my-2 w-px"
            style={{
              background: "var(--tq-border-glass)",
            }}
          />
          <button
            type="button"
            onClick={() => setPresetMenuOpen((v) => !v)}
            disabled={loading}
            aria-label={presetMenuOpen ? "إغلاق قائمة الجودة" : "اختيار جودة"}
            aria-expanded={presetMenuOpen}
            className="relative inline-flex w-10 items-center justify-center bg-transparent text-white disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderRadius: "0 9999px 9999px 0" }}
          >
            <span
              className={`material-symbols-outlined leading-none transition-transform ${
                presetMenuOpen ? "rotate-180" : ""
              }`}
              style={{ fontSize: 18 }}
            >
              expand_less
            </span>
          </button>
        </div>

        <AnimatePresence>
          {presetMenuOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 4 }}
              transition={{ type: "spring", bounce: 0.25, duration: 0.25 }}
              dir="rtl"
              className="backdrop-blur-glass absolute right-0 bottom-full z-30 mb-2 w-56 overflow-hidden rounded-2xl border shadow-2xl"
              style={{
                background: "var(--tq-bg-glass)",
                borderColor: "var(--tq-border-glass)",
              }}
            >
              <div className="px-3 py-2 text-[11px] text-white/40">
                جودة التوليد
              </div>
              {QUALITY_PRESETS.map((preset) => {
                const slideCount =
                  output?.slideCount?.value && output.slideCount.value > 0
                    ? output.slideCount.value
                    : 8;
                const eta = estimateMinutes(preset.key, slideCount);
                const active = quality === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => {
                      setQuality(preset.key);
                      setPresetMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm transition-colors ${
                      active
                        ? "bg-white/[0.06] text-white"
                        : "text-white/70 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="material-symbols-outlined leading-none"
                        style={{ fontSize: 16, opacity: active ? 1 : 0 }}
                      >
                        check
                      </span>
                      <span>{preset.label}</span>
                    </span>
                    <span className="text-[11px] text-white/40" dir="ltr">
                      ~{eta} د
                    </span>
                  </button>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );

  return (
    <CreateFromTemplateShell
      currentStep="summary"
      title="كل شيء جاهز للإنشاء"
      subtitle="لقد قمنا بجمع البيانات المطلوبة. راجع الملخص أدناه قبل البدء."
      templateTitle={templateTitle}
      bottomBar={bottomBar}
    >
      <>
        <SummaryCard
          title="المحتوى المدخل"
          icon="description"
          grow
          onEdit={
            content?.type === "file"
              ? () => router.push("/create-from-template/content")
              : () => setContentEditing((v) => !v)
          }
          editLabel={
            content?.type === "file" ? "تعديل" : contentEditing ? "تم" : "تعديل"
          }
          editIcon={
            content?.type === "file" ? "edit" : contentEditing ? "check" : "edit"
          }
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
            <SummaryContentEditor
              value={content?.text ?? ""}
              keepVerbatim={content?.keepVerbatim !== false}
              editing={contentEditing}
              language={output?.language === "en" ? "en" : "ar"}
              onCommit={(next) => {
                if (!content) return;
                const updated: ContentState = { ...content, text: next };
                setContent(updated);
                try {
                  window.sessionStorage.setItem(
                    "taqreer:create:content",
                    JSON.stringify(updated),
                  );
                } catch {
                  /* storage blocked — keep in-memory edit */
                }
              }}
            />
          )}
        </SummaryCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          {/* Brand card — NO edit affordance. The brand is fixed by
              the source template; if the user wants different
              colours/fonts they need a different template (or the
              normal flow). */}
          <SummaryCard title="الهوية البصرية" icon="palette">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-1 flex-col gap-2 min-w-0">
                {brand?.colors && brand.colors.length > 0 ? (
                  <div className="flex items-center gap-2">
                    {brand.colors.map((c, i) => (
                      <span
                        key={i}
                        className="h-9 w-9 rounded-lg border border-white/10"
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
              ) : brand?.logo?.storageUrl ? (
                <span className="text-xs text-white/60">تم إرفاق شعار</span>
              ) : (
                <span className="text-xs text-white/40">بدون شعار</span>
              )}
            </div>
          </SummaryCard>

          <SummaryCard
            title="إعدادات الإخراج"
            icon="tune"
            onEdit={() => router.push("/create-from-template/content")}
          >
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs">
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
                <div className="pt-1">
                  <span className="text-white/40">عنصر ثابت: </span>
                  <span className="text-white/80">{output.rules.persistent.text}</span>
                </div>
              ) : null}
            </div>
          </SummaryCard>
        </div>
      </>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </CreateFromTemplateShell>
  );
}

// ─── SummaryCard / SummaryStat ───────────────────────────────────────
//
// Forked from /create/summary's locals. Only meaningful diff: `onEdit`
// is now OPTIONAL — the brand card on this flow has no edit
// affordance (see comment on its render site).

function SummaryCard({
  title,
  icon,
  onEdit,
  editLabel = "تعديل",
  editIcon = "edit",
  grow = false,
  children,
}: {
  title: string;
  icon: string;
  onEdit?: () => void;
  editLabel?: string;
  editIcon?: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`glass-card flex ${grow ? "flex-1 " : ""}flex-col gap-3 rounded-2xl p-5`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: "18px" }}
          >
            {icon}
          </span>
          {title}
        </h2>
        {onEdit ? (
          <PillButton variant="ghost" size="sm" onClick={onEdit} icon={editIcon}>
            {editLabel}
          </PillButton>
        ) : null}
      </header>
      <div className={`text-sm text-white/80 ${grow ? "flex flex-1 flex-col" : ""}`}>
        {children}
      </div>
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

// Inline-editable content textarea — same shape as /create/summary's
// SummaryContentEditor. Duplicated so the normal flow stays untouched.
function SummaryContentEditor({
  value,
  keepVerbatim,
  editing,
  language,
  onCommit,
}: {
  value: string;
  keepVerbatim: boolean;
  editing: boolean;
  language?: "ar" | "en";
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevEditingRef = useRef(editing);
  useEffect(() => {
    const wasEditing = prevEditingRef.current;
    prevEditingRef.current = editing;
    if (editing && !wasEditing) {
      textareaRef.current?.focus();
    } else if (!editing && wasEditing) {
      editingRef.current = false;
      if (draft !== value) onCommit(draft);
    }
  }, [editing, draft, value, onCommit]);
  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="flex flex-1 flex-col gap-1">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          editingRef.current = true;
        }}
        onBlur={() => {
          editingRef.current = false;
          if (draft !== value) onCommit(draft);
        }}
        readOnly={!editing}
        dir={language === "en" ? "ltr" : "rtl"}
        placeholder="اكتب أو الصق محتوى عرضك هنا..."
        className={`input-dark min-h-[200px] flex-1 resize-none leading-7 ${
          editing ? "" : "cursor-default opacity-90"
        }`}
        maxLength={50000}
      />
      <p className="text-xs text-white/50">
        {wordCount > 0 ? `${wordCount} كلمة` : ""}
        {!keepVerbatim ? " · سيُعاد تنظيمه" : ""}
      </p>
    </div>
  );
}
