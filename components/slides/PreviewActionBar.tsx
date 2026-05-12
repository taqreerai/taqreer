"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ExportFormat = "pptx" | "pdf";
type Status = "idle" | "running" | "success" | "error";

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
}: {
  projectId: string;
  projectTitle: string;
}) {
  const router = useRouter();
  const [regen, setRegen] = useState<ButtonState>({ status: "idle" });
  const [exportPptx, setExportPptx] = useState<ButtonState>({ status: "idle" });
  const [saveTpl, setSaveTpl] = useState<ButtonState>({ status: "idle" });

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateTitle, setTemplateTitle] = useState(projectTitle);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);
  const MAX_POLL_ATTEMPTS = 60; // ~2 minutes at 2 s intervals

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

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

  const handleExport = async (format: ExportFormat) => {
    if (format === "pdf") return;
    if (exportPptx.status === "running") return;
    setExportPptx({ status: "running", message: "جارٍ التصدير..." });

    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Export failed");
      }
      const { jobId } = (await response.json()) as { jobId: string };
      setExportJobId(jobId);
    } catch (error) {
      setExportPptx({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر التصدير",
      });
    }
  };

  // Poll for export completion (bounded — gives up after MAX_POLL_ATTEMPTS).
  useEffect(() => {
    if (!exportJobId) return;
    pollAttemptsRef.current = 0;
    const poll = async () => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        setExportPptx({
          status: "error",
          message: "انتهت مهلة التصدير — حاول مرة أخرى",
        });
        setExportJobId(null);
        return;
      }
      try {
        const response = await fetch(`/api/projects/${projectId}/export/${exportJobId}`);
        if (!response.ok) {
          console.warn(
            `Export poll failed: ${response.status} ${response.statusText}`,
          );
          return;
        }
        const data = (await response.json()) as {
          status: string;
          signedUrl: string | null;
          error: string | null;
        };
        if (data.status === "succeeded" && data.signedUrl) {
          window.open(data.signedUrl, "_blank", "noopener,noreferrer");
          setExportPptx({ status: "success", message: "تم — جارٍ التحميل" });
          setExportJobId(null);
        } else if (data.status === "failed") {
          setExportPptx({
            status: "error",
            message: data.error ?? "فشل التصدير",
          });
          setExportJobId(null);
        }
      } catch (err) {
        // network blip; keep polling (counts toward MAX_POLL_ATTEMPTS).
        console.warn("Export poll network error:", err);
      }
    };
    void poll();
    pollRef.current = window.setInterval(poll, 2000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [exportJobId, projectId]);

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
    saveTpl.status === "error" ? { text: saveTpl.message, kind: "error" as const } :
    exportPptx.status === "running" ? { text: exportPptx.message, kind: "info" as const } :
    saveTpl.status === "running" ? { text: saveTpl.message, kind: "info" as const } :
    regen.status === "running" ? { text: regen.message, kind: "info" as const } :
    exportPptx.status === "success" ? { text: exportPptx.message, kind: "success" as const } :
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
          onClick={() => handleExport("pptx")}
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
