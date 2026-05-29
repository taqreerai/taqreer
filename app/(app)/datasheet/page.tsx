"use client";

// Phase 17.E — /datasheet flow (spreadsheet → editorial chart deck).
//
// Architecture mirror: this page is a near-clone of /create's single-
// shot 4-card layout. Everything outside the FIRST card (fonts/colors,
// logo, output settings) is bit-for-bit identical so the unified
// design system from Phase 17.D stays consistent across all flows.
//
// What differs from /create:
//   1. CONTENT CARD ("البيانات" — Data) swaps the upload + textarea
//      positions and changes their semantics:
//        • /create's textarea (primary content input, big)
//          → /datasheet's FILE UPLOAD (primary input, big)
//        • /create's compact dropzone below (alt to text)
//          → /datasheet's instructions textarea below (optional
//            "ركّز على..." steering field)
//      The file is REQUIRED — no "either text OR file" toggle here.
//      Without data there's nothing to chart.
//   2. ACCEPTED FILE TYPES — `.xlsx`, `.xls`, `.csv` (xlsx package
//      handles all three via SheetJS). Not PDF/DOCX/PPTX.
//   3. EXTRACTION PIPELINE — POST to /api/datasheet/parse, NOT
//      /api/extract. The datasheet parse is synchronous (xlsx → markdown
//      tables on the server, no Inngest, no polling). Returns the
//      parsed Markdown payload + sheet count + total rows in one
//      response. Client-side state: `dataMarkdown` instead of
//      `contentAnthropicFileId`.
//   4. SUBMIT PAYLOAD — `source: { kind: "data", markdown, sheetCount,
//      totalRows, truncated, userContext }`. The deck-generate
//      datasheet branch reads markdown directly (no Files API).
//   5. NO TEMPLATE SEED — /datasheet doesn't support "use this
//      template" entry yet. The branding cards still work because
//      the user sets palette/fonts/logo manually like /create.
//
// What stays identical:
//   • The 4-card grid + responsive breakpoints
//   • CardHeader / SegmentedToggle / InlineStepper / Toggle /
//     PositionDropdown / ColorPickerPopover / CompactUploadZone /
//     FontUploadSlot / GoogleFontSlot — same primitives, same props
//   • The branding state machinery (colors, fonts, logo, save-brand-
//     kit toggle, output settings)
//   • GenerateSplitButton + quality presets
//   • All copy outside the content card

import { useEffect, useRef, useState } from "react";
import { ServerStatusBanner } from "@/components/app/ServerStatusBanner";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { LogoUploadSlot } from "@/components/brand/LogoUploadSlot";
import { FontUploadSlot } from "@/components/brand/FontUploadSlot";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  CardHeader,
  PositionDropdown,
  SegmentedToggle,
  Toggle,
  type CornerPosition,
  type LanguageCode,
} from "@/components/create/controls";
import {
  emptyFontSlot,
  googleFontUrl,
  isLatinOnlyGoogleFont,
  HEADING_SAMPLE_AR,
  HEADING_SAMPLE_LATIN,
  BODY_SAMPLE_AR,
  BODY_SAMPLE_LATIN,
  type FontSlotState,
} from "@/lib/brand/fonts";
import { uploadAsset } from "@/lib/brand/upload";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  CREATE_BRAND_KEY,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";

// ─── Constants ────────────────────────────────────────────────────
// 25 MB cap matches /api/datasheet/parse's server-side limit. Lower
// than /create's 100 MB (PDF-friendly) because xlsx in-memory is
// heavier — SheetJS hydrating a 25 MB workbook produces a much
// bigger object graph than a 25 MB PDF parsing through pdfjs.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Same min-height + breakpoint math as /create — all four flows
// share the 4-card row shape. See /create/page.tsx for the viewport
// math; comment retained here for cross-file traceability.
const CARD_MIN_H_CLASS = "min-h-[387px]";

const FONT_MODE_OPTIONS = [
  { value: "upload" as const, label: "ملف" },
  { value: "google" as const, label: "Google" },
];
const SLIDE_COUNT_OPTIONS = [
  { value: "auto" as const, label: "تلقائي" },
  { value: "custom" as const, label: "مخصص" },
];
const LANGUAGE_OPTIONS: { value: LanguageCode; label: string }[] = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "الإنجليزية" },
];

// ─── Helpers ──────────────────────────────────────────────────────
function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} ك.ب`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
}

function readableFileName(raw: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type ResolvedFontField = {
  name: string;
  url: string | null;
  storageUrl: string | null;
  family: string;
} | null;

function resolveFontSlot(
  slot: FontSlotState,
  uploadedStorageUrl: string | null,
): ResolvedFontField {
  if (slot.mode === "google") {
    if (!slot.googleFamily) return null;
    return {
      name: slot.googleFamily,
      url: googleFontUrl(slot.googleFamily),
      storageUrl: null,
      family: slot.googleFamily,
    };
  }
  // Upload mode accepts either a fresh upload's storageUrl OR a
  // hydrated kit's `slot.uploadStorageUrl` (sessionStorage-restored).
  const storageUrl = uploadedStorageUrl ?? slot.uploadStorageUrl ?? null;
  if (!storageUrl) return null;
  const inferredName =
    slot.uploadName ?? slot.uploadFile?.name ?? slot.uploadFamily ?? "Custom font";
  const inferredFamily =
    slot.uploadFamily ||
    slot.uploadFile?.name.replace(/\.[^.]+$/, "") ||
    slot.uploadName?.replace(/\.[^.]+$/, "") ||
    "Custom";
  return {
    name: inferredName,
    url: null,
    storageUrl,
    family: inferredFamily,
  };
}

// ─── Datasheet parse response shape ───────────────────────────────
// Mirrors /api/datasheet/parse's JSON output. Defined inline (not
// imported from the route) because route modules don't export types
// in our setup — the API contract is documented in lib/types/source.
type DatasheetParseResponse = {
  markdown: string;
  sheetCount: number;
  totalRows: number;
  truncated: boolean;
};

export default function DatasheetPage() {
  const router = useRouter();
  const dataInputRef = useRef<HTMLInputElement>(null);

  // ─── Data state ────────────────────────────────────────────────
  // Replaces /create's `contentText` + `contentFile` + `contentFileStage`
  // pairing with file-only state. The instructions textarea is just a
  // plain string (no extraction, no stage machine) because it's pure
  // user steering text, not "content to deliver".
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [dataDragging, setDataDragging] = useState(false);
  type DataFileStage = "idle" | "parsing" | "ready";
  const [dataFileStage, setDataFileStage] = useState<DataFileStage>("idle");
  const [dataParsed, setDataParsed] = useState<DatasheetParseResponse | null>(
    null,
  );
  const [userContext, setUserContext] = useState<string>("");
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [language, setLanguage] = useState<LanguageCode>("ar");

  // ─── Branding state (identical to /create) ─────────────────────
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from brand kit / default kit. See /create's
  // companion state for the rationale.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  const [logoPosition, setLogoPosition] = useState<CornerPosition>("top-right");
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);

  // ─── Brand-kit hydration on first mount ────────────────────────
  // Read taqreer:create:brand sessionStorage (the brand-kits "use"
  // flow writes here). Falls back to the user's default brand kit.
  // Clears the key after applying so refresh doesn't keep
  // re-hydrating. Mirrors /create's effect exactly.
  useEffect(() => {
    let aborted = false;
    (async () => {
      let hydrated = readBrandFromSession();
      if (!hydrated) hydrated = await fetchDefaultBrandKit();
      if (aborted || !hydrated) return;
      if (hydrated.colors.length > 0) setColors(hydrated.colors);
      if (
        hydrated.headingFontSlot.googleFamily ||
        hydrated.headingFontSlot.uploadStorageUrl
      ) {
        setHeadingFontSlot(hydrated.headingFontSlot);
      }
      if (
        hydrated.bodyFontSlot.googleFamily ||
        hydrated.bodyFontSlot.uploadStorageUrl
      ) {
        setBodyFontSlot(hydrated.bodyFontSlot);
      }
      if (hydrated.logo) {
        setLoadedLogo(hydrated.logo);
        const pos = hydrated.logo.position as CornerPosition;
        if (
          pos === "top-left" ||
          pos === "top-center" ||
          pos === "top-right" ||
          pos === "bottom-left" ||
          pos === "bottom-center" ||
          pos === "bottom-right"
        ) {
          setLogoPosition(pos);
        }
        setLogoExcludeCover(hydrated.logo.exclude.includes("cover"));
        setLogoExcludeClosing(hydrated.logo.exclude.includes("closing"));
      }
      try {
        window.sessionStorage.removeItem(CREATE_BRAND_KEY);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // ─── Output / rules state (identical to /create) ───────────────
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);
  const [pagination, setPagination] = useState<boolean>(true);
  const [persistentText, setPersistentText] = useState<string>("");
  const [persistentPosition, setPersistentPosition] =
    useState<CornerPosition>("bottom-center");
  const [persistentExcludeCover, setPersistentExcludeCover] =
    useState<boolean>(false);
  const [persistentExcludeClosing, setPersistentExcludeClosing] =
    useState<boolean>(false);

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // ─── Derived flags ─────────────────────────────────────────────
  // File is REQUIRED here (unlike /create where text OR file
  // satisfies the gate). Generate stays disabled until the parse
  // completes and we have the markdown payload.
  const fileReady =
    dataFile !== null && dataFileStage === "ready" && dataParsed !== null;
  const fileParsing = dataFile !== null && dataFileStage === "parsing";
  const generateDisabled = !fileReady || submitting || fileParsing;
  const generateLoading = submitting || fileParsing;

  // ─── File validation ───────────────────────────────────────────
  const validateFile = (next?: File | null): File | null => {
    if (!next) return null;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls") ||
      lower.endsWith(".csv");
    if (!extOk) {
      setError("الرجاء رفع ملف .xlsx أو .xls أو .csv.");
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `الملف يتجاوز الحد الأقصى 25 ميجابايت (${(next.size / 1024 / 1024).toFixed(1)} م.ب).`,
      );
      return null;
    }
    setError("");
    return next;
  };
  const setDataFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setDataFile(valid);
    setDataParsed(null);
    // Same pattern as /create's content extraction — flip the stage
    // to "parsing" at the call site (not inside useEffect) so the
    // react-hooks/set-state-in-effect lint rule stays quiet.
    setDataFileStage("parsing");
    setError("");
  };
  const removeDataFile = () => {
    setDataFile(null);
    setDataParsed(null);
    setDataFileStage("idle");
    setError("");
    // Reset the hidden <input type="file"> so the user can re-pick
    // the same path. Without this the browser caches the prior value
    // and `onChange` doesn't fire for an identical filename, leaving
    // the user stuck after a parse failure or manual remove.
    // CR #2 (PR #39).
    if (dataInputRef.current) dataInputRef.current.value = "";
  };

  // ─── Auto-parse: data file ─────────────────────────────────────
  // Synchronous server-side parse (no polling like /create's extract
  // pipeline). The POST returns the parsed Markdown directly in the
  // response body — single roundtrip instead of "POST then poll".
  useEffect(() => {
    if (!dataFile) return;
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", dataFile);
        const res = await fetch("/api/datasheet/parse", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `Parse failed (${res.status})`);
        }
        const parsed = (await res.json()) as DatasheetParseResponse;
        if (!isCurrent) return;
        setDataParsed(parsed);
        setDataFileStage("ready");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        if (!isCurrent) return;
        if (isAbort) {
          setDataFileStage("idle");
          return;
        }
        console.error("[datasheet] parse failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "تعذر تحليل الملف. حاول مرة أخرى.",
        );
        setDataFileStage("idle");
        // Also reset the hidden file input on parse-failure so the
        // user can immediately retry with the same file (e.g. after
        // a network blip). See removeDataFile for the rationale.
        // CR #2 (PR #39).
        if (dataInputRef.current) dataInputRef.current.value = "";
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [dataFile]);

  // ─── Palette handlers (identical to /create) ───────────────────
  const updateColor = (index: number, next: string) =>
    setColors((c) => c.map((v, i) => (i === index ? next : v)));
  const addColor = () =>
    setColors((c) => (c.length >= MAX_PALETTE ? c : [...c, "#FFFFFF"]));
  const removeColor = (index: number) =>
    setColors((c) =>
      c.length <= MIN_PALETTE ? c : c.filter((_, i) => i !== index),
    );

  // ─── Submit ────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!fileReady || !dataParsed) return;
    setError("");
    setSubmitting(true);
    try {
      const [logoUploaded, headingUploaded, bodyUploaded] = await Promise.all([
        uploadAsset("brand-assets", "logos", logoFile),
        uploadAsset(
          "brand-assets",
          "fonts",
          headingFontSlot.mode === "upload" ? headingFontSlot.uploadFile : null,
        ),
        uploadAsset(
          "brand-assets",
          "fonts",
          bodyFontSlot.mode === "upload" ? bodyFontSlot.uploadFile : null,
        ),
      ]);

      // /datasheet doesn't send a `content` payload like /create —
      // the user's "content" IS the dataset, which travels through
      // `source.markdown` instead. We still set a stub `content`
      // for symmetry with the /api/projects schema, naming the file
      // so the project title hydration has something to anchor on.
      const content = {
        type: "source" as const,
        fileName: dataFile!.name,
        fileSize: dataFile!.size,
      };

      const headingFont = resolveFontSlot(
        headingFontSlot,
        headingUploaded?.storageUrl ?? null,
      );
      const bodyFont = resolveFontSlot(
        bodyFontSlot,
        bodyUploaded?.storageUrl ?? null,
      );

      const logoExclude = [
        logoExcludeCover ? "cover" : null,
        logoExcludeClosing ? "closing" : null,
      ].filter((v): v is "cover" | "closing" => v !== null);

      const brand = {
        colors,
        paletteMode: "manual" as const,
        paletteScreenshotUrl: null,
        fonts: { heading: headingFont, body: bodyFont },
        // Logo storageUrl resolves to a fresh upload first, then a
        // hydrated kit's stored path. Server re-signs either path.
        logo: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)
          ? {
              storageUrl: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)!,
              position: logoPosition,
              exclude: logoExclude,
            }
          : null,
        slideSize,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      const persistentExclude = [
        persistentExcludeCover ? "cover" : null,
        persistentExcludeClosing ? "closing" : null,
      ].filter((v): v is "cover" | "closing" => v !== null);

      const rules = {
        designStyle: null,
        fixTypos: false,
        pagination,
        persistent: persistentText.trim()
          ? {
              text: persistentText.trim(),
              position: persistentPosition,
              exclude: persistentExclude,
            }
          : null,
      };

      // The source payload — deck-generate's `data` branch reads
      // these fields and inlines the markdown between sentinels in
      // the user message. `truncated` is forwarded so the prompt
      // can warn Claude when the row cap was hit.
      const source = {
        kind: "data" as const,
        markdown: dataParsed.markdown,
        sheetCount: dataParsed.sheetCount,
        totalRows: dataParsed.totalRows,
        truncated: dataParsed.truncated,
        ...(userContext.trim() ? { userContext: userContext.trim() } : {}),
      };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand,
          rules,
          language,
          saveBrandKit,
          slideCount:
            slideCountMode === "custom" ? slideCountValue : null,
          quality,
          source,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/preview/${data.projectId}`);
    } catch (caughtError) {
      console.error("[datasheet] generate failed:", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "تعذر بدء الإنشاء. حاول مرة أخرى.",
      );
      setSubmitting(false);
    }
  };

  const setHeadingMode = (mode: "upload" | "google") =>
    setHeadingFontSlot((s) => ({ ...s, mode }));
  const setBodyMode = (mode: "upload" | "google") =>
    setBodyFontSlot((s) => ({ ...s, mode }));

  return (
    <div className="page-container flex w-full justify-center" dir="rtl">
      <div className="mt-[6vh] flex w-full flex-col items-center gap-6 px-4">
        <ServerStatusBanner />
        <header className="text-center">
          <h1 className="tq-h1">حوّل بياناتك إلى عرض</h1>
          <p className="tq-subhead mt-2">
            ارفع جدول بيانات، اختر هويتك البصرية، وسنحوّله إلى عرض احترافي
            بمخططات واضحة.
          </p>
        </header>

        {/* Same responsive grid as /create — see comments there. */}
        <div className="grid -mx-4 w-[calc(100%+2rem)] grid-cols-1 gap-4 min-[760px]:grid-cols-2 min-[1280px]:grid-cols-4">
          {/* ═══════════════════════════════════════════════════════
              DATA CARD (DOM 1st, visual right)
              ═══════════════════════════════════════════════════════
              Mirrors /create's content card layout structurally but
              SWAPS the upload + textarea positions per the product
              direction 2026-05-26: file is primary (top, big), the
              instructions textarea is the secondary steering input
              (bottom, optional).
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="dataset" title="البيانات" />

            <input
              ref={dataInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => setDataFromInput(event.target.files?.[0])}
            />

            {/* Language label-row + file dropzone grouped into one
                section. The flex-1 wrapper + flex-1 dropzone keeps
                the dropzone growing to fill the card's leftover
                vertical space — same pattern /create uses for its
                textarea. */}
            <div className="flex flex-1 flex-col space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">
                  اللغة
                </span>
                <SegmentedToggle
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                  ariaLabel="لغة العرض"
                />
              </div>

              <DataDropzone
                file={dataFile}
                submitting={submitting}
                parsing={fileParsing}
                parsed={dataParsed}
                dragging={dataDragging}
                setDragging={setDataDragging}
                onOpen={() => dataInputRef.current?.click()}
                onDrop={(f) => setDataFromInput(f)}
                onRemove={removeDataFile}
              />
            </div>

            {/* Instructions textarea — secondary, optional. The
                divider copy mirrors /create's "أو" hairline but
                reads "تعليمات إضافية" because the textarea is NOT
                an alternative to the file (file is required). */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
                <span>تعليمات إضافية</span>
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
              </div>
              <textarea
                value={userContext}
                onChange={(event) => setUserContext(event.target.value)}
                placeholder="مثل: ركّز على الربع الثالث، أبرز الانخفاض في المبيعات…"
                rows={2}
                dir={language === "en" ? "ltr" : "rtl"}
                disabled={submitting}
                className="input-dark min-h-[60px] resize-none text-sm leading-5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              FONTS + COLORS CARD (DOM 2nd) — identical to /create
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="palette" title="الخطوط والألوان" />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white/70">
                الألوان
              </span>
              <div className="flex items-center gap-1.5">
                {colors.map((color, index) => (
                  <InlinePaletteSwatch
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_PALETTE}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                  />
                ))}
                {colors.length < MAX_PALETTE ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label="إضافة لون"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-white/20 text-white/60 transition-colors hover:border-white/40 hover:text-white"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      add
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">
                  خط العناوين
                </span>
                <SegmentedToggle
                  options={FONT_MODE_OPTIONS}
                  value={headingFontSlot.mode}
                  onChange={setHeadingMode}
                  ariaLabel="مصدر خط العناوين"
                />
              </div>
              {headingFontSlot.mode === "upload" ? (
                <FontUploadSlot
                  label="ارفع خط العناوين"
                  file={headingFontSlot.uploadFile}
                  family=""
                  sampleText={HEADING_SAMPLE_AR}
                  sampleSizeClass="text-base"
                  alignStart
                  compact
                  hideSample
                  onSelect={(f) =>
                    setHeadingFontSlot((s) => ({
                      ...s,
                      uploadFile: f,
                      uploadName: f.name,
                    }))
                  }
                  onRemove={() =>
                    setHeadingFontSlot((s) => ({
                      ...s,
                      uploadFile: null,
                      uploadName: null,
                    }))
                  }
                />
              ) : (
                <GoogleFontSlot
                  selected={headingFontSlot.googleFamily}
                  sampleText={
                    isLatinOnlyGoogleFont(headingFontSlot.googleFamily)
                      ? HEADING_SAMPLE_LATIN
                      : HEADING_SAMPLE_AR
                  }
                  sampleSizeClass="text-base"
                  alignStart
                  compact
                  hideSample
                  onSelect={(family) =>
                    setHeadingFontSlot((s) => ({ ...s, googleFamily: family }))
                  }
                />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">
                  خط النص
                </span>
                <SegmentedToggle
                  options={FONT_MODE_OPTIONS}
                  value={bodyFontSlot.mode}
                  onChange={setBodyMode}
                  ariaLabel="مصدر خط النص"
                />
              </div>
              {bodyFontSlot.mode === "upload" ? (
                <FontUploadSlot
                  label="ارفع خط النص"
                  file={bodyFontSlot.uploadFile}
                  family=""
                  sampleText={BODY_SAMPLE_AR}
                  sampleSizeClass="text-sm"
                  alignStart
                  compact
                  hideSample
                  onSelect={(f) =>
                    setBodyFontSlot((s) => ({
                      ...s,
                      uploadFile: f,
                      uploadName: f.name,
                    }))
                  }
                  onRemove={() =>
                    setBodyFontSlot((s) => ({
                      ...s,
                      uploadFile: null,
                      uploadName: null,
                    }))
                  }
                />
              ) : (
                <GoogleFontSlot
                  selected={bodyFontSlot.googleFamily}
                  sampleText={
                    isLatinOnlyGoogleFont(bodyFontSlot.googleFamily)
                      ? BODY_SAMPLE_LATIN
                      : BODY_SAMPLE_AR
                  }
                  sampleSizeClass="text-sm"
                  alignStart
                  compact
                  hideSample
                  onSelect={(family) =>
                    setBodyFontSlot((s) => ({ ...s, googleFamily: family }))
                  }
                />
              )}
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--tq-border-glass)] pt-2">
              <span className="text-xs font-semibold text-white/70">
                حفظ كهوية افتراضية
              </span>
              <Toggle
                ariaLabel="حفظ كهوية افتراضية"
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              LOGO CARD (DOM 3rd) — identical to /create
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="image" title="الشعار" />

            <LogoUploadSlot
              file={logoFile}
              previewUrl={loadedLogo?.displayUrl ?? null}
              onSelect={(f) => {
                setLogoFile(f);
                setLoadedLogo(null);
              }}
              onRemove={() => {
                setLogoFile(null);
                setLoadedLogo(null);
              }}
            />

            <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
              <span className="block text-xs font-semibold text-white/70">
                موضع الشعار
              </span>
              <div className="flex items-center gap-1.5">
                <ExclusionDropdown
                  excludeCover={logoExcludeCover}
                  excludeClosing={logoExcludeClosing}
                  onCoverChange={setLogoExcludeCover}
                  onClosingChange={setLogoExcludeClosing}
                  disabled={!logoFile && !loadedLogo}
                />
                <PositionDropdown
                  value={logoPosition}
                  onChange={setLogoPosition}
                  disabled={!logoFile && !loadedLogo}
                />
              </div>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--tq-border-glass)] pt-2">
              <span className="text-xs font-semibold text-white/70">
                حفظ كهوية افتراضية
              </span>
              <Toggle
                ariaLabel="حفظ كهوية افتراضية"
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              EXPORT SETTINGS CARD (DOM 4th) — identical to /create
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="settings" title="إعدادات الإخراج" />

            <SlideSizeFields
              slideSize={slideSize}
              onSlideSize={setSlideSize}
            />

            <div className="border-t border-[var(--tq-border-glass)] pt-3">
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">
                  عدد الشرائح
                </span>
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="flex items-center gap-1.5"
                >
                  <SegmentedToggle
                    options={SLIDE_COUNT_OPTIONS}
                    value={slideCountMode}
                    onChange={setSlideCountMode}
                    ariaLabel="عدد الشرائح"
                  />
                  <AnimatePresence initial={false}>
                    {slideCountMode === "custom" ? (
                      <motion.div
                        key="slide-count-stepper"
                        initial={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        animate={{ width: 66, opacity: 1, marginInlineStart: 0 }}
                        exit={{ width: 0, opacity: 0, marginInlineStart: -6 }}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 35,
                        }}
                        style={{ overflow: "hidden" }}
                      >
                        <InlineStepper
                          value={slideCountValue}
                          onChange={setSlideCountValue}
                          min={1}
                          max={20}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-glass)] pt-3">
              <span className="text-xs font-semibold text-white/70">
                ترقيم الشرائح
              </span>
              <Toggle
                ariaLabel="ترقيم الشرائح"
                value={pagination}
                onChange={setPagination}
              />
            </div>

            <div className="space-y-1.5 border-t border-[var(--tq-border-glass)] pt-3">
              <span className="block text-xs font-semibold text-white/70">
                عنصر ثابت على كل شريحة
              </span>
              <input
                type="text"
                value={persistentText}
                onChange={(event) => setPersistentText(event.target.value)}
                placeholder="مثل: التاريخ، الموقع الإلكتروني"
                dir={language === "en" ? "ltr" : "rtl"}
                className="input-dark w-full text-xs"
                style={{ height: 30, padding: "0 12px" }}
                aria-label="نص ثابت"
              />
              <div className="flex items-center gap-1.5">
                <ExclusionDropdown
                  excludeCover={persistentExcludeCover}
                  excludeClosing={persistentExcludeClosing}
                  onCoverChange={setPersistentExcludeCover}
                  onClosingChange={setPersistentExcludeClosing}
                  disabled={!persistentText.trim()}
                />
                <PositionDropdown
                  value={persistentPosition}
                  onChange={setPersistentPosition}
                  disabled={!persistentText.trim()}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={slideCountMode === "custom" ? slideCountValue : undefined}
            disabled={generateDisabled}
            loading={generateLoading}
          />
        </div>

        <p
          className="min-h-5 text-center text-sm text-red-400"
          role={error ? "alert" : undefined}
          aria-live={error ? "polite" : undefined}
        >
          {error || " "}
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// ExclusionDropdown — identical copy of /create's helper. Fork rather
// than extract a shared module: the two files are deliberately
// independent so /create and /datasheet can diverge if the product
// direction needs it. Both stay simple to read in isolation.
// ───────────────────────────────────────────────────────────────────
function ExclusionDropdown({
  excludeCover,
  excludeClosing,
  onCoverChange,
  onClosingChange,
  disabled,
}: {
  excludeCover: boolean;
  excludeClosing: boolean;
  onCoverChange: (next: boolean) => void;
  onClosingChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const count = (excludeCover ? 1 : 0) + (excludeClosing ? 1 : 0);
  const label = count > 0 ? `استثناء (${count})` : "استثناء";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`backdrop-blur-glass flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-white/40" : "border-white/15 hover:border-white/30"
        }`}
        style={{
          background: "rgba(255, 255, 255, var(--glass-opacity))",
        }}
      >
        <span
          className={`material-symbols-outlined transition-transform ${
            open ? "rotate-180" : ""
          }`}
          style={{ fontSize: 14 }}
        >
          expand_more
        </span>
        <span className="whitespace-nowrap">{label}</span>
      </button>
      {open ? (
        <div
          className="absolute top-full z-30 mt-1 min-w-[200px] overflow-hidden rounded-xl border p-1 shadow-2xl backdrop-blur-glass bg-[var(--tq-bg-glass)] border-[var(--tq-border-glass)]"
          role="listbox"
          aria-label="استثناء"
        >
          <ExclusionItem
            label="استثناء الغلاف"
            checked={excludeCover}
            onChange={onCoverChange}
          />
          <ExclusionItem
            label="استثناء الشريحة الأخيرة"
            checked={excludeClosing}
            onChange={onClosingChange}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExclusionItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/5"
    >
      <span className="whitespace-nowrap">{label}</span>
      <span
        className={`material-symbols-outlined transition-opacity ${
          checked ? "opacity-100 text-white" : "opacity-0"
        }`}
        style={{ fontSize: 16 }}
      >
        check
      </span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// InlinePaletteSwatch — identical copy of /create's swatch.
// ───────────────────────────────────────────────────────────────────
function InlinePaletteSwatch({
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
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-7 w-7 shrink-0 rounded-md border border-white/15 transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        aria-label={`اللون ${index + 1}`}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label="إزالة اللون"
        className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-0"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 8 }}>
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

// ───────────────────────────────────────────────────────────────────
// DataDropzone — the LARGE upload zone that takes the slot where
// /create's textarea lives. Shares the visual rhythm of /create's
// ContentDropzone (icon + filename/sub-text) but stretches vertically
// via `flex-1` + `h-full` + `min-h-[120px]` to occupy the same
// "primary input" real estate the textarea does in /create.
//
// While parsing: the trigger renders the in-flight filename + a
// "جارٍ التحليل…" sub-label so the user gets immediate feedback.
// On ready: filename + sheet/row count (the "you uploaded ___" line).
// ───────────────────────────────────────────────────────────────────
function DataDropzone({
  file,
  submitting,
  parsing,
  parsed,
  dragging,
  setDragging,
  onOpen,
  onDrop,
  onRemove,
}: {
  file: File | null;
  submitting: boolean;
  parsing: boolean;
  parsed: DatasheetParseResponse | null;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  onOpen: () => void;
  onDrop: (f?: File | null) => void;
  onRemove: () => void;
}) {
  const ready = file !== null && parsed !== null && !parsing;
  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={onOpen}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onDrop(event.dataTransfer.files?.[0]);
        }}
        disabled={submitting}
        className={`flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? "border-white/40 bg-white/[0.04]"
            : "border-white/20 bg-black/20 hover:border-white/30"
        }`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-bg-glass)]">
          <span
            className="material-symbols-outlined text-white/80"
            style={{ fontSize: 22 }}
          >
            {ready ? "table_chart" : parsing ? "hourglass_top" : "cloud_upload"}
          </span>
        </span>

        {ready && file ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {readableFileName(file.name)}
            </p>
            <p className="mt-1 truncate text-[11px] text-white/60">
              {parsed!.sheetCount.toLocaleString()} ورقة ·{" "}
              {parsed!.totalRows.toLocaleString()} صف ·{" "}
              {formatFileSize(file.size)}
              {parsed!.truncated ? " · تم اقتطاع جزء" : ""}
            </p>
          </div>
        ) : parsing && file ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {readableFileName(file.name)}
            </p>
            <p className="mt-1 truncate text-[11px] text-white/60">
              جارٍ التحليل…
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              اسحب أو انقر لرفع جدول بيانات
            </p>
            <p className="mt-1 truncate text-[11px] text-white/40">
              .xlsx / .xls / .csv — حتى 25 ميجابايت
            </p>
          </div>
        )}
      </button>

      {file && !submitting ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label="إزالة الملف"
          className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "16px" }}
          >
            close
          </span>
        </button>
      ) : null}
    </div>
  );
}
