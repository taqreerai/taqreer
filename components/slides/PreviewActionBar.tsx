"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SlideManifest } from "@/lib/schema/slide";
import { exportManifestAsPptx } from "@/lib/export/html-export";
import { downloadHtmlDocument } from "@/lib/export/html-document";

type Status = "idle" | "running" | "success" | "error";

function baseFileName(title: string): string {
  return (
    title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80) ||
    "presentation"
  );
}

type ButtonState = {
  status: Status;
  message?: string;
};

function ToolButton({
  icon,
  label,
  badge,
  onClick,
  disabled,
  running,
  primary,
}: {
  icon: string;
  label: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
  running?: boolean;
  primary?: boolean;
}) {
  const isDisabled = disabled || running;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-label={label}
        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all ${
          primary && !isDisabled
            ? "btn-gradient text-white"
            : "text-white/80 hover:bg-white/10 hover:text-white"
        } ${isDisabled ? "cursor-not-allowed opacity-40" : ""}`}
      >
        {running ? (
          <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
        ) : (
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        )}
      </button>
      {/* Tooltip — appears to the right of the toolbar (toward content) */}
      <div
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-3 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: "100%", marginLeft: "12px" }}
      >
        {label}
        {badge ? <span className="badge-purple ms-2">{badge}</span> : null}
      </div>
    </div>
  );
}

export function PreviewActionBar({
  projectId,
  projectTitle,
  manifest,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
}) {
  const router = useRouter();
  const [regen, setRegen] = useState<ButtonState>({ status: "idle" });
  const [exportPptx, setExportPptx] = useState<ButtonState>({ status: "idle" });
  const [exportHtml, setExportHtml] = useState<ButtonState>({ status: "idle" });
  const [saveTpl, setSaveTpl] = useState<ButtonState>({ status: "idle" });

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateTitle, setTemplateTitle] = useState(projectTitle);

  const handleRegenerate = async () => {
    if (regen.status === "running") return;
    setRegen({ status: "running", message: "جارٍ إرسال الطلب..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/regenerate`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Regenerate failed");
      }
      router.refresh();
      setRegen({ status: "idle" });
    } catch (error) {
      setRegen({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر إعادة التصميم",
      });
    }
  };

  // Client-side export via dom-to-pptx + our BiDi post-processor. Runs
  // entirely in the browser — no Inngest job, no Supabase upload, no
  // polling. Replaces the previous server-side PptxGenJS pipeline.
  const handleExport = async () => {
    if (exportPptx.status === "running") return;
    setExportPptx({ status: "running", message: "جارٍ التصدير..." });
    try {
      // Prefer the manifest's title — it's the freshly regenerated value
      // (cover headline + dashboard label). `projectTitle` is the cached
      // server-side prop captured at SSR; if the user has just regenerated
      // and changed direction/topic, the manifest title is more current.
      const fileName = `${baseFileName(manifest.title || projectTitle)}.pptx`;
      await exportManifestAsPptx(manifest, fileName);
      setExportPptx({ status: "success", message: "تم التحميل" });
    } catch (error) {
      setExportPptx({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التصدير",
      });
    }
  };

  // HTML download — bundles all slides into one standalone .html file at
  // full 1920×1080 so the user can open it in a browser and screenshot.
  // No dom-to-pptx, no BiDi post-process; this is the raw rendered preview.
  const handleDownloadHtml = () => {
    if (exportHtml.status === "running") return;
    setExportHtml({ status: "running", message: "جارٍ التحميل..." });
    try {
      const fileName = `${baseFileName(manifest.title || projectTitle)}.html`;
      downloadHtmlDocument(manifest, fileName);
      setExportHtml({ status: "success", message: "تم التحميل" });
    } catch (error) {
      setExportHtml({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التحميل",
      });
    }
  };

  const handleSaveAsTemplate = async () => {
    if (saveTpl.status === "running") return;
    const trimmed = templateTitle.trim();
    if (!trimmed) {
      setSaveTpl({ status: "error", message: "أدخل اسماً للقالب" });
      return;
    }
    setSaveTpl({ status: "running", message: "جارٍ الحفظ..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Save failed");
      }
      setSaveTpl({ status: "success", message: "تم الحفظ في مكتبة القوالب" });
      setShowSaveForm(false);
    } catch (error) {
      setSaveTpl({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر الحفظ",
      });
    }
  };

  // Status messages are surfaced as a short toast under the toolbar. We pick
  // whichever button most recently changed status — first error, then running,
  // then success.
  const visibleMessage =
    regen.status === "error" ? { text: regen.message, kind: "error" as const } :
    exportPptx.status === "error" ? { text: exportPptx.message, kind: "error" as const } :
    exportHtml.status === "error" ? { text: exportHtml.message, kind: "error" as const } :
    saveTpl.status === "error" ? { text: saveTpl.message, kind: "error" as const } :
    exportPptx.status === "running" ? { text: exportPptx.message, kind: "info" as const } :
    exportHtml.status === "running" ? { text: exportHtml.message, kind: "info" as const } :
    saveTpl.status === "running" ? { text: saveTpl.message, kind: "info" as const } :
    regen.status === "running" ? { text: regen.message, kind: "info" as const } :
    exportPptx.status === "success" ? { text: exportPptx.message, kind: "success" as const } :
    exportHtml.status === "success" ? { text: exportHtml.message, kind: "success" as const } :
    saveTpl.status === "success" ? { text: saveTpl.message, kind: "success" as const } :
    null;

  return (
    <div dir="ltr" className="flex flex-col items-center gap-3">
      {/* Toolbar column — Photoshop-style icon stack */}
      <div className="glass-card flex flex-col items-center gap-1.5 rounded-2xl p-2">
        <ToolButton
          icon="autorenew"
          label="أعد التصميم"
          primary
          running={regen.status === "running"}
          onClick={handleRegenerate}
        />
        <ToolButton
          icon="comment"
          label="إضافة تعليق"
          badge="قريباً"
          disabled
        />
        <ToolButton
          icon="download"
          label="تصدير PPTX"
          running={exportPptx.status === "running"}
          onClick={handleExport}
        />
        <ToolButton
          icon="code"
          label="تنزيل HTML"
          running={exportHtml.status === "running"}
          onClick={handleDownloadHtml}
        />
        <ToolButton
          icon="picture_as_pdf"
          label="تصدير PDF"
          badge="قريباً"
          disabled
        />
        <ToolButton
          icon="bookmark_add"
          label="حفظ كقالب"
          running={saveTpl.status === "running"}
          onClick={() => setShowSaveForm((v) => !v)}
        />
      </div>

      {/* Status toast below the toolbar */}
      {visibleMessage?.text ? (
        <div
          className={`rounded-lg px-3 py-1.5 text-xs ${
            visibleMessage.kind === "error"
              ? "bg-red-500/10 text-red-300"
              : visibleMessage.kind === "success"
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-white/5 text-muted"
          }`}
        >
          {visibleMessage.text}
        </div>
      ) : null}

      {/* Save-as-template popover — floats to the right of the toolbar */}
      {showSaveForm ? (
        <div
          dir="rtl"
          className="glass-card absolute z-40 flex items-center gap-2 rounded-xl p-3"
          style={{ left: "100%", top: 0, marginLeft: "12px", width: "320px" }}
        >
          <input
            type="text"
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.target.value)}
            placeholder="اسم القالب"
            className="input-dark flex-1"
          />
          <button
            type="button"
            onClick={handleSaveAsTemplate}
            disabled={saveTpl.status === "running"}
            className="btn-gradient px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveTpl.status === "running" ? "..." : "حفظ"}
          </button>
          <button
            type="button"
            onClick={() => setShowSaveForm(false)}
            aria-label="إلغاء"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
