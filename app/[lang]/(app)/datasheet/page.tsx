"use client";

// Phase 17.E — /datasheet flow (spreadsheet → editorial chart deck).
//
// Architecture mirror: a 3-card clone of /create's single-shot layout
// (البيانات · الهوية البصرية · إعدادات الإخراج). The brand card is a
// 1:1 replica of /create's consolidated card (2026-06-01) so the
// unified design system stays consistent across all flows.
//
// Three cards:
//   1. البيانات (Data) — file upload (REQUIRED — no "text OR file"
//      toggle; without data there's nothing to chart) + the persistent
//      element (موved here from إعدادات الإخراج: the footer that rides
//      on every slide belongs with the data input).
//   2. الهوية البصرية (Brand) — saved-kit dropdown in the header,
//      palette, single BrandFontPicker (one family, Claude varies
//      weights), LogoRow, save-as-default toggle. Fonts + logo merged
//      into one card, identical to /create.
//   3. إعدادات الإخراج (Output) — slide size, count, pagination, and
//      تعليمات إضافية (moved here from البيانات to take the persistent
//      element's old spot — optional "ركز على..." steering text).
//
// What differs from /create:
//   1. ACCEPTED FILE TYPES — `.xlsx`, `.xls`, `.csv` (xlsx package
//      handles all three via SheetJS). Not PDF/DOCX/PPTX.
//   2. EXTRACTION PIPELINE — POST to /api/datasheet/parse, NOT
//      /api/extract. The datasheet parse is synchronous (xlsx → markdown
//      tables on the server, no Inngest, no polling). Returns the
//      parsed Markdown payload + sheet count + total rows in one
//      response.
//   3. SUBMIT PAYLOAD — `source: { kind: "data", markdown, sheetCount,
//      totalRows, truncated, userContext }`. The deck-generate
//      datasheet branch reads markdown directly (no Files API).
//   4. NO TEMPLATE SEED — /datasheet doesn't support "use this
//      template" entry yet. The brand card still works because the user
//      sets palette/font/logo manually (or via the saved-kit dropdown).
//
// What stays identical to /create:
//   • The flex-wrap fixed-width card row
//   • CardHeader / SegmentedToggle / InlineStepper / Toggle /
//     BrandFontPicker / LogoRow / PersistentRow / BrandKitDropdown /
//     ColorPickerPopover — same primitives, same props
//   • The single-font brand model (one family reused for heading+body
//     at submit) + save-brand-kit toggle + output settings
//   • GenerateSplitButton + quality presets

import { PalettePresetPicker } from "@/components/brand/PalettePresetPicker";
import { DesignStylePicker } from "@/components/create/DesignStylePicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  CreditGateDialog,
  isCreditGatePayload,
  type CreditGatePayload,
} from "@/components/credits/CreditGateDialog";
import { useSlideCap } from "@/lib/credits/store";
import { displaySlideEstimate } from "@/lib/credits/cost";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import { PersistentRow } from "@/components/brand/PersistentRow";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import { ColorPickerPopover } from "@/components/create/ColorPickerPopover";
import {
  InlineStepper,
  SlideSizeFields,
  type SlideSize,
  type SlideCountMode,
} from "@/components/create/OutputCards";
import {
  CardHeader,
  SegmentedToggle,
  Toggle,
  type LanguageCode,
} from "@/components/create/controls";
import {
  defaultBrandFont,
  googleFontUrl,
  HEADING_SAMPLE_AR,
  HEADING_SAMPLE_LATIN,
  type BrandFontState,
} from "@/lib/brand/fonts";
import {
  uploadAsset,
  resolveUploadedFontFamilies,
  type UploadedFontFieldBrief,
} from "@/lib/brand/upload";
import { useDefaultQuality } from "@/lib/credits/use-default-quality";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  mapKitToHydrated,
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
const CARD_MIN_H_CLASS = "min-h-[440px]";

// ─── Helpers ──────────────────────────────────────────────────────
function formatFileSize(size: number, dict: Dictionary) {
  if (size < 1024 * 1024)
    return `${Math.max(1, Math.round(size / 1024))} ${dict.flows.unitKB}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${dict.flows.unitMB}`;
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

// Trim a brand-kit title to its first few words for the compact
// saved-kit dropdown menu (mirrors /create's helper).
function fewWords(s: string, max = 3): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length <= max ? s.trim() : `${parts.slice(0, max).join(" ")}…`;
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
  const dict = useDict();
  const { dir } = useLocale();
  const router = useRouter();
  const dataInputRef = useRef<HTMLInputElement>(null);

  const SLIDE_COUNT_OPTIONS = [
    { value: "auto" as const, label: dict.flows.auto },
    { value: "custom" as const, label: dict.flows.custom },
  ];
  const LANGUAGE_OPTIONS: { value: LanguageCode; label: string }[] = [
    { value: "ar", label: dict.flows.langArabic },
    { value: "en", label: dict.flows.langEnglish },
  ];

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

  // ─── Branding state (consolidated brand card, identical to /create) ─
  // [] = palette "Auto" (Claude picks at generation). Mirrors /create.
  const [colors, setColors] = useState<string[]>([]);
  // Single brand font — one Google family (Claude varies weights) OR up
  // to 5 uploaded families (Claude pairs). Replaces the old heading +
  // body two-slot UI; mirrors /create's BrandFontPicker model.
  const [brandFont, setBrandFont] = useState<BrandFontState>(defaultBrandFont());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from brand kit / default kit. See /create's
  // companion state for the rationale.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);
  // Saved brand kits for the in-card dropdown (last 5). `options` drives
  // the menu; `raw` maps the picked id → HydratedBrand on select.
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());

  // Apply a resolved brand (sessionStorage, default kit, or a picked
  // saved kit) to the card state. Maps the heading font slot → the
  // single brandFont model; colours + logo + position apply directly.
  // Logo cover/closing excludes are dropped — Claude decides per slide.
  // Shared by mount hydration + the in-card brand-kit dropdown.
  const applyBrand = useCallback((h: HydratedBrand) => {
    if (h.colors.length > 0) setColors(h.colors);
    const heading = h.headingFontSlot;
    if (heading.googleFamily) {
      setBrandFont({
        mode: "google",
        googleFamily: heading.googleFamily,
        uploaded: [],
      });
    } else if (heading.uploadStorageUrl) {
      setBrandFont({
        mode: "upload",
        googleFamily: null,
        uploaded: [
          {
            name: heading.uploadName ?? heading.uploadFamily ?? "Custom",
            faces: [
              { weight: 400, file: null, storageUrl: heading.uploadStorageUrl },
            ],
          },
        ],
      });
    }
    if (h.logo) {
      setLogoFile(null);
      setLoadedLogo(h.logo);
    }
  }, []);

  // ─── Brand-kit hydration on first mount ────────────────────────
  // Read taqreer:create:brand sessionStorage (the brand-kits "use"
  // flow writes here). Falls back to the user's default brand kit.
  // Clears the key after applying so refresh doesn't keep re-hydrating.
  useEffect(() => {
    let aborted = false;
    (async () => {
      let hydrated = readBrandFromSession();
      if (!hydrated) hydrated = await fetchDefaultBrandKit();
      if (aborted || !hydrated) return;
      applyBrand(hydrated);
      try {
        window.sessionStorage.removeItem(CREATE_BRAND_KEY);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [applyBrand]);

  // Fetch the user's saved kits (last 5) for the in-card brand dropdown.
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/brand-kits", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          kits?: Array<{ id: string; name: string }>;
        };
        if (aborted || !Array.isArray(data.kits)) return;
        const last5 = data.kits.slice(0, 5);
        kitRawRef.current = new Map(last5.map((k) => [k.id, k]));
        setKitOptions(last5.map((k) => ({ id: k.id, name: fewWords(k.name) })));
      } catch {
        /* best-effort — dropdown just stays empty */
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // Apply a picked saved kit (overwrites colours / font / logo).
  const handlePickKit = (id: string) => {
    const raw = kitRawRef.current.get(id);
    if (raw)
      applyBrand(
        mapKitToHydrated(raw as Parameters<typeof mapKitToHydrated>[0]),
      );
  };

  // ─── Output / rules state (identical to /create) ───────────────
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>("auto");
  const [slideCountValue, setSlideCountValue] = useState<number>(8);
  // Cap the custom slide count at the user's tier ceiling (free = 10). Preflight
  // rejects an over-cap run server-side; this stops the user picking one. The
  // render-phase clamp also covers a mid-session downgrade lowering the cap.
  const slideCap = useSlideCap();
  if (slideCountValue > slideCap) setSlideCountValue(slideCap);
  // Split-button credit estimate: dynamic by the parsed data (auto: cover +
  // closing + a slide per sheet + ~1 per 20 rows) or the manual count (custom),
  // via the same estimateSlides the server holds on, capped at the tier limit.
  const estimatedSlideCount = useMemo(
    () =>
      displaySlideEstimate(
        slideCountMode === "custom"
          ? { kind: "fixed", count: slideCountValue }
          : dataParsed
            ? {
                kind: "datasheet",
                sheetCount: dataParsed.sheetCount,
                totalRows: dataParsed.totalRows,
              }
            : { kind: "text", text: "" },
        slideCap,
      ),
    [slideCountMode, slideCountValue, dataParsed, slideCap],
  );
  const [pagination, setPagination] = useState<boolean>(true);
  const [designStyle, setDesignStyle] = useState<string | null>(null);
  const [persistentText, setPersistentText] = useState<string>("");

  // ─── Submit-level state ────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 402 credit-gate payload from POST /api/projects (billing Phase A).
  const [creditGate, setCreditGate] = useState<CreditGatePayload | null>(null);
  const [quality, setQuality] = useDefaultQuality();

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
      setError(dict.flows.datasheet.fileTypeError);
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        dict.flows.datasheet.fileTooLarge.replace(
          "{size}",
          `${(next.size / 1024 / 1024).toFixed(1)} ${dict.flows.unitMB}`,
        ),
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
            : dict.flows.datasheet.extractFailed,
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
  }, [dataFile, dict]);

  // ─── Palette handlers (identical to /create) ───────────────────
  const updateColor = (index: number, next: string) =>
    setColors((c) => c.map((v, i) => (i === index ? next : v)));
  const addColor = () =>
    setColors((c) =>
      c.length === 0
        ? [...DEFAULT_PALETTE]
        : c.length >= MAX_PALETTE
          ? c
          : [...c, "#FFFFFF"],
    );
  const removeColor = (index: number) =>
    setColors((c) =>
      c.length <= MIN_PALETTE ? c : c.filter((_, i) => i !== index),
    );

  // ─── Submit ────────────────────────────────────────────────────
  const handleGenerate = async (overrideSlideCount?: number) => {
    // onClick={handleGenerate} passes the click EVENT as the first arg -
    // only a real number (the dialog's reduce offer) counts as an
    // override.
    const reducedSlideCount =
      typeof overrideSlideCount === "number" ? overrideSlideCount : null;
    if (!fileReady || !dataParsed) return;
    setError("");
    setSubmitting(true);
    try {
      const logoUploaded = await uploadAsset(
        "brand-assets",
        "logos",
        logoFile,
      );

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

      // Resolve the single brand font → ONE field reused for heading +
      // body (one family, Claude varies weights / pairs uploads). Upload
      // mode now carries every picked family with ALL its weight faces;
      // heading/body default to the first family's name. Mirrors /create.
      let fontField: ResolvedFontField = null;
      // Every resolved uploaded family (name + weight faces) — forwarded so
      // Claude pairs them to heading/body; deck-generate signs each face file.
      const uploadedFontFields: UploadedFontFieldBrief[] = [];
      if (brandFont.uploaded.length === 0 && brandFont.googleFamily) {
        fontField = {
          name: brandFont.googleFamily,
          url: googleFontUrl(brandFont.googleFamily),
          storageUrl: null,
          family: brandFont.googleFamily,
        };
      } else if (brandFont.uploaded.length > 0) {
        const resolved = await resolveUploadedFontFamilies(brandFont.uploaded);
        uploadedFontFields.push(...resolved);
        if (uploadedFontFields.length > 0) {
          fontField = {
            name: uploadedFontFields[0].name,
            url: null,
            storageUrl: null,
            family: uploadedFontFields[0].name,
          };
        }
      }

      // Logo + persistent cover/closing excludes are gone — Claude
      // decides logo presence per slide; the persistent footer is on
      // every slide.
      const noExclude: ("cover" | "closing")[] = [];

      const brand = {
        colors,
        paletteMode: colors.length > 0 ? ("manual" as const) : ("auto" as const),
        paletteScreenshotUrl: null,
        fonts: {
          heading: fontField,
          body: fontField,
          ...(uploadedFontFields.length > 0
            ? { uploaded: uploadedFontFields }
            : {}),
        },
        // Logo storageUrl resolves to a fresh upload first, then a
        // hydrated kit's stored path. Server re-signs either path.
        logo: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)
          ? {
              storageUrl: (logoUploaded?.storageUrl ?? loadedLogo?.storageUrl)!,
              exclude: noExclude,
            }
          : null,
        slideSize,
        slideCount: {
          mode: slideCountMode,
          value: slideCountMode === "custom" ? slideCountValue : null,
        },
      };

      const rules = {
        designStyle,
        fixTypos: false,
        pagination,
        persistent: persistentText.trim()
          ? {
              text: persistentText.trim(),
              exclude: noExclude,
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
            reducedSlideCount ??
            (slideCountMode === "custom" ? slideCountValue : null),
          quality,
          source,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (response.status === 402 && isCreditGatePayload(data)) {
          setCreditGate(data);
          setSubmitting(false);
          return;
        }
        throw new Error(data?.error ?? dict.flows.createFailed);
      }

      const data = (await response.json()) as { projectId: string };
      router.push(`/project/${data.projectId}`);
    } catch (caughtError) {
      console.error("[datasheet] generate failed:", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : dict.flows.startFailed,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container flex w-full justify-center" dir={dir}>
      <CreditGateDialog
        gate={creditGate}
        onClose={() => setCreditGate(null)}
        onReduce={(slides) => {
          setCreditGate(null);
          void handleGenerate(slides);
        }}
      />
      <div className="mt-[6vh] flex w-full flex-col items-center gap-6 px-4">
        <header className="text-center">
          <h1 className="tq-h1">{dict.flows.datasheet.title}</h1>
          <p className="tq-subhead mt-2">{dict.flows.datasheet.subtitle}</p>
        </header>

        {/* 3-card row — flex-wrap + fixed-width cards, same as /create.
            (Fonts + logo merged into one الهوية البصرية card 2026-06-01,
            collapsing the old 4-card grid to 3.) */}
        <div className="flex flex-wrap justify-center gap-4">
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
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="dataset" title={dict.flows.datasheet.data} />

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
                <span className="text-xs font-semibold text-foreground/70">
                  {dict.flows.language}
                </span>
                <SegmentedToggle
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onChange={setLanguage}
                  ariaLabel={dict.flows.datasheet.languageAria}
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
                dict={dict}
              />
            </div>

            {/* Persistent element — moved here from إعدادات الإخراج
                (2026-06-01). The footer that rides on every slide
                belongs with the data input. PersistentRow self-labels
                via its placeholder (matches /create). */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <PersistentRow
                text={persistentText}
                language={language}
                onText={setPersistentText}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              BRAND CARD (DOM 2nd) — fonts + logo merged into one
              الهوية البصرية card, identical to /create.
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            {/* Inline header (not CardHeader) so the saved-kit pill can
                overlay the title row. Mirrors /create's branding header:
                pb-4 balances the card's p-4 top padding; z-30 lifts the
                open menu above the later rows. */}
            <header className="relative z-30 border-b border-foreground/[0.08] pb-4">
              <div className="relative flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-foreground"
                  style={{ fontSize: 18 }}
                >
                  palette
                </span>
                <h3 className="text-sm font-semibold text-foreground">
                  {dict.flows.brandCard}
                </h3>
                {kitOptions.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute end-0 top-1/2 -translate-y-1/2"
                  >
                    <BrandKitDropdown
                      kits={kitOptions}
                      onSelect={handlePickKit}
                    />
                  </motion.div>
                ) : null}
              </div>
            </header>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground/70">
                {dict.flows.colors}
              </span>
              <div className="flex items-center gap-1.5">
                {/* Auto pill — mirrors /create. */}
                <button
                  type="button"
                  onClick={() => setColors([])}
                  disabled={colors.length === 0}
                  aria-pressed={colors.length === 0}
                  title={dict.flows.autoColorsHint}
                  className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                    colors.length === 0
                      ? "border-foreground/40 text-foreground"
                      : "border-dashed border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 13 }}
                  >
                    auto_awesome
                  </span>
                  {dict.flows.autoColors}
                </button>
                {colors.map((color, index) => (
                  <InlinePaletteSwatch
                    key={index}
                    value={color}
                    index={index}
                    removable={colors.length > MIN_PALETTE}
                    onChange={(next) => updateColor(index, next)}
                    onRemove={() => removeColor(index)}
                    dict={dict}
                  />
                ))}
                {colors.length < MAX_PALETTE ? (
                  <button
                    type="button"
                    onClick={addColor}
                    aria-label={dict.flows.addColor}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-foreground/20 text-foreground/60 transition-colors hover:border-foreground/40 hover:text-foreground"
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
            {/* Colour templates (shared with /create, 2026-10-05). */}
            <div className="flex flex-col gap-1.5">
              <PalettePresetPicker colors={colors} onPick={setColors} disabled={submitting} />
            </div>

            {/* Single brand font — one Google family (Claude varies
                weights) OR up to 5 uploaded families (Claude pairs). */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <BrandFontPicker
                value={brandFont}
                onChange={setBrandFont}
                sampleText={
                  language === "en" ? HEADING_SAMPLE_LATIN : HEADING_SAMPLE_AR
                }
              />
            </div>

            {/* Logo — flex-1 so the dropzone grows to fill the card's
                leftover height (matches /create); gap-4 unifies the
                title→zone gap with الخطوط. */}
            <div className="flex flex-1 flex-col gap-4 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-foreground/70">
                {dict.flows.logo}
              </span>
              <LogoRow
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
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-2">
              <span className="text-xs font-semibold text-foreground/70">
                {dict.flows.saveAsDefault}
              </span>
              <Toggle
                ariaLabel={dict.flows.saveAsDefault}
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              EXPORT SETTINGS CARD (DOM 3rd) — identical to /create
              ═══════════════════════════════════════════════════════ */}
          <div
            className={`surface-card flex w-[360px] shrink-0 ${CARD_MIN_H_CLASS} flex-col gap-4 rounded-2xl p-4`}
          >
            <CardHeader icon="settings" title={dict.flows.outputCard} />

            <SlideSizeFields
              slideSize={slideSize}
              onSlideSize={setSlideSize}
            />

            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <div className="flex min-h-[24px] items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/70">
                  {dict.flows.slideCount}
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
                    ariaLabel={dict.flows.slideCount}
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
                          max={slideCap}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="text-xs font-semibold text-foreground/70">
                {dict.flows.slideNumbering}
              </span>
              <Toggle
                ariaLabel={dict.flows.slideNumbering}
                value={pagination}
                onChange={setPagination}
              />
            </div>

            {/* Design-style picker - same control as /create (2026-06-12). */}
            <div className="space-y-1.5 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-foreground/70">
                {dict.flows.designStyle}
              </span>
              <DesignStylePicker
                value={designStyle}
                onChange={setDesignStyle}
                disabled={submitting}
              />
            </div>

            {/* Extra instructions — moved here from البيانات (2026-06-01)
                to take the persistent element's old spot. Optional
                steering text, forwarded as source.userContext. */}
            <div className="space-y-1.5 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-foreground/70">
                {dict.flows.datasheet.instructions}
              </span>
              <textarea
                value={userContext}
                onChange={(event) => setUserContext(event.target.value)}
                placeholder={dict.flows.datasheet.instructionsPlaceholder}
                rows={2}
                dir={language === "en" ? "ltr" : "rtl"}
                disabled={submitting}
                className="input-dark min-h-[60px] resize-none text-sm leading-5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={estimatedSlideCount.slides}
            slideCountUpTo={estimatedSlideCount.upTo}
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
// InlinePaletteSwatch — identical copy of /create's swatch.
// ───────────────────────────────────────────────────────────────────
function InlinePaletteSwatch({
  value,
  index,
  removable,
  onChange,
  onRemove,
  dict,
}: {
  value: string;
  index: number;
  removable: boolean;
  onChange: (next: string) => void;
  onRemove: () => void;
  dict: Dictionary;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="block h-7 w-7 shrink-0 rounded-md border border-foreground/15 transition-shadow hover:shadow-md"
        style={{ backgroundColor: value }}
        aria-label={dict.flows.controls.colorN.replace("{n}", String(index + 1))}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label={dict.flows.controls.removeColor}
        className="absolute -top-1 -end-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-0"
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
// "جار التحليل…" sub-label so the user gets immediate feedback.
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
  dict,
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
  dict: Dictionary;
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
            ? "border-foreground/40 bg-foreground/[0.04]"
            : "border-foreground/20 bg-overlay-soft hover:border-foreground/30"
        }`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-surface)]">
          <span
            className="material-symbols-outlined text-foreground/80"
            style={{ fontSize: 22 }}
          >
            {ready ? "table_chart" : parsing ? "hourglass_top" : "cloud_upload"}
          </span>
        </span>

        {ready && file ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {readableFileName(file.name)}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground/60">
              {parsed!.sheetCount.toLocaleString()} {dict.flows.datasheet.sheetUnit}{" "}
              · {parsed!.totalRows.toLocaleString()} {dict.flows.datasheet.rowUnit}{" "}
              · {formatFileSize(file.size, dict)}
              {parsed!.truncated ? ` · ${dict.flows.datasheet.truncated}` : ""}
            </p>
          </div>
        ) : parsing && file ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {readableFileName(file.name)}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground/60">
              {dict.flows.datasheet.analyzing}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {dict.flows.datasheet.dragOrClick}
            </p>
            <p className="mt-1 truncate text-[11px] text-foreground/40">
              {dict.flows.datasheet.fileHint}
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
          aria-label={dict.flows.removeFile}
          className="absolute top-2 start-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
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
