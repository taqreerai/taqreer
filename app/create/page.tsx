"use client";

// Phase 17.D — Single-shot /create flow (replaces /create/content +
// /create/brand + /create/summary + the stepper chrome).
//
// Mirrors /mimic + /enhance's pattern: 3 cards in a row, generate
// split-button below, no per-step routing.
//
// What got dropped (explicit user direction 2026-05-25):
//   • Design-style pills (إبداعي / بسيط / احترافي / مرح / صحفي / جريء)
//
// What got combined:
//   • Heading font + body font sit side-by-side in one row (each
//     half-width inside the branding card)
//   • Logo upload uses CompactUploadZone's horizontal mode (icon
//     right + label left + sub-text)
//   • Persistent text: input on row 1, position picker + exclude
//     cover/closing toggles on row 2 (matches the legacy /create
//     output card layout)
//   • Language pills sit inline with the textarea (label right,
//     pills left)
//   • Ratio (16:9 / 9:16) sits in the OUTPUT card alongside slide
//     count + pagination + persistent overlay
//
// What got migrated to the SegmentedToggle primitive:
//   • Font slot mode (ملف / Google)
//   • Slide count mode (تلقائي / مخصص)
//
// Card titles all carry an icon + bottom hairline separator (same
// pattern the legacy CardShell used) so the cards read as a
// labelled cluster, not a wall of inputs.
//
// Template seeding: when the user arrives via "Use this template",
// lib/create/seed-from-template.ts writes a `taqreer:create:template
// Seed` blob to sessionStorage. We read it on mount and pre-fill
// the branding card (palette + fonts).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { LogoUploadSlot } from "@/components/brand/LogoUploadSlot";
import { FontUploadSlot } from "@/components/brand/FontUploadSlot";
import { GoogleFontSlot } from "@/components/brand/GoogleFontSlot";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  CardHeader,
  ExclusionDropdown,
  InlinePaletteSwatch,
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
import { readTemplateSeed } from "@/lib/create/seed-from-template";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  CREATE_BRAND_KEY,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";

// ─── Constants ────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
// Extraction polling — file uploads on /create route through the
// shared /api/extract pipeline (Anthropic Files API upload), just
// like /enhance + /mimic. Pre-fix the file was selected but never
// posted to extract: the Generate call sent { type: "source",
// fileName, fileSize } with no actual document bytes, so the
// upload path was a no-op (CR critical 2026-05-26). Polling shape
// + intervals mirror /enhance for consistency.
const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;
const DEFAULT_PALETTE = ["#000000", "#FFFFFF"];

// Cards use a responsive grid with `auto-fit` + `minmax(280px, 1fr)`
// instead of fixed widths. Math at common viewports:
//   • 1440 viewport, ~1184 content row → 4 cards at ~284 px each
//   • 1100 → 2×2, each card ~530 px
//   • 760  → 2×2 at ~360 px
//   • 540  → 1 column at 280 px floor
// Cards stretch to fill row when fewer than 4 fit, capping at 1fr
// share so they never leave gutters on either edge. /enhance + /mimic
// keep their fixed-width 360 px cards (fewer of them per row).
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
  // Upload mode resolves with either a fresh upload's storageUrl
  // OR a hydrated slot's `uploadStorageUrl` (from a brand kit) —
  // both point at the same bucket, so the brief can re-sign
  // identically. Without this fallback a hydrated kit's font
  // slot would silently drop on submit.
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

export default function CreatePage() {
  const router = useRouter();
  const contentInputRef = useRef<HTMLInputElement>(null);

  // ─── Content state ─────────────────────────────────────────────
  const [contentText, setContentText] = useState<string>("");
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [contentDragging, setContentDragging] = useState(false);
  // File-upload extraction state. When the user picks a content
  // file we POST to /api/extract → poll until "completed" → save
  // the anthropicFileId for the brief. Mirrors /enhance + /mimic.
  type ContentFileStage = "idle" | "extracting" | "ready";
  const [contentFileStage, setContentFileStage] =
    useState<ContentFileStage>("idle");
  const [contentAnthropicFileId, setContentAnthropicFileId] = useState<
    string | null
  >(null);
  // Slide size now lives in the OUTPUT card (alongside slide count
  // + pagination + persistent overlay). Language stays close to the
  // textarea since it modulates the typed content directly.
  const [slideSize, setSlideSize] = useState<SlideSize>("16:9");
  const [language, setLanguage] = useState<LanguageCode>("ar");

  // ─── Branding state ────────────────────────────────────────────
  const [colors, setColors] = useState<string[]>(DEFAULT_PALETTE);
  const [headingFontSlot, setHeadingFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [bodyFontSlot, setBodyFontSlot] = useState<FontSlotState>(
    emptyFontSlot(),
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from a brand kit (or default kit). When set,
  // the LogoUploadSlot shows the remote SVG via `previewUrl`; the
  // submit pipeline passes the storageUrl through without
  // re-uploading. Cleared if the user picks a fresh file via the
  // logo's onRemove → onSelect cycle.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  const [logoPosition, setLogoPosition] = useState<CornerPosition>("top-right");
  // Logo cover / closing excludes — same toggles the legacy /create
  // had on the logo card. Server reads brand.logo.exclude to skip
  // the mark on cover/closing slides.
  const [logoExcludeCover, setLogoExcludeCover] = useState<boolean>(false);
  const [logoExcludeClosing, setLogoExcludeClosing] = useState<boolean>(false);
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);

  // ─── Template seed (when arriving from "Use this template") ────
  const [templateSeedTitle, setTemplateSeedTitle] = useState<string | null>(
    null,
  );
  const [templateSeedId, setTemplateSeedId] = useState<string | null>(null);
  useEffect(() => {
    const seed = readTemplateSeed();
    if (!seed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical "hydrate component state from a one-shot session-storage marker on mount" shape; only fires once per page load
    setTemplateSeedId(seed.id);
     
    setTemplateSeedTitle(seed.title);
     
    setColors(seed.brand.palette.length > 0 ? seed.brand.palette : DEFAULT_PALETTE);
     
    setSlideSize(seed.brand.format);
     
    setLanguage(seed.brand.language === "en" ? "en" : "ar");
    if (seed.brand.fontHeading?.name) {
       
      setHeadingFontSlot({
        mode: "google",
        googleFamily: seed.brand.fontHeading.name,
        uploadFile: null,
        uploadName: null,
        uploadStorageUrl: null,
        uploadFamily: "",
      });
    }
    if (seed.brand.fontBody?.name) {
       
      setBodyFontSlot({
        mode: "google",
        googleFamily: seed.brand.fontBody.name,
        uploadFile: null,
        uploadName: null,
        uploadStorageUrl: null,
        uploadFamily: "",
      });
    }
  }, []);

  // ─── Brand-kit hydration (on first mount, skip if template seed) ──
  // Read sessionStorage first (the brand-kits "use" flow writes
  // here). If nothing's there, fall back to the user's default
  // brand kit. Skip entirely when arriving from a template — the
  // template's brand wins by user intent. Single-shot per mount;
  // we clear the sessionStorage key after applying so refresh
  // doesn't keep re-hydrating an old kit's logo.
  useEffect(() => {
    if (readTemplateSeed()) return;
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
        // Restore position + exclude flags from the saved kit so
        // the user sees the kit's exact configuration, not the
        // page's defaults.
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
      // Burn the sessionStorage key — single-shot. The default-kit
      // path doesn't write it, so the clear is a no-op there.
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

  // ─── Output / rules state ──────────────────────────────────────
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);
  const [pagination, setPagination] = useState<boolean>(true);
  const [persistentText, setPersistentText] = useState<string>("");
  const [persistentPosition, setPersistentPosition] =
    useState<CornerPosition>("bottom-center");
  // Cover / closing excludes for the persistent overlay — restored
  // 2026-05-25 per user direction (the legacy /create flow had
  // these; Phase 17.D scaffold dropped them by mistake).
  const [persistentExcludeCover, setPersistentExcludeCover] =
    useState<boolean>(false);
  const [persistentExcludeClosing, setPersistentExcludeClosing] =
    useState<boolean>(false);

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // ─── Derived flags ─────────────────────────────────────────────
  const hasText = contentText.trim().length > 0;
  const hasFile = contentFile !== null;
  // File path is "ready" only AFTER extraction completes. Text path
  // is always ready when non-empty. Gating Generate on the file
  // being fully extracted prevents POSTing /api/projects with a
  // dangling fileName before the document is available to Claude.
  const fileReady = hasFile && contentFileStage === "ready" && !!contentAnthropicFileId;
  const fileExtracting = hasFile && contentFileStage === "extracting";
  const contentReady = hasText || fileReady;
  const generateDisabled =
    !contentReady || submitting || fileExtracting;
  const generateLoading = submitting || fileExtracting;

  // ─── File validation ───────────────────────────────────────────
  const validateFile = (next?: File | null): File | null => {
    if (!next) return null;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".pdf") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".ppt") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".txt");
    if (!extOk) {
      setError("الرجاء رفع ملف PDF أو PowerPoint أو Word أو نص.");
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `الملف يتجاوز الحد الأقصى 100 ميجابايت (${(next.size / 1024 / 1024).toFixed(1)} م.ب).`,
      );
      return null;
    }
    setError("");
    return next;
  };
  const setContentFromInput = (next?: File | null) => {
    const valid = validateFile(next);
    if (!valid) return;
    setContentFile(valid);
    setContentText("");
    // Reset extraction state on every new pick so the polling
    // effect below restarts cleanly. setStage("extracting") at the
    // call site (not inside the useEffect) keeps the lint rule
    // react-hooks/set-state-in-effect quiet — same pattern as
    // /enhance + /mimic.
    setContentAnthropicFileId(null);
    setContentFileStage("extracting");
    setError("");
  };
  const removeContentFile = () => {
    setContentFile(null);
    setContentAnthropicFileId(null);
    setContentFileStage("idle");
    setError("");
  };

  // ─── Auto-extract: content file ────────────────────────────────
  // Mirrors /enhance + /mimic's polling effect. The result's
  // anthropicFileId is what we send as `source.anthropicFileId` on
  // submit — the actual document the LLM reads via the document
  // block in deck-generate.ts. Without this effect the file picker
  // was decorative (CR critical 2026-05-26).
  useEffect(() => {
    if (!contentFile) return;
    const controller = new AbortController();
    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", contentFile);
        formData.append("kind", "create");
        formData.append("format", "16:9");
        const startRes = await fetch("/api/extract", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!startRes.ok) {
          const data = (await startRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            data?.error ?? `Upload failed (${startRes.status})`,
          );
        }
        const { jobId } = (await startRes.json()) as { jobId: string };
        if (!jobId) throw new Error("No jobId returned from /api/extract");

        // Poll until the extract job lands at "completed" / "failed"
        // or the abort signal fires. Same interval + timeout as the
        // other flows (2.5 s / 5 min).
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (controller.signal.aborted) throw new Error("Cancelled");
          const res = await fetch(`/api/extract/${jobId}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(data?.error ?? `Status ${res.status}`);
          }
          const body = (await res.json()) as
            | { status: "queued" | "processing" }
            | { status: "failed"; error: string }
            | { status: "completed"; result: { anthropicFileId: string } };
          if (body.status === "completed") {
            if (!isCurrent) return;
            setContentAnthropicFileId(body.result.anthropicFileId);
            setContentFileStage("ready");
            return;
          }
          if (body.status === "failed") {
            throw new Error(body.error ?? "Extraction failed");
          }
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS),
          );
        }
        throw new Error("Extraction timed out. Try a smaller file.");
      } catch (err) {
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        if (!isCurrent) return;
        if (isAbort) {
          setContentFileStage("idle");
          return;
        }
        console.error("[create] content extraction failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "تعذر تحليل ملف المحتوى. حاول مرة أخرى.",
        );
        setContentFileStage("idle");
      }
    })();
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [contentFile]);

  // ─── Palette handlers ──────────────────────────────────────────
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
    if (!contentReady) return;
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

      const content = hasFile
        ? {
            type: "source" as const,
            fileName: contentFile!.name,
            fileSize: contentFile!.size,
          }
        : {
            type: "text" as const,
            text: contentText.trim(),
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

      // Resolve the logo's storageUrl in priority order: a freshly
      // uploaded file wins (just-completed upload). If none, fall
      // back to a hydrated kit's storageUrl. Either way the
      // server re-signs the path itself, so no client trust is
      // assumed.
      const resolvedLogoStorageUrl =
        logoUploaded?.storageUrl ?? loadedLogo?.storageUrl ?? null;

      const brand = {
        colors,
        paletteMode: "manual" as const,
        paletteScreenshotUrl: null,
        fonts: { heading: headingFont, body: bodyFont },
        logo: resolvedLogoStorageUrl
          ? {
              storageUrl: resolvedLogoStorageUrl,
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

      // When the user picked a content file, attach the extracted
      // anthropicFileId as a scratch-with-source. Empty / text-only
      // submits omit `source` entirely so the server reverts to the
      // legacy scratch path. Pre-fix the file selection was thrown
      // away on submit (CR critical 2026-05-26).
      const source =
        hasFile && contentAnthropicFileId
          ? { kind: "scratch" as const, anthropicFileId: contentAnthropicFileId }
          : null;

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
          ...(source ? { source } : {}),
          ...(templateSeedId ? { templateId: templateSeedId } : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "تعذر إنشاء المشروع");
      }

      const data = (await response.json()) as { projectId: string };
      try {
        window.sessionStorage.removeItem("taqreer:create:templateSeed");
      } catch {
        /* best-effort */
      }
      router.push(`/preview/${data.projectId}`);
    } catch (caughtError) {
      console.error("[create] generate failed:", caughtError);
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
        <header className="text-center">
          <h1 className="tq-h1">أنشئ عرضاً جديداً</h1>
          <p className="tq-subhead mt-2">
            اكتب محتواك أو ارفع ملفاً، اختر هويتك البصرية، وسنبني عرضاً يحاكي
            ذوقك.
          </p>
          {templateSeedTitle ? (
            <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-[var(--tq-bg-glass)] px-3 py-1 text-xs text-white/70">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                style
              </span>
              من قالب: {templateSeedTitle}
            </p>
          ) : null}
        </header>

        {/* Responsive grid — explicit breakpoints (instead of
            auto-fit) so the layout JUMPS from 4 columns to 2 (and
            then 1) with no 3-column intermediate. User direction
            2026-05-26: "the next view point from the full should
            stack 2 cards not one". Breakpoints picked from the
            actual content-row width at each viewport (sidebar +
            shell padding factored in):
              • ≥ 1280 viewport → row ≥ 1184 → 4 columns fit
              • ≥ 760  viewport → row ≥ 576  → 2 columns fit
              • < 760  viewport → single column stack
            `-mx-4 w-[calc(100%+2rem)]` still reclaims the parent's
            px-4 padding for the cards row only. */}
        <div className="grid -mx-4 w-[calc(100%+2rem)] grid-cols-1 gap-4 min-[760px]:grid-cols-2 min-[1280px]:grid-cols-4">
          {/* ═══════════════════════════════════════════════════════
              CONTENT CARD (DOM 1st, visual right)
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="subject" title="المحتوى" />

            <input
              ref={contentInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,.docx,.txt"
              className="hidden"
              onChange={(event) => setContentFromInput(event.target.files?.[0])}
            />

            {/* Language label-row + textarea grouped into ONE section
                so the gap between them is the same 6 px (space-y-1.5)
                used in the fonts card's "خط العناوين → input slot"
                pattern. Without this wrapper they were two separate
                top-level card children separated by the card's
                gap-4 (16 px). flex-1 on the wrapper + flex-1 on the
                textarea keeps the textarea growing to fill the
                card's leftover vertical space. */}
            <div className="flex flex-1 flex-col space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">
                  اللغة
                </span>
                <SegmentedToggle
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                  ariaLabel="لغة المحتوى"
                />
              </div>

              <textarea
                value={contentText}
                onChange={(event) => {
                  const next = event.target.value;
                  setContentText(next);
                  if (next.length > 0 && contentFile) removeContentFile();
                }}
                placeholder="اكتب محتوى عرضك هنا..."
                rows={2}
                dir={language === "en" ? "ltr" : "rtl"}
                disabled={submitting || hasFile}
                className="input-dark min-h-[60px] flex-1 resize-none text-sm leading-5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Dropzone — always rendered, dimmed when text typed */}
            <div
              className={`flex flex-col gap-2.5 transition-opacity duration-200 ${
                hasText ? "pointer-events-none opacity-40" : ""
              }`}
              aria-hidden={hasText}
            >
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
                <span>أو</span>
                <div className="h-px flex-1 bg-[var(--tq-border-glass)]" />
              </div>
              <ContentDropzone
                file={contentFile}
                submitting={submitting}
                dragging={contentDragging}
                setDragging={setContentDragging}
                onOpen={() => contentInputRef.current?.click()}
                onDrop={(f) => setContentFromInput(f)}
                onRemove={removeContentFile}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              FONTS + COLORS CARD (DOM 2nd)
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="palette" title="الخطوط والألوان" />

            {/* Palette row — label on the visual right, swatches +
                add tile on the visual left as a single horizontal
                cluster. */}
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

            {/* Heading font — label + mode toggle row, slot below.
                `border-t pt-3` separates the fonts cluster from the
                palette cluster above for visual breathing room. */}
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

            {/* Body font */}
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

            {/* Save brand kit — present on BOTH branding cards
                (fonts+colors AND logo), backed by the same state,
                so the user can flip the toggle from either card. */}
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
              LOGO CARD (DOM 3rd)
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

            {/* Save brand kit — duplicated from the fonts+colors
                card, same backing state so flipping either updates
                both. Matches the user direction to expose this
                toggle on both branding cards. */}
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
              EXPORT SETTINGS CARD (DOM 4th, visual left)
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`glass-card flex ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="settings" title="إعدادات الإخراج" />

            {/* Each section wrapped in space-y-1.5 (label-to-content
                gap consistent with the branding card). Sections
                separated by `border-t pt-3` for visible breathing
                room between distinct knob groups. */}
            <SlideSizeFields
              slideSize={slideSize}
              onSlideSize={setSlideSize}
            />

            <div className="border-t border-[var(--tq-border-glass)] pt-3">
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">
                  عدد الشرائح
                </span>
                {/* `layout` on the controls container so the
                    SegmentedToggle slides smoothly when the stepper
                    mounts/unmounts (toggle's anchor inside the group
                    shifts as the stepper's width animates in/out).
                    AnimatePresence wraps the stepper to give it a
                    width-+-opacity grow/shrink animation matching
                    the existing toggle spring (stiffness 500,
                    damping 35) so the whole row reads as one smooth
                    transition rather than a pop-in. */}
                <motion.div
                  // `layout` on the parent FLIPs the SegmentedToggle's
                  // position when the stepper appears/disappears so
                  // the toggle slides smoothly over to make room.
                  // Inner motion.div does NOT use `layout` (would
                  // conflict with the parent's layout pass and cause
                  // a snap at the end of the animation). It only
                  // animates its own width + opacity instead.
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
                        // Fixed width (66 px = stepper natural size:
                        // 20 + 24 + 20 + 2 px border) avoids the
                        // framer-motion `auto`-to-numeric jump that
                        // shows up as a 1-frame snap at the end of
                        // the spring. Also bake in `-mr-1.5` on exit
                        // to absorb the parent's gap-1.5 between the
                        // toggle and the stepper as the stepper
                        // collapses — otherwise the gap stays put
                        // until unmount and pops the toggle 6 px at
                        // the very end.
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
// ContentDropzone — horizontal compact dropzone for the content
// card. Same shape as /mimic's FileDropzone in horizontal mode.
// ───────────────────────────────────────────────────────────────────
function ContentDropzone({
  file,
  submitting,
  dragging,
  setDragging,
  onOpen,
  onDrop,
  onRemove,
}: {
  file: File | null;
  submitting: boolean;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  onOpen: () => void;
  onDrop: (f?: File | null) => void;
  onRemove: () => void;
}) {
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
        className={`flex w-full items-center gap-3 rounded-xl border border-dashed p-2.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? "border-white/40 bg-white/[0.04]"
            : "border-white/20 bg-black/20 hover:border-white/30"
        } min-h-[44px]`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tq-bg-glass)]">
          <span
            className="material-symbols-outlined text-white/80"
            style={{ fontSize: 18 }}
          >
            {file ? "description" : "cloud_upload"}
          </span>
        </span>

        {file ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {readableFileName(file.name)}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/60">
              {formatFileSize(file.size)}
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              اسحب أو انقر لاختيار ملف
            </p>
            <p className="mt-0.5 truncate text-[11px] text-white/40">
              PDF / PPTX / DOCX / TXT — حتى 100 ميجابايت
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
