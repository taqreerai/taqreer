"use client";

// Shared export-actions hook — single source of truth for the
// four export pipelines (PPTX / PDF / PNG / Google Slides, the
// last riding the PPTX pipeline). Extracted from PreviewActionBar
// 2026-05-23 so the new ShareDialog Export tab can drive the SAME
// handlers + share their busy / error state.
//
// Cross-instance busy serialisation
// ---------------------------------
// Both PreviewActionBar (toolbar) and ShareDialog (modal Export tab)
// instantiate this hook with the same `projectId`. Each instance
// keeps LOCAL per-pipeline state (`exportPptx` etc.) for its own
// spinner / inline error toast, but the `busy` flag is read from a
// module-scoped store keyed by projectId. So clicking PPTX in the
// toolbar disables PNG/PDF/HTML in the modal too — no parallel
// Puppeteer runs from the same user kicking the deck twice.
//
// Implementation: `useSyncExternalStore` subscribes each instance
// to the store; the runners flip the shared bit on entry and reset
// on exit (try/finally). The store is a module-scoped Map so it
// survives across the React tree without a Context provider.

import { useState, useSyncExternalStore } from "react";
import posthog from "posthog-js";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import { isPdfPngOnlyFormat } from "@/lib/export/export-gating";
import { exportManifestAsPptx } from "@/lib/export/html-export";
import {
  ensureDriveToken,
  uploadPptxAsGoogleSlides,
  rasterizeSvgsForSlides,
} from "@/lib/export/google-slides";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";

// ─── Shared cross-instance busy store ───────────────────────────────

type BusyEntry = { busy: boolean; subscribers: Set<() => void> };
const busyByProjectId = new Map<string, BusyEntry>();

function getOrCreateEntry(projectId: string): BusyEntry {
  let entry = busyByProjectId.get(projectId);
  if (!entry) {
    entry = { busy: false, subscribers: new Set() };
    busyByProjectId.set(projectId, entry);
  }
  return entry;
}

function subscribeBusy(projectId: string, cb: () => void): () => void {
  const entry = getOrCreateEntry(projectId);
  entry.subscribers.add(cb);
  return () => {
    entry.subscribers.delete(cb);
  };
}

function readBusy(projectId: string): boolean {
  // Don't auto-create on read — initial render before any export
  // has run should report `false` without leaking an empty entry
  // into the map.
  return busyByProjectId.get(projectId)?.busy ?? false;
}

function setBusy(projectId: string, value: boolean): void {
  const entry = getOrCreateEntry(projectId);
  if (entry.busy === value) return;
  entry.busy = value;
  entry.subscribers.forEach((cb) => cb());
}

// Durable export-activity logging for the admin console. The pdf/png server
// routes write their own ExportEvent rows; the client-built pptx/gslides
// pipelines have no server route, so they POST here to land in the per-user
// activity log too. Fire-and-forget: never blocks or fails the export.
function logExport(
  projectId: string,
  format: "pptx" | "gslides" | "gslides_fallback_pptx",
  slideCount: number,
): void {
  fetch(`/api/projects/${projectId}/export/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, slideCount }),
    keepalive: true,
  }).catch(() => {});
}

export type ExportStatus = "idle" | "running" | "success" | "error";
export type ExportButtonState = { status: ExportStatus; message?: string };

// "gslides" replaced "html" 2026-07-13 (user direction): the deck lands in
// the user's Google Drive as a NATIVE Google Slides presentation. The
// artifact still comes from the SAME dom-to-pptx pipeline (keeping the
// BiDi/RTL fixes); Drive converts it on upload. See lib/export/google-slides.
export type ExportKind = "pptx" | "pdf" | "png" | "gslides";

export type UseExportActionsResult = {
  states: Record<ExportKind, ExportButtonState>;
  /** True while any of the four pipelines is running. Disable group. */
  busy: boolean;
  /** First error message across the four pipelines, for toast surfacing. */
  lastError: string | null;
  /** Set when a Google Slides upload completed - the caller renders the
   *  "deck is ready → Open" dialog (a click-gesture open dodges popup
   *  blockers; an async window.open after the upload would be eaten). */
  gslidesUrl: string | null;
  clearGslidesUrl: () => void;
  runPptx: () => Promise<void>;
  runPdf: () => Promise<void>;
  runPng: () => Promise<void>;
  runGslides: () => Promise<void>;
};

// Filename sanitiser — same recipe PreviewActionBar used inline.
// Strips Windows/POSIX-forbidden characters, collapses whitespace,
// trims to 80 chars, falls back to "presentation" for empty.
function baseFileName(title: string): string {
  return (
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "presentation"
  );
}

export function useExportActions({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
  isSocial,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  formatFallback?: SlideFormat;
  // Social decks export PDF/PNG only at ANY ratio (incl. 9:16/16:9, which are
  // not PDF/PNG-only formats). The runners enforce it too, not just the menus.
  // REQUIRED (no default) so a new caller can't silently bypass the restriction.
  isSocial: boolean;
}): UseExportActionsResult {
  const [exportPptx, setExportPptx] = useState<ExportButtonState>({
    status: "idle",
  });
  const [exportPdf, setExportPdf] = useState<ExportButtonState>({
    status: "idle",
  });
  const [exportPng, setExportPng] = useState<ExportButtonState>({
    status: "idle",
  });
  const [exportGslides, setExportGslides] = useState<ExportButtonState>({
    status: "idle",
  });
  const [gslidesUrl, setGslidesUrl] = useState<string | null>(null);
  const dict = useDict();
  // Free plan (2026-10-02): the exporter's PPTX carries the "Made with
  // taqreer.ai" badge on every slide + the branded closing slide. Paid
  // plans and admins export clean. (PPTX is gated while the plan is still
  // unknown, so null never reaches an export.)
  const credits = useCreditBalance();
  const freeBranding = !!credits && !credits.isAdmin && credits.plan === "free";
  // Localized copy for the server's `export_gated` 402 so the toast is
  // never English on an Arabic deck. The UI normally crowns gated formats
  // + opens the upgrade modal before ever calling the route, so this is
  // the defensive path (plan changed mid-session, devtools, etc.).
  const gatedExportMessage = dict.components.creditGate.exportLockedTitle;

  // Cross-instance busy — subscribes both this instance (which sets
  // it inside each runner) AND any OTHER `useExportActions` hook
  // mounted with the same projectId. So the toolbar's PPTX click
  // also disables the modal's row, and vice versa. Local pipeline
  // states above stay per-instance for spinner / error display.
  const busy = useSyncExternalStore(
    (cb) => subscribeBusy(projectId, cb),
    () => readBusy(projectId),
    () => false,
  );

  // Common manifest patch — back-fills `format` from the project-
  // level fallback for legacy manifests where deck-generate hadn't
  // started stamping `format` yet. Without this, a 9:16 deck exports
  // landscape because exportManifestAsPptx falls through to the
  // 16:9 default.
  const exportManifest = {
    ...manifest,
    format: manifest.format ?? formatFallback ?? "16:9",
  };

  // Tiny helper that wraps each runner's body so the shared lock
  // is always flipped on entry + released on exit (try/finally).
  // `read` consults the store directly — `busy` snapshot from
  // useSyncExternalStore could be stale by the time the user
  // clicks twice quickly, but the store is authoritative.
  const guard = async (work: () => Promise<void>) => {
    if (readBusy(projectId)) return;
    setBusy(projectId, true);
    try {
      await work();
    } finally {
      setBusy(projectId, false);
    }
  };

  // Free plan: the server's PNG renders of every slide (watermark + branded
  // closing slide included), unpacked in slide order as data URLs.
  const fetchWatermarkedSlideImages = async (): Promise<string[]> => {
    const response = await fetch(`/api/projects/${projectId}/export/png`, { method: "POST" });
    if (!response.ok) throw new Error("PNG render failed");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await response.blob());
    const names = Object.keys(zip.files)
      .filter((n) => /^slide-\d+\.png$/.test(n))
      .sort();
    return Promise.all(
      names.map(async (n) => `data:image/png;base64,${await zip.file(n)!.async("base64")}`),
    );
  };

  // ── PPTX (client-side, dom-to-pptx + BiDi post-processor) ────────
  // Also the engine under the Google Slides entry below (which uploads
  // the same artifact to Drive instead of downloading it).
  const runPptxPipeline = (
    kind: "pptx",
    setState: (s: ExportButtonState) => void,
  ) =>
    guard(async () => {
      // Social decks (any ratio) + PDF/PNG-only formats can't produce PPTX. The
      // UI hides this entry (ExportMenu / ShareDialog); this is the belt-and-
      // braces stop for any stale surface that still offers it.
      if (isSocial || isPdfPngOnlyFormat(exportManifest.format)) {
        setState({ status: "error", message: "تعذر التصدير" });
        return;
      }
      setState({ status: "running", message: "جار التصدير..." });
      try {
        const fileName = `${baseFileName(manifest.title || projectTitle)}.pptx`;
        if (freeBranding) {
          // Free plan: a present-ready PPTX built from the server's PNG
          // renders (watermark + branded closing slide baked into the
          // pictures). The editable PPTX is a paid feature.
          const imageSlides = await fetchWatermarkedSlideImages();
          await exportManifestAsPptx(exportManifest, fileName, { imageSlides });
        } else {
          await exportManifestAsPptx(exportManifest, fileName);
        }
        // Conversion-funnel export step, client-side: PPTX is generated in the
        // browser (no server route, unlike pdf/png). Consent-gated like all
        // client capture; distinct_id is the identified user (= Supabase uid),
        // so it lines up with the server-side funnel events.
        posthog.capture("deck_exported", {
          format: kind,
          project_id: projectId,
          slide_count: manifest.slides.length,
        });
        logExport(projectId, "pptx", manifest.slides.length);
        setState({ status: "idle" });
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "تعذر التصدير",
        });
      }
    });
  const runPptx = () => runPptxPipeline("pptx", setExportPptx);

  // ── Google Slides (dom-to-pptx blob → Drive upload → native Slides) ──
  // Token FIRST: the GIS consent popup must ride the click gesture; the
  // multi-second PPTX build would outlive the browser's activation window.
  // Declined consent / missing config falls back to the plain PPTX
  // download so the menu entry never dead-ends.
  const runGslides = () =>
    guard(async () => {
      // Google Slides rides the PPTX pipeline, so mirror its restriction:
      // social decks (any ratio) + PDF/PNG-only formats can't produce Slides.
      if (isSocial || isPdfPngOnlyFormat(exportManifest.format)) {
        setExportGslides({ status: "error", message: "تعذر التصدير" });
        return;
      }
      setExportGslides({ status: "running", message: "جار التصدير..." });
      const title = baseFileName(manifest.title || projectTitle);
      let token: string;
      try {
        token = await ensureDriveToken();
      } catch {
        // ANY token-acquisition failure falls back to the plain PPTX
        // download so the export never dead-ends: declined / unconfigured
        // consent (GoogleSlidesConfigError / GoogleAuthDeclinedError) AND
        // a blocked or unreachable GIS script (plain Error). The upload
        // path below owns the post-token failures.
        try {
          await exportManifestAsPptx(exportManifest, `${title}.pptx`);
          posthog.capture("deck_exported", {
            format: "gslides_fallback_pptx",
            project_id: projectId,
            slide_count: manifest.slides.length,
          });
          logExport(projectId, "gslides_fallback_pptx", manifest.slides.length);
          setExportGslides({ status: "idle" });
        } catch (fallbackError) {
          setExportGslides({
            status: "error",
            message:
              fallbackError instanceof Error
                ? fallbackError.message
                : "تعذر التصدير",
          });
        }
        return;
      }
      try {
        const { blob } = await exportManifestAsPptx(
          exportManifest,
          `${title}.pptx`,
          { skipDownload: true },
        );
        if (!blob) throw new Error("PPTX build produced no blob");
        // Slides can't render SVG - swap the upload copy to the raster
        // fallbacks (see rasterizeSvgsForSlides). Download path untouched.
        const slidesSafe = await rasterizeSvgsForSlides(blob);
        const { url } = await uploadPptxAsGoogleSlides(slidesSafe, title, token);
        posthog.capture("deck_exported", {
          format: "gslides",
          project_id: projectId,
          slide_count: manifest.slides.length,
        });
        logExport(projectId, "gslides", manifest.slides.length);
        setGslidesUrl(url);
        setExportGslides({ status: "idle" });
      } catch (error) {
        setExportGslides({
          status: "error",
          message: error instanceof Error ? error.message : "تعذر التصدير",
        });
      }
    });

  // ── PDF (server-side Puppeteer) ──────────────────────────────────
  const runPdf = () =>
    guard(async () => {
      setExportPdf({ status: "running", message: "جار تصدير PDF..." });
      try {
        const response = await fetch(`/api/projects/${projectId}/export/pdf`, {
          method: "POST",
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          throw new Error(
            data?.code === "export_gated"
              ? gatedExportMessage
              : (data?.error ?? "PDF export failed"),
          );
        }
        const blob = await response.blob();
        downloadBlob(blob, `${baseFileName(manifest.title || projectTitle)}.pdf`);
        setExportPdf({ status: "idle" });
      } catch (error) {
        setExportPdf({
          status: "error",
          message: error instanceof Error ? error.message : "تعذر تصدير PDF",
        });
      }
    });

  // ── PNG (server-side Puppeteer, ZIP of canvas-native PNGs) ───────
  const runPng = () =>
    guard(async () => {
      setExportPng({ status: "running", message: "جار تصدير الصور..." });
      try {
        const response = await fetch(`/api/projects/${projectId}/export/png`, {
          method: "POST",
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          throw new Error(
            data?.code === "export_gated"
              ? gatedExportMessage
              : (data?.error ?? "PNG export failed"),
          );
        }
        const blob = await response.blob();
        downloadBlob(
          blob,
          `${baseFileName(manifest.title || projectTitle)}-pngs.zip`,
        );
        setExportPng({ status: "idle" });
      } catch (error) {
        setExportPng({
          status: "error",
          message: error instanceof Error ? error.message : "تعذر تصدير الصور",
        });
      }
    });

  // First error across pipelines — caller can surface as a toast.
  // Order matches the toolbar's visibleMessage precedence so the
  // toast text is consistent across the two entry points.
  const lastError =
    (exportPptx.status === "error" ? exportPptx.message : null) ??
    (exportGslides.status === "error" ? exportGslides.message : null) ??
    (exportPng.status === "error" ? exportPng.message : null) ??
    (exportPdf.status === "error" ? exportPdf.message : null) ??
    null;

  return {
    states: {
      pptx: exportPptx,
      pdf: exportPdf,
      png: exportPng,
      gslides: exportGslides,
    },
    busy,
    lastError,
    gslidesUrl,
    clearGslidesUrl: () => setGslidesUrl(null),
    runPptx,
    runPdf,
    runPng,
    runGslides,
  };
}

// Inline blob-download helper. Same anchor-click trick the toolbar
// used inline; lifted here so PDF + PNG share it. Defers
// URL.revokeObjectURL by 1s — Safari's download flow needs a tick
// to read the blob URL before we drop it.
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
