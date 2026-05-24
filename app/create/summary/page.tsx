"use client";

// Step 3 — Summary. Restructured 2026-05-19 (was step 4 of 4):
//   Row 1: المحتوى المدخل — spans the full width, inline-EDITABLE
//          (textarea writes back to taqreer:create:content on blur,
//          so the user can fix typos without bouncing back to step 1).
//   Row 2: 2-col grid (2fr / 1fr) → الهوية البصرية + إعدادات الإخراج.
//
// Output settings now live on step 1's bottom row, so the "edit
// إعدادات الإخراج" button jumps to /create/content (not /create/output;
// that route is gone). Edit brand still goes to /create/brand.
//
// The "Generate" CTA POSTs every piece into `/api/projects` — that
// endpoint expects ONE merged brand payload (colours + fonts + logo
// + slide size + slide count + rules + logo placement), so this
// page reads brand + output and stitches them at submit.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateShell } from "@/components/create/CreateShell";
import { PillButton } from "@/components/create/PillButton";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { useFlowPrefix } from "@/components/create/useFlowPrefix";
import {
  DEFAULT_QUALITY,
  isQuality,
  type Quality,
} from "@/lib/types/quality";
import { readSource, clearSource } from "@/lib/types/source";

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
  // User-picked on /create/content (2026-05-20). Drives Project.language
  // + Presentation.direction (ar → rtl, en → ltr). Optional here
  // because legacy stored blobs predate the picker — the consumer
  // falls back to "ar". Note: an earlier-on-2026-05-20 version of the
  // picker had a "bi" bucket which has since been retired; legacy
  // "bi" values collapse to "ar" on read.
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

export default function CreateSummaryPage() {
  const router = useRouter();
  // Route prefix for parallel-flow nav (Phase 17.B). See
  // components/create/useFlowPrefix for the rationale; same page
  // serves both /create/summary and /enhance/summary via the
  // re-export at app/enhance/summary/page.tsx.
  const flowPrefix = useFlowPrefix();
  const [content, setContent] = useState<ContentState | null>(null);
  const [brand, setBrand] = useState<StoredBrand | null>(null);
  const [output, setOutput] = useState<StoredOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Quality preset — pill-selected, persisted to sessionStorage so a
  // page refresh keeps the user's pick. Defaults to "medium" which
  // matches the current backend baseline.
  const [quality, setQualityState] = useState<Quality>(DEFAULT_QUALITY);
  // Content textarea is read-only until the user hits "تعديل" on the
  // المحتوى المدخل card. Stays in-card (no nav) so users can fix
  // typos without losing the brand/output context. Other cards still
  // route to their owning step because their UI doesn't fit inline.
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

  useEffect(() => {
    const rawContent = sessionStorage.getItem("taqreer:create:content");
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");
    const rawOutput = sessionStorage.getItem("taqreer:create:output");
    if (!rawContent || !rawBrand) {
      router.replace(`${flowPrefix}/content`);
      return;
    }
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- "hydrate state from sessionStorage on mount" shape; layout effect lands before paint to avoid flash
      setContent(JSON.parse(rawContent) as ContentState);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrand(JSON.parse(rawBrand) as StoredBrand);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (rawOutput) setOutput(JSON.parse(rawOutput) as StoredOutput);
    } catch {
      // A corrupt session blob would blank the whole summary; bounce
      // to step 1 so the user re-enters from a clean state instead.
      router.replace(`${flowPrefix}/content`);
    }
  }, [router]);

  const handleGenerate = async () => {
    if (!content || !brand) return;
    setError("");
    // The summary editor lets the user clear the textarea, which
    // persists `text: ""` to sessionStorage. Reject empty briefs
    // up front instead of POSTing them to `/api/projects` where
    // they'd produce a blank deck.
    if (content.type === "text" && !content.text?.trim()) {
      setError("لا يمكن إنشاء عرض بدون محتوى. عُد إلى الخطوة الأولى لإدخال النص.");
      return;
    }
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
            // `fixTypos` retired 2026-05-20 — coerce any stale stored
            // value to `false` so the server's prompt path lands on
            // "preserve user text verbatim". The UI no longer exposes
            // the toggle; this default matches the historical
            // off-by-default behavior.
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

      // User-picked content language. Defaults to "ar" if the stored
      // blob predates the picker or carries a legacy "bi" value (which
      // collapses to "ar"). Server tolerates anything off-axis by also
      // falling back to "ar" — language is a UX detail, not a security
      // boundary, so we don't 400 on stale values.
      const language: "ar" | "en" =
        output?.language === "en" ? "en" : "ar";

      // Phase 17.B — forward the SourceMeta blob (if present) to
      // /api/projects. Set by the Enhance / Mimic / Data flows via
      // seedFromExtraction; absent for the regular create flow.
      // /api/projects validates against SourceMetaSchema and
      // downgrades to scratch if invalid — see route.ts.
      const source = readSource();

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
          // Only include when present so create-flow POST shape stays
          // unchanged (no undefined key in the JSON body).
          ...(source ? { source } : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      // Clear sessionStorage so the next visit starts fresh — for
      // both /create and /enhance flows.
      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      sessionStorage.removeItem("taqreer:create:output");
      // Clear the SourceMeta marker too. No-op for create flow (it
      // never wrote one); essential for /enhance so the next visit
      // doesn't re-hydrate stale extraction state.
      clearSource();
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
  // "match" was the file-upload-only mode; dropped 2026-05-19 along
  // with the file-binary submission path. Existing stored blobs with
  // `mode: "match"` fall back to "تلقائي" via the else branch.
  const slideCountLabel =
    output?.slideCount?.mode === "custom" && output.slideCount.value
      ? `${output.slideCount.value} شريحة`
      : "تلقائي";
  const logoPositionLabel =
    output?.logo?.position && POSITION_LABELS[output.logo.position]
      ? POSITION_LABELS[output.logo.position]
      : "غير محدد";

  const bottomBar = (
    <div className="flex items-center justify-between">
      <PillButton
        variant="secondary"
        onClick={() => router.push(`${flowPrefix}/brand`)}
        icon="arrow_forward"
      >
        السابق
      </PillButton>

      {/* Generate split-button — extracted as GenerateSplitButton
          (2026-05-25) so /enhance/content can reuse the exact same
          CTA. Same animated mesh-stroke ring, same preset menu,
          same anchoring above the button. */}
      <GenerateSplitButton
        onGenerate={handleGenerate}
        quality={quality}
        onQualityChange={setQuality}
        slideCount={output?.slideCount?.value ?? undefined}
        loading={loading}
      />
    </div>
  );

  // Phase 17.B-21: /enhance no longer routes through this page —
  // the entire enhance flow is single-shot on /enhance/content. The
  // useFlowPrefix-driven isEnhance branch is dead at /create/summary
  // (nothing navigates here under /enhance/*). Kept the prefix
  // around since it's used for the Previous-button paths.
  const isEnhance = false;

  return (
    <CreateShell
      currentStep="summary"
      title="كل شيء جاهز للإنشاء"
      subtitle="لقد قمنا بجمع البيانات المطلوبة. راجع الملخص أدناه قبل البدء."
      bottomBar={bottomBar}
    >
      {/* No inner wrapper — children render directly into the
          CreateShell column (`flex flex-col gap-4`) so the row→
          buttons gap stays `gap-4`, identical to step 2's. Row 1's
          content card uses `grow` so it absorbs the min-h slack
          (~50 px) instead of leaving an empty band before the
          buttons. */}
      <>
        {/* Row 1 — content, full width, inline-editable. Spans the
            full row instead of sitting in column 1 of the 2-col grid
            below; this matches the relative importance of the brief
            (the deck's content) vs. the supporting brand + output
            cards. */}
        <SummaryCard
          title="المحتوى المدخل"
          icon="description"
          grow
          // For file-based content the textarea wouldn't be useful, so
          // the edit button still routes back to step 1. For pasted
          // text it toggles inline edit mode.
          onEdit={
            content?.type === "file"
              ? () => router.push(`${flowPrefix}/content`)
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
              // Pass the deck language from the stored output blob so
              // the textarea direction matches what the /create/content
              // pill was set to. Legacy blobs without `language` (or
              // with a retired "bi" value) fall through to AR/RTL.
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

        {/* Row 2 — 2-col grid (RTL inherits from parent dir="rtl").
            grid-template-columns: 2fr 1fr makes الهوية البصرية the
            wider card and إعدادات الإخراج the narrower one — the
            "2/1 split" the design ask called for. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <SummaryCard
            title="الهوية البصرية"
            icon="palette"
            // /enhance has no brand step — palette + logo live on
            // /enhance/content. Edit-button bounces there.
            onEdit={() =>
              router.push(
                isEnhance ? `${flowPrefix}/content` : `${flowPrefix}/brand`,
              )
            }
          >
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
                // Brand kits restored from /api/brand-kits hydrate
                // with a signed `storageUrl` but no inline
                // `previewDataUrl` (we dropped the base64 preview to
                // keep rows small — see brand-kits POST). The kit
                // DOES carry a logo; we just don't have a base64
                // thumbnail to render here. Show a confirmation label
                // so the user doesn't think the logo was lost.
                <span className="text-xs text-white/60">تم إرفاق شعار</span>
              ) : (
                <span className="text-xs text-white/40">بدون شعار</span>
              )}
            </div>
          </SummaryCard>

          {/* Output settings card — hidden in /enhance mode where
              slide size + count are auto-derived from the source
              PDF (no edit possible, no value in showing). */}
          {!isEnhance ? (
          <SummaryCard
            title="إعدادات الإخراج"
            icon="tune"
            onEdit={() => router.push(`${flowPrefix}/content`)}
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
          ) : null}
        </div>
      </>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </CreateShell>
  );
}

// One row of the summary stack. Header has the step title + an Edit
// button on the end side. Body is whatever the page passes in.
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
  onEdit: () => void;
  // Label + icon are overridable so the content card can swap to
  // "تم" / check when its inline editor is active. The other summary
  // cards keep the default "تعديل" / edit pencil that routes away.
  editLabel?: string;
  editIcon?: string;
  // When true the card uses `flex-1` so it absorbs the column's
  // min-h slack — used on row 1's content card so the editable
  // textarea expands to fill the page instead of leaving a gap
  // before the next row.
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
        <PillButton variant="ghost" size="sm" onClick={onEdit} icon={editIcon}>
          {editLabel}
        </PillButton>
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

// Inline-editable content textarea for the summary's first card.
// Local draft so each keystroke doesn't churn sessionStorage; commits
// on blur. Word count + verbatim-flag note re-render whenever the
// committed value changes (kept in parent state).
function SummaryContentEditor({
  value,
  keepVerbatim,
  editing,
  language,
  onCommit,
}: {
  value: string;
  keepVerbatim: boolean;
  // Externally-controlled: parent SummaryCard's "تعديل" / "تم" button
  // flips this. Read-only when false; on transition to false we also
  // commit any pending draft.
  editing: boolean;
  // Drives the textarea direction so English content edits land
  // left-aligned. Optional — falls back to "ar" (RTL) for callers
  // that predate the language picker.
  language?: "ar" | "en";
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync if the prop value changes (e.g. parent reloads from
  // storage while we're focused). Only overwrites the draft when the
  // textarea isn't currently being edited — we test that via a ref so
  // the user's in-flight typing isn't clobbered.
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
      // Auto-focus the textarea when the user opens edit mode so the
      // cursor is ready without a second click.
      textareaRef.current?.focus();
    } else if (!editing && wasEditing) {
      // Commit on exit — guard against a no-op write to keep
      // sessionStorage notifications quiet.
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
        // Direction follows the deck language pick so an EN deck's
        // inline content edit reads left-aligned. Matches the
        // /create/content textarea's behavior.
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
