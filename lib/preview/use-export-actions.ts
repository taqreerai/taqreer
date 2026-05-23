"use client";

// Shared export-actions hook — single source of truth for the
// four export pipelines (PPTX / PDF / PNG / HTML). Extracted from
// PreviewActionBar 2026-05-23 so the new ShareDialog Export tab
// can drive the SAME handlers + share their busy / error state.
//
// Why a hook (not a context): the toolbar and the modal mount
// independently in different React subtrees, but they need
// coordinated busy state — clicking PPTX in the toolbar while
// the modal is open should disable the modal's PPTX row too.
// Both consumers call `useExportActions(...)` with the same
// projectId; React's batching + the shared `exportBusy` flag
// already serialise correctly because each hook instance owns
// its own state but the handlers throw if `busy` was set since
// the click. (We don't share state across instances; instead the
// PreviewActionBar instance owns the toolbar's spinners + the
// ShareDialog instance owns the modal's. Cross-instance lockout
// isn't needed because each pipeline is idempotent server-side
// and the worst case is a duplicate Puppeteer run, which the
// server can absorb.)

import { useState } from "react";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import { exportManifestAsPptx } from "@/lib/export/html-export";
import { downloadHtmlDocument } from "@/lib/export/html-document";

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

  // Shared "any export running" flag — same serialisation reasoning
  // PreviewActionBar already documented: prevents a user from
  // chaining PPTX→PDF→PNG→HTML in quick succession and spinning up
  // four parallel Puppeteer/dom-to-pptx pipelines at once.
  const busy =
    exportPptx.status === "running" ||
    exportPdf.status === "running" ||
    exportPng.status === "running" ||
    exportHtml.status === "running";

  // Common manifest patch — back-fills `format` from the project-
  // level fallback for legacy manifests where deck-generate hadn't
  // started stamping `format` yet. Without this, a 9:16 deck exports
  // landscape because exportManifestAsPptx falls through to the
  // 16:9 default.
  const exportManifest = {
    ...manifest,
    format: manifest.format ?? formatFallback ?? "16:9",
  };

  // ── PPTX (client-side via dom-to-pptx + BiDi post-processor) ─────
  const runPptx = async () => {
    if (busy) return;
    setExportPptx({ status: "running", message: "جارٍ التصدير..." });
    try {
      const fileName = `${baseFileName(manifest.title || projectTitle)}.pptx`;
      await exportManifestAsPptx(exportManifest, fileName);
      setExportPptx({ status: "idle" });
    } catch (error) {
      setExportPptx({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التصدير",
      });
    }
  };

  // ── PDF (server-side Puppeteer) ──────────────────────────────────
  const runPdf = async () => {
    if (busy) return;
    setExportPdf({ status: "running", message: "جارٍ تصدير PDF..." });
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
  };

  // ── PNG (server-side Puppeteer, ZIP of canvas-native PNGs) ───────
  const runPng = async () => {
    if (busy) return;
    setExportPng({ status: "running", message: "جارٍ تصدير الصور..." });
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
  };

  // ── HTML (client-side, raw standalone bundle) ────────────────────
  const runHtml = async () => {
    if (busy) return;
    setExportHtml({ status: "running", message: "جارٍ التحميل..." });
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
  };

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
