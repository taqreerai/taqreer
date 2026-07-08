"use client";

// Shared export-actions hook — single source of truth for the
// four export pipelines (PPTX / PDF / PNG / HTML). Extracted from
// PreviewActionBar 2026-05-23 so the new ShareDialog Export tab
// can drive the SAME handlers + share their busy / error state.
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
import { exportManifestAsPptx } from "@/lib/export/html-export";
import { downloadHtmlDocument } from "@/lib/export/html-document";

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

export type ExportStatus = "idle" | "running" | "success" | "error";
export type ExportButtonState = { status: ExportStatus; message?: string };

export type ExportKind = "pptx" | "pdf" | "png" | "html";

export type UseExportActionsResult = {
  states: Record<ExportKind, ExportButtonState>;
  /** True while any of the four pipelines is running. Disable group. */
  busy: boolean;
  /** First error message across the four pipelines, for toast surfacing. */
  lastError: string | null;
  runPptx: () => Promise<void>;
  runPdf: () => Promise<void>;
  runPng: () => Promise<void>;
  runHtml: () => Promise<void>;
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
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  formatFallback?: SlideFormat;
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
  const [exportHtml, setExportHtml] = useState<ExportButtonState>({
    status: "idle",
  });

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

  // ── PPTX (client-side via dom-to-pptx + BiDi post-processor) ─────
  const runPptx = () =>
    guard(async () => {
      // 3:4 social-post decks are PDF/PNG only. The UI hides this entry
      // (ExportMenu / ShareDialog); this is the belt-and-braces stop for
      // any stale surface that still offers it.
      if (exportManifest.format === "3:4") {
        setExportPptx({ status: "error", message: "تعذر التصدير" });
        return;
      }
      setExportPptx({ status: "running", message: "جار التصدير..." });
      try {
        const fileName = `${baseFileName(manifest.title || projectTitle)}.pptx`;
        await exportManifestAsPptx(exportManifest, fileName);
        // Conversion-funnel export step, client-side: PPTX is generated in the
        // browser (no server route, unlike pdf/png). Consent-gated like all
        // client capture; distinct_id is the identified user (= Supabase uid),
        // so it lines up with the server-side funnel events.
        posthog.capture("deck_exported", {
          format: "pptx",
          project_id: projectId,
          slide_count: manifest.slides.length,
        });
        setExportPptx({ status: "idle" });
      } catch (error) {
        setExportPptx({
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
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "PDF export failed");
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
            | { error?: string }
            | null;
          throw new Error(data?.error ?? "PNG export failed");
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

  // ── HTML (client-side, raw standalone bundle) ────────────────────
  const runHtml = () =>
    guard(async () => {
      // Same 3:4 lock as runPptx above.
      if (exportManifest.format === "3:4") {
        setExportHtml({ status: "error", message: "تعذر التحميل" });
        return;
      }
      setExportHtml({ status: "running", message: "جار التحميل..." });
      try {
        const fileName = `${baseFileName(manifest.title || projectTitle)}.html`;
        downloadHtmlDocument(exportManifest, fileName);
        setExportHtml({ status: "idle" });
      } catch (error) {
        setExportHtml({
          status: "error",
          message: error instanceof Error ? error.message : "تعذر التحميل",
        });
      }
    });

  // First error across pipelines — caller can surface as a toast.
  // Order matches the toolbar's visibleMessage precedence so the
  // toast text is consistent across the two entry points.
  const lastError =
    (exportPptx.status === "error" ? exportPptx.message : null) ??
    (exportHtml.status === "error" ? exportHtml.message : null) ??
    (exportPng.status === "error" ? exportPng.message : null) ??
    (exportPdf.status === "error" ? exportPdf.message : null) ??
    null;

  return {
    states: {
      pptx: exportPptx,
      pdf: exportPdf,
      png: exportPng,
      html: exportHtml,
    },
    busy,
    lastError,
    runPptx,
    runPdf,
    runPng,
    runHtml,
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
