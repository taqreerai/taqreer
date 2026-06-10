"use client";

// Phase 17.B — Single-shot Enhance flow.
//
// The whole /enhance experience lives on this one page:
//
//   1. Drop a PDF or PPTX  (الملف الأصلي card)
//   2. Server extracts (LibreOffice → PDF → Anthropic Files API +
//      PPTX zip walk for fonts/colors). Asset extraction removed
//      2026-05-25 — Claude reads visuals from the PDF document block.
//   3. Optionally set the brand identity — palette, one brand font,
//      logo + position, save-as-default (الهوية البصرية card)
//   4. Generate button activates as soon as extraction finishes
//   5. Click Generate → upload logo/font (if any) → POST /api/projects
//      → /preview/{id}
//
// Layout: two equal-width glass cards side-by-side under a brief
// header. The الملف الأصلي card is just the PDF dropzone now; the
// الهوية البصرية card is a 1:1 replica of /create's consolidated brand
// card (saved-kit dropdown in the header, palette, single
// BrandFontPicker, LogoRow, save toggle). Both cards are flex-1 so they
// read as a balanced pair; items-stretch makes them share the row's
// natural height. Container caps at max-w-3xl so the cards stay
// readable on wide monitors.
//
// Brand picks are OPTIONAL on this flow. Empty card = Claude reads the
// brand identity from the PDF visually. Filled = user's pick wins
// (matches the create flow's brand shape on the brief). The single
// brand font is reused for heading + body at submit — Claude varies
// weights / pairs uploads — exactly like /create.
//
// Components: BrandFontPicker, LogoRow, BrandKitDropdown, CardHeader,
// InlinePaletteSwatch, Toggle are the same primitives /create uses —
// per "reuse > extend > fork > build new".

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { GenerateSplitButton } from "@/components/create/GenerateSplitButton";
import { BrandFontPicker } from "@/components/brand/BrandFontPicker";
import { LogoRow } from "@/components/brand/LogoRow";
import {
  BrandKitDropdown,
  type BrandKitOption,
} from "@/components/brand/BrandKitDropdown";
import {
  CardHeader,
  InlinePaletteSwatch,
  Toggle,
} from "@/components/create/controls";
import {
  emptyBrandFont,
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
import { seedFromExtraction } from "@/lib/create/seed-from-extraction";
import { readSource, clearSource } from "@/lib/types/source";
import { DEFAULT_QUALITY, type Quality } from "@/lib/types/quality";
import {
  readBrandFromSession,
  fetchDefaultBrandKit,
  mapKitToHydrated,
  type HydratedBrand,
} from "@/lib/create/hydrate-brand-from-session";

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 min ceiling
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

type ExtractCompletedResponse = {
  status: "completed";
  result: {
    // Optional: extract-source intentionally omits this for the enhance flow
    // (it feeds per-slide PNGs at generation time, not a PDF document block).
    anthropicFileId?: string;
    fonts: string[];
    colors: string[];
    pageCount: number;
    format: "16:9" | "9:16";
    // PPTX-detected dominant language ("ar" | "en"); null for PDF
    // inputs OR PPTX with too little text to decide. Threaded into
    // the brief so the preview SlideNavSidebar opens in the right
    // direction from the first paint instead of flipping mid-stream.
    language: "ar" | "en" | null;
    // Phase 18 — verbatim per-slide text + the source's Supabase
    // staging location, so deck-generate can rasterize per-slide PNGs
    // at generation time (transient).
    textPerSlide: string[];
    sourcePath: string;
    sourceMime: string;
  };
  fileName?: string;
  flowKind?: string;
};

type ExtractStatusResponse =
  | {
      status: "queued" | "processing";
      // Real phase milestone written by extract-source to the job's
      // outputJson._progress (convert 20 → analyze 80 → finish 92).
      // null until the first milestone lands. Drives the upload bar's
      // extraction segment so it never fake-creeps.
      progress?: number | null;
      progressStage?: string | null;
      fileName?: string;
    }
  | { status: "failed"; error: string; fileName?: string }
  | ExtractCompletedResponse;

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

// Prep-bar phases. "uploading" is client-side (real byte progress from
// the XHR); the rest are the server milestones extract-source emits.
type PrepStage = "uploading" | "converting" | "analyzing" | "finishing";

// Localized caption for the current prep phase. Latin numerals only —
// the percentage is appended by the caller.
function prepStageLabel(stage: PrepStage | null, dict: Dictionary): string {
  const s = dict.flows.prepStage;
  switch (stage) {
    case "uploading":
      return s.uploading;
    case "converting":
      return s.converting;
    case "analyzing":
      return s.extracting;
    case "finishing":
      return s.finishing;
    default:
      return s.preparing;
  }
}

// POST the file to /api/extract with REAL upload-byte progress. `fetch`
// can't report request-body upload progress, so we drop to XHR for this
// one call (the rest of the flow stays on fetch). `onProgress` gets a
// 0..1 fraction of bytes sent. Honors the same AbortSignal the polling
// loop uses so a file-swap / unmount aborts the in-flight upload.
function uploadExtract(
  formData: FormData,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/extract");
    xhr.responseType = "json";

    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(1, e.loaded / e.total));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as { jobId?: string } | null;
        if (body?.jobId) resolve({ jobId: body.jobId });
        else reject(new Error("No jobId returned from /api/extract"));
      } else {
        const body = xhr.response as { error?: string } | null;
        reject(new Error(body?.error ?? `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Upload failed (network error)"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(formData);
  });
}

// State machine — drives the Generate button label + disabled state.
// idle        — no file selected yet
// extracting  — file uploaded, polling /api/extract/[jobId]
// ready       — extraction completed, Generate active
// submitting  — Generate clicked, POSTing /api/projects
type Stage = "idle" | "extracting" | "ready" | "submitting";

// Resolved brand-font shape we POST to /api/projects. Mirrors the
// shape /create writes so the server contract is identical between
// flows. Null when no font was picked. A single brandFont resolves to
// ONE field reused for heading + body (one family, Claude varies
// weights / pairs uploads) — same model as /create.
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

// Editable brand palette bounds — mirror /create's values so the
// swatch UX is identical across flows.
const MIN_PALETTE = 2;
const MAX_PALETTE = 6;

export default function EnhanceContentPage() {
  const dict = useDict();
  const { dir } = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCancelledRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [extracted, setExtracted] = useState<
    ExtractCompletedResponse["result"] | null
  >(null);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);

  // Accurate prep progress for the dropzone. The bar maps real signals
  // onto a single 0→100 scale: upload bytes = 0→35%, extraction
  // milestones = 35→95%, completion = 100%. No interpolation/fake-creep
  // — when LibreOffice is converting (a black box) the bar honestly
  // holds at its last milestone until the next real signal arrives.
  const [prepPercent, setPrepPercent] = useState(0);
  const [prepStage, setPrepStage] = useState<PrepStage | null>(null);

  // Brand picks — optional. Empty = Claude reads the brand identity
  // from the PDF visually. Filled = user's pick wins on the brief.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Pre-loaded logo from a brand kit / default kit. Same shape
  // /create + /mimic use — see those files for the rationale.
  const [loadedLogo, setLoadedLogo] = useState<HydratedBrand["logo"]>(null);
  // Pre-loaded palette from the same brand-kit hydration. Captured in
  // local state because `seedFromExtraction` will OVERWRITE the
  // `taqreer:create:brand` sessionStorage entry with the extraction's
  // colors after the PDF is parsed — without this snapshot, the
  // brand-kit colors would silently get replaced by whatever the
  // extraction guessed. `handleGenerate` prefers this when assembling
  // `mergedBrand.colors` (CR #41 finding, 2026-05-28).
  // Editable brand palette — the single source of truth for the new
  // palette picker AND the submit. Seeded from the brand kit on
  // hydration (kit wins, CR #41) and from the extraction's colours only
  // if still empty. Starts empty so the extraction's suggestion can
  // fill it on a fresh run with no kit.
  const [colors, setColors] = useState<string[]>([]);
  const updateColor = (index: number, next: string) =>
    setColors((c) => c.map((v, i) => (i === index ? next : v)));
  const addColor = () =>
    setColors((c) => (c.length >= MAX_PALETTE ? c : [...c, "#FFFFFF"]));
  const removeColor = (index: number) =>
    setColors((c) =>
      c.length <= MIN_PALETTE ? c : c.filter((_, i) => i !== index),
    );
  // Single brand font — one Google family (Claude varies weights) OR up
  // to 5 uploaded families (Claude pairs). Replaces the old heading +
  // body two-slot UI; mirrors /create's BrandFontPicker model.
  const [brandFont, setBrandFont] = useState<BrandFontState>(emptyBrandFont());
  // Saved brand kits for the in-card dropdown (last 5). `options` drives
  // the menu; `raw` maps the picked id → HydratedBrand on select.
  const [kitOptions, setKitOptions] = useState<BrandKitOption[]>([]);
  const kitRawRef = useRef<Map<string, unknown>>(new Map());
  const [saveBrandKit, setSaveBrandKit] = useState<boolean>(false);

  // Apply a resolved brand (sessionStorage, default kit, or a picked
  // saved kit) to the card state. Maps the heading font slot → the
  // single brandFont model (Google family OR one uploaded family);
  // colours + logo + position apply directly. Shared by mount
  // hydration + the in-card brand-kit dropdown. Mirrors /create.
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
  // flow + the post-extraction `seedFromExtraction` BOTH write here).
  // Falls back to the user's default brand kit. We DO NOT clear
  // sessionStorage afterward on /enhance — the submit path below reads
  // the same key as a colour fallback. Clearing would orphan the
  // extraction's seeded colors.
  useEffect(() => {
    let aborted = false;
    (async () => {
      let hydrated = readBrandFromSession();
      let fromDefault = false;
      if (!hydrated) {
        hydrated = await fetchDefaultBrandKit();
        fromDefault = true;
      }
      if (aborted || !hydrated) return;
      applyBrand(hydrated);
      // If the default-kit fetch was the source, ALSO write its colors
      // to sessionStorage so the existing submit path (which reads
      // colors from sessionStorage as a fallback) sees them.
      if (fromDefault && hydrated.colors.length > 0) {
        try {
          const existing = window.sessionStorage.getItem(
            "taqreer:create:brand",
          );
          const blob = existing ? JSON.parse(existing) : {};
          window.sessionStorage.setItem(
            "taqreer:create:brand",
            JSON.stringify({ ...blob, colors: hydrated.colors }),
          );
        } catch {
          /* best-effort */
        }
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

  // ─── File selection (source PDF/PPTX) ────────────────────────
  // setStage("extracting") + setError("") moved here from the
  // useEffect body (2026-05-26, CR finding) — calling setState
  // synchronously inside an effect tripped the
  // react-hooks/set-state-in-effect lint rule and could cause
  // a cascading-render warning. Setting them at the file-pick
  // call site instead is the canonical pattern: the effect
  // then only owns the external work (upload + poll).
  const validateAndSetFile = (next?: File | null): File | null => {
    if (!next) return null;
    const lower = next.name.toLowerCase();
    const extOk =
      lower.endsWith(".pdf") ||
      lower.endsWith(".pptx") ||
      lower.endsWith(".ppt");
    if (!extOk) {
      setError(dict.flows.enhance.fileTypeError);
      return null;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setError(
        dict.flows.enhance.fileTooLarge.replace(
          "{size}",
          `${(next.size / 1024 / 1024).toFixed(1)} ${dict.flows.unitMB}`,
        ),
      );
      return null;
    }
    pollCancelledRef.current = false;
    setFile(next);
    setExtracted(null);
    setStage("extracting");
    setPrepPercent(0);
    setPrepStage("uploading");
    setError("");
    return next;
  };

  const removeFile = () => {
    pollCancelledRef.current = true;
    setFile(null);
    setExtracted(null);
    setStage("idle");
    setPrepPercent(0);
    setPrepStage(null);
    setError("");
    // Clear the input element so re-selecting the SAME file re-fires change.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Polling helper ──────────────────────────────────────────
  // Takes an AbortSignal so an in-flight `fetch` actually aborts on
  // unmount / file-swap. Pre-fix (CR #36, 2026-05-25) we only set a
  // `pollCancelledRef` flag — the flag was checked at the top of each
  // loop iteration, but the fetch ITSELF kept running its full
  // round-trip even after the component unmounted, holding a request
  // slot open and arriving with `setExtracted` calls into a torn-down
  // tree (the `isCurrent` guard at the call site dropped the result,
  // but the network work was wasted). With AbortController + signal,
  // a pending fetch is cancelled the moment the effect cleanup fires.
  const pollExtraction = async (
    jobId: string,
    signal: AbortSignal,
    onProgress?: (percent: number, stage: PrepStage | null) => void,
  ): Promise<ExtractCompletedResponse["result"]> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted || pollCancelledRef.current) {
        throw new Error("Cancelled");
      }
      const res = await fetch(`/api/extract/${jobId}`, { signal });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Status ${res.status}`);
      }
      const body = (await res.json()) as ExtractStatusResponse;
      if (body.status === "completed") return body.result;
      if (body.status === "failed") {
        throw new Error(body.error ?? "Extraction failed");
      }
      // queued/processing — surface the real milestone if one's landed.
      if (onProgress && typeof body.progress === "number" && body.progress >= 0) {
        const stage: PrepStage | null =
          body.progressStage === "converting" ||
          body.progressStage === "analyzing" ||
          body.progressStage === "finishing"
            ? body.progressStage
            : null;
        onProgress(body.progress, stage);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("Extraction timed out. Try a smaller file.");
  };

  // ─── Auto-start extraction on file selection ─────────────────
  // Stage/error/cancel-flag setters live in `validateAndSetFile` so
  // this effect body only owns external work (POST + poll) — keeps
  // the react-hooks/set-state-in-effect lint clean.
  useEffect(() => {
    if (!file) return;

    // One controller per file selection — aborts the in-flight POST
    // /api/extract AND the polling fetch when the effect cleans up
    // (file swap, unmount, navigation away). Pre-fix the network
    // work continued past unmount; now it terminates cleanly.
    const controller = new AbortController();

    let isCurrent = true;
    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", "enhance");
        formData.append("format", "16:9");

        // Phase 1 — upload (real bytes → 0..35% of the prep bar).
        const { jobId } = await uploadExtract(
          formData,
          controller.signal,
          (fraction) => {
            if (isCurrent) {
              setPrepPercent(Math.min(35, Math.round(fraction * 35)));
              setPrepStage("uploading");
            }
          },
        );

        // Bytes are in; the server hasn't emitted a milestone yet. Drop
        // to the neutral "preparing" label (null) so we don't keep
        // claiming "uploading" during the queue→first-milestone gap.
        if (isCurrent) setPrepStage(null);

        // Phase 2 — extraction (job milestones → 35..95% of the bar).
        const result = await pollExtraction(
          jobId,
          controller.signal,
          (extractionPercent, stage) => {
            if (isCurrent) {
              setPrepPercent(35 + Math.round((extractionPercent / 100) * 60));
              if (stage) setPrepStage(stage);
            }
          },
        );
        if (!isCurrent) return;
        // Phase 3 — done → snap to 100%.
        setPrepPercent(100);
        setPrepStage(null);
        setExtracted(result);
        setStage("ready");

        // Seed the editable palette from the extraction's colours — but
        // only if the brand kit hasn't already provided some (kit wins,
        // CR #41). The user can then tweak them in the picker.
        setColors((prev) => (prev.length > 0 ? prev : result.colors));

        // Seed sessionStorage with extraction's brand pre-fill (colors,
        // fonts hint, format). Logo + user-picked fonts come from local
        // state on submit, so they're NOT seeded here — they're
        // intentionally separate from the extracted defaults.
        seedFromExtraction({
          source: {
            kind: "enhance",
            ...(result.anthropicFileId
              ? { anthropicFileId: result.anthropicFileId }
              : {}),
            fonts: result.fonts,
            textPerSlide: result.textPerSlide,
            sourcePath: result.sourcePath,
            sourceMime: result.sourceMime,
          },
          brand: {
            colors: result.colors,
            fonts: result.fonts,
            format: result.format,
          },
        });

        // Stamp slide count + size into output sessionStorage —
        // /api/projects reads these for the brief's slideCount /
        // slideSize fields.
        try {
          const OUTPUT_KEY = "taqreer:create:output";
          const existing = sessionStorage.getItem(OUTPUT_KEY);
          const obj = existing ? JSON.parse(existing) : {};
          sessionStorage.setItem(
            OUTPUT_KEY,
            JSON.stringify({
              ...obj,
              slideSize: result.format,
              slideCount: {
                mode: "custom",
                value: result.pageCount > 0 ? result.pageCount : null,
              },
            }),
          );
        } catch {
          /* best-effort */
        }

        sessionStorage.setItem(
          "taqreer:create:content",
          JSON.stringify({ type: "source", fileName: file.name }),
        );
      } catch (err) {
        // AbortError is the expected outcome when the effect cleanup
        // aborts the controller (file swap / unmount / navigation).
        // Treat it the same as the explicit pollCancelledRef path —
        // silently reset to idle, no error toast.
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
        if (!isCurrent || pollCancelledRef.current || isAbort) {
          setStage("idle");
          return;
        }
        console.error("[enhance] extraction failed:", err);
        setError(
          err instanceof Error ? err.message : dict.flows.enhance.extractFailed,
        );
        setStage("idle");
      }
    })();

    return () => {
      isCurrent = false;
      pollCancelledRef.current = true;
      controller.abort();
    };
  }, [file, dict]);

  // ─── Submit ──────────────────────────────────────────────────
  // 1. Upload optional logo + font files (parallel) to brand-assets
  // 2. Resolve font slots into the brand.fonts shape
  // 3. POST /api/projects with the merged brief
  const handleGenerate = async () => {
    if (stage !== "ready" || !extracted || !file) return;
    setError("");
    setStage("submitting");
    try {
      // Step 1: upload the optional logo. uploadAsset returns null when
      // the input file is null, so a not-picked logo is a no-op.
      const logoUploaded = await uploadAsset(
        "brand-assets",
        "logos",
        logoFile,
      );

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

      const source = readSource();

      // Pull the seeded extraction colors from sessionStorage so the
      // brief still carries them — extraction's palette is the
      // suggestion until we add a palette picker to this page.
      const rawBrand = sessionStorage.getItem("taqreer:create:brand");
      const rawOutput = sessionStorage.getItem("taqreer:create:output");
      const seededBrand = rawBrand
        ? (JSON.parse(rawBrand) as {
            colors?: string[];
            paletteMode?: string;
            paletteScreenshotUrl?: string | null;
          })
        : {};
      const output = rawOutput
        ? (JSON.parse(rawOutput) as {
            slideSize?: "16:9" | "9:16";
            slideCount?: { mode?: string; value?: number | null };
          })
        : {};

      const resolvedSlideCount =
        output?.slideCount?.mode === "custom" && output.slideCount.value
          ? output.slideCount.value
          : null;

      // Brand object on the brief. User picks (logo + fonts) win;
      // colors come from extraction (no UI for them on this page yet).
      // Logo position defaults to top-end (top-left in LTR/EN, top-right
      // in RTL/AR); the cover/closing exclude list is empty so Claude
      // places it on every slide.
      // Resolve the logo's storageUrl in priority order: fresh
      // upload wins, then the hydrated kit's stored path. Same
      // pattern as /create + /mimic.
      const resolvedLogoStorageUrl =
        logoUploaded?.storageUrl ?? loadedLogo?.storageUrl ?? null;

      // The editable `colors` state is the source of truth — seeded from
      // the brand kit (kit wins, CR #41) then the extraction, and tweakable
      // in the palette picker. Falls back to the sessionStorage-seeded
      // colours only if the user somehow cleared the palette entirely.
      const mergedBrand = {
        colors: colors.length > 0 ? colors : seededBrand.colors ?? [],
        paletteMode: seededBrand.paletteMode ?? "manual",
        paletteScreenshotUrl: seededBrand.paletteScreenshotUrl ?? null,
        fonts: {
          heading: fontField,
          body: fontField,
          ...(uploadedFontFields.length > 0
            ? { uploaded: uploadedFontFields }
            : {}),
        },
        logo: resolvedLogoStorageUrl
          ? {
              storageUrl: resolvedLogoStorageUrl,
              exclude: [] as ("cover" | "closing")[],
            }
          : null,
        slideSize: output.slideSize ?? extracted.format ?? "16:9",
        slideCount: output.slideCount ?? { mode: "auto", value: null },
      };

      // Content stub — enhance flow has no text content; the source
      // file IS the content.
      const content = { type: "source" as const, fileName: file.name };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          brand: mergedBrand,
          rules: null,
          // Use the language detected from the source PPTX/PDF
          // during extraction. Falls back to "ar" when detection
          // returned null (PDF inputs, empty PPTX text, or genuine
          // ambiguity) — same default we had before detection.
          // The detected value flows into deck-generate's brief →
          // streaming preview's `streamingLanguage`, so the
          // SlideNavSidebar renders in the right direction from
          // first paint instead of flipping mid-stream.
          language: extracted.language ?? "ar",
          saveBrandKit,
          slideCount: resolvedSlideCount,
          quality,
          ...(source ? { source } : {}),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? dict.flows.createFailed);
      }

      const data = (await response.json()) as { projectId: string };

      sessionStorage.removeItem("taqreer:create:content");
      sessionStorage.removeItem("taqreer:create:brand");
      sessionStorage.removeItem("taqreer:create:brand:savedSnapshot");
      sessionStorage.removeItem("taqreer:create:output");
      clearSource();

      router.push(`/project/${data.projectId}`);
    } catch (err) {
      console.error("[enhance] generate failed:", err);
      setError(
        err instanceof Error ? err.message : dict.flows.startFailed,
      );
      setStage("ready");
    }
  };

  const generateDisabled = stage === "idle";
  const generateLoading = stage === "extracting" || stage === "submitting";
  const generateLabel = dict.flows.generate.create;
  // While preparing files, the button shows the live prep percentage
  // (instead of a static "analyzing…" string) so the CTA itself is the
  // progress readout. During the final POST it falls back to a label.
  const generateLoadingLabel =
    stage === "extracting" ? `${prepPercent}%` : dict.flows.generate.creating;


  return (
    // Outer wrapper centered horizontally. Anchored toward top-third
    // so the 3-card row sits in the visual sweet-spot instead of
    // dead-center where it'd float low on tall screens.
    <div className="page-container flex w-full justify-center" dir={dir}>
      <div className="mt-[6vh] flex w-full max-w-3xl flex-col items-center gap-6 px-4">
        <header className="text-center">
          <h1 className="tq-h1">{dict.flows.enhance.title}</h1>
          <p className="tq-subhead mt-2">{dict.flows.enhance.subtitle}</p>
        </header>

        {/* 2-card horizontal row. RTL flow: source/logo (start, visual
            right) → fonts (end, visual left). Both cards flex-1 so
            they share the row width equally; items-stretch makes the
            fonts card grow to match the source card's height (which
            is taller — dropzone + logo stacked + file chip). */}
        {/* flex-wrap so the row collapses gracefully on narrow
            viewports — same responsive pattern /create + /mimic use.
            Cards keep flex-1 to share row width but each carries a
            min-w so they wrap (rather than infinitely shrink) when
            the container can't fit both side-by-side. */}
        <div className="flex w-full flex-wrap items-stretch gap-4">
          {/* ─── Source + Logo card ──────────────────────────
              File dropzone on top (primary action), logo dropzone
              underneath (optional brand asset). One card because
              the two sub-cards looked unbalanced at equal width —
              the file area needs much more vertical real estate.
              p-4 + gap-4 deliberately tighter than the create-flow
              cards so the row reads compact, not airy. */}
          <div className="surface-card flex min-h-[540px] min-w-[320px] flex-1 flex-col gap-4 rounded-2xl p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
              className="hidden"
              onChange={(event) =>
                validateAndSetFile(event.target.files?.[0])
              }
            />

            <CardHeader icon="subject" title={dict.flows.enhance.originalFile} />

            {/* File dropzone — primary action of the page.
                When a file IS selected, the dropzone CONTENT swaps to
                show the file's name + size + a stage caption (instead
                of pushing a separate file-chip below the dropzone,
                which made the card much taller). A small remove
                button absolutely positions at the visual start corner
                so the user can clear the pick without re-triggering
                the file picker — `stopPropagation` keeps the button's
                click from bubbling up to the dropzone parent.
                flex-1 on the inner wrapper + h-full on the relative
                container makes the dropzone consume all remaining
                vertical space inside the card (CARD_MIN_H = 387 px
                pins the card at /create + /mimic's baseline). */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="relative h-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    validateAndSetFile(event.dataTransfer.files?.[0]);
                  }}
                  disabled={stage === "extracting" || stage === "submitting"}
                  className={`flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    dragging
                      ? "border-white/40 bg-white/[0.04]"
                      : "border-white/20 bg-black/20 hover:border-white/30"
                  }`}
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--tq-surface)]"
                  >
                    {stage === "extracting" ? (
                      <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
                    ) : stage === "ready" ? (
                      <span
                        className="material-symbols-outlined text-emerald-300"
                        style={{ fontSize: "22px" }}
                      >
                        check_circle
                      </span>
                    ) : file ? (
                      <span
                        className="material-symbols-outlined text-white/80"
                        style={{ fontSize: "22px" }}
                      >
                        description
                      </span>
                    ) : (
                      <span
                        className="material-symbols-outlined text-white/80"
                        style={{ fontSize: "22px" }}
                      >
                        cloud_upload
                      </span>
                    )}
                  </span>

                  {file ? (
                    // File picked — show name + size + stage caption.
                    // Replaces the drop-prompt entirely so the dropzone
                    // doubles as a file chip without pushing extra height.
                    <div className="w-full px-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {readableFileName(file.name)}
                      </p>
                      <p className="mt-0.5 text-xs text-white/60">
                        {formatFileSize(file.size, dict)}
                        {stage === "extracting"
                          ? ` · ${prepStageLabel(prepStage, dict)} ${prepPercent}%`
                          : stage === "ready"
                            ? dict.flows.enhance.readyToCreate
                            : stage === "submitting"
                              ? dict.flows.enhance.creating
                              : ""}
                      </p>
                      {stage === "extracting" ? (
                        <div
                          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10"
                          role="progressbar"
                          aria-valuenow={prepPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-white/70 transition-[width] duration-300 ease-out"
                            style={{ width: `${prepPercent}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    // No file — drop prompt.
                    <>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {dict.flows.enhance.dragDrop}
                        </p>
                        <p className="mt-0.5 text-xs text-white/60">
                          {dict.flows.enhance.clickToSelect}
                        </p>
                      </div>
                      <p className="text-[10px] text-white/40">
                        {dict.flows.enhance.fileHint}
                      </p>
                    </>
                  )}
                </button>

                {/* Remove button — overlays at the visual start corner
                    when a file is picked. Sibling (not child) of the
                    dropzone button so we don't nest <button>s.
                    stopPropagation ensures clicking it doesn't also
                    open the file picker. Hidden during extraction /
                    submission since cancelling mid-flight wasn't
                    designed for (the poller would resolve into an
                    already-removed state and surface confusing errors). */}
                {file && stage !== "extracting" && stage !== "submitting" ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFile();
                    }}
                    aria-label={dict.flows.removeFile}
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
            </div>

          </div>

          {/* ─── Brand card (الهوية البصرية) ─────────────────
              Replicates /create's consolidated brand card — saved-kit
              dropdown in the header, palette, single brand-font picker,
              logo row, save toggle. Same min-h / min-w / flex-1 sizing
              as the source card so the two-card row stays balanced. */}
          <div className="surface-card flex min-h-[540px] min-w-[320px] flex-1 flex-col gap-4 rounded-2xl p-4">
            {/* Inline header (not CardHeader) so the saved-kit pill can
                overlay the title row. Mirrors /create's branding header:
                pb-4 balances the card's p-4 top padding so the title sits
                centred in the strip; z-30 lifts the open menu above the
                later rows. */}
            <header className="relative z-30 border-b border-white/[0.08] pb-4">
              <div className="relative flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-white"
                  style={{ fontSize: 18 }}
                >
                  palette
                </span>
                <h3 className="text-sm font-semibold text-white">
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

            {/* Palette row — byte-for-byte the /create cluster: label
                on the visual right, swatches + add tile on the visual
                left. Uses the shared InlinePaletteSwatch + the same
                add/remove/update handlers. */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white/70">
                {dict.flows.colors}
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
                    aria-label={dict.flows.addColor}
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

            {/* Single brand font — one Google family (Claude varies
                weights) OR up to 5 uploaded families (Claude pairs).
                Replaces the old heading + body two-slot UI; identical to
                /create's BrandFontPicker. */}
            <div className="border-t border-[var(--tq-border-hairline)] pt-3">
              <BrandFontPicker
                value={brandFont}
                onChange={setBrandFont}
                sampleText={
                  extracted?.language === "en"
                    ? HEADING_SAMPLE_LATIN
                    : HEADING_SAMPLE_AR
                }
              />
            </div>

            {/* Logo — flex-1 so the dropzone grows to fill the card's
                leftover height (matches /create); gap-4 unifies the
                title→zone gap with الخطوط. */}
            <div className="flex flex-1 flex-col gap-4 border-t border-[var(--tq-border-hairline)] pt-3">
              <span className="block text-xs font-semibold text-white/70">
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

            {/* Save brand kit — mirrors /create's footer toggle. The logo
                section's flex-1 absorbs the slack and pushes this to the
                bottom, so no mt-auto (it would otherwise eat the slack and
                stop the logo zone from growing). */}
            <div className="flex items-center justify-between gap-2 border-t border-[var(--tq-border-hairline)] pt-2">
              <span className="text-xs font-semibold text-white/70">
                {dict.flows.saveAsDefault}
              </span>
              <Toggle
                ariaLabel={dict.flows.saveAsDefault}
                value={saveBrandKit}
                onChange={setSaveBrandKit}
              />
            </div>
          </div>
        </div>

        {/* Generate split-button — sits OUTSIDE the cards, centered
            horizontally below. Same chrome + size as /create/summary's
            CTA. Disabled until extraction finishes; loading state
            during extraction AND the final POST so the user sees
            continuous progress through both phases. Preset menu
            (right half of the split) lets the user pick a generation
            quality. */}
        <div className="flex justify-center">
          <GenerateSplitButton
            onGenerate={handleGenerate}
            quality={quality}
            onQualityChange={setQuality}
            slideCount={extracted?.pageCount ?? undefined}
            disabled={generateDisabled}
            loading={generateLoading}
            label={generateLabel}
            loadingLabel={generateLoadingLabel}
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

