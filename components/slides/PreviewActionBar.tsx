"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ExportFormat = "pptx" | "pdf";
type Status = "idle" | "running" | "success" | "error";

type ButtonState = {
  label: string;
  arabicLabel: string;
  status: Status;
  message?: string;
};

function buttonStyle(disabled: boolean, variant: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 18px",
    borderRadius: "12px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background 0.15s, transform 0.05s",
    border: "1px solid rgba(42,36,59,0.8)",
  };
  if (variant === "primary") {
    return {
      ...base,
      background: "linear-gradient(135deg, #370BF4 0%, #7D2DFF 100%)",
      color: "#FFFFFF",
      border: "none",
    };
  }
  if (variant === "danger") {
    return { ...base, background: "transparent", color: "#FF6B6B" };
  }
  return { ...base, background: "rgba(22,16,36,0.6)", color: "#FFFFFF" };
}

export function PreviewActionBar({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const router = useRouter();
  const [regen, setRegen] = useState<ButtonState>({ label: "Regenerate", arabicLabel: "أعد التصميم", status: "idle" });
  const [exportPptx, setExportPptx] = useState<ButtonState>({ label: "Export PPTX", arabicLabel: "تصدير PPTX", status: "idle" });
  const [saveTpl, setSaveTpl] = useState<ButtonState>({ label: "Save as template", arabicLabel: "حفظ كقالب", status: "idle" });

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateTitle, setTemplateTitle] = useState(projectTitle);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);
  const MAX_POLL_ATTEMPTS = 60; // ~2 minutes at 2s intervals

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
  }, []);

  const handleRegenerate = async () => {
    if (regen.status === "running") return;
    setRegen({ ...regen, status: "running", message: "جارٍ إرسال الطلب..." });
    try {
      const response = await fetch(`/api/projects/${projectId}/regenerate`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Regenerate failed");
      }
      router.push(`/create/generating?projectId=${projectId}`);
    } catch (error) {
      setRegen({
        ...regen,
        status: "error",
        message: error instanceof Error ? error.message : "تعذر إعادة التصميم",
      });
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (format === "pdf") return; // PDF not implemented yet
    if (exportPptx.status === "running") return;
    setExportPptx({ ...exportPptx, status: "running", message: "جارٍ التصدير..." });

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
        ...exportPptx,
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
          ...exportPptx,
          status: "error",
          message: "انتهت مهلة التصدير — حاول مرة أخرى",
        });
        setExportJobId(null);
        return;
      }
      try {
        const response = await fetch(`/api/projects/${projectId}/export/${exportJobId}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          status: string;
          signedUrl: string | null;
          error: string | null;
        };
        if (data.status === "succeeded" && data.signedUrl) {
          window.open(data.signedUrl, "_blank", "noopener,noreferrer");
          setExportPptx({ ...exportPptx, status: "success", message: "تم — جارٍ التحميل" });
          setExportJobId(null);
        } else if (data.status === "failed") {
          setExportPptx({
            ...exportPptx,
            status: "error",
            message: data.error ?? "فشل التصدير",
          });
          setExportJobId(null);
        }
      } catch {
        // network blip; keep polling (counts toward MAX_POLL_ATTEMPTS).
      }
    };
    void poll();
    pollRef.current = window.setInterval(poll, 2000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportJobId, projectId]);

  const handleSaveAsTemplate = async () => {
    if (saveTpl.status === "running") return;
    const trimmed = templateTitle.trim();
    if (!trimmed) {
      setSaveTpl({ ...saveTpl, status: "error", message: "أدخل اسماً للقالب" });
      return;
    }
    setSaveTpl({ ...saveTpl, status: "running", message: "جارٍ الحفظ..." });
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
      setSaveTpl({ ...saveTpl, status: "success", message: "تم الحفظ في مكتبة القوالب" });
      setShowSaveForm(false);
    } catch (error) {
      setSaveTpl({
        ...saveTpl,
        status: "error",
        message: error instanceof Error ? error.message : "تعذر الحفظ",
      });
    }
  };

  const anyRunning =
    regen.status === "running" || exportPptx.status === "running" || saveTpl.status === "running";

  return (
    <div
      dir="rtl"
      style={{
        position: "sticky",
        top: "0",
        zIndex: 10,
        width: "100%",
        maxWidth: "1280px",
        background: "rgba(13,11,31,0.85)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(42,36,59,0.8)",
        borderRadius: "16px",
        padding: "12px 16px",
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={anyRunning}
            style={buttonStyle(anyRunning, "primary")}
          >
            <span>↻</span>
            <span>{regen.status === "running" ? "جارٍ إعادة التصميم..." : "أعد التصميم"}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport("pptx")}
            disabled={anyRunning}
            style={buttonStyle(anyRunning, "ghost")}
          >
            <span>⬇</span>
            <span>{exportPptx.status === "running" ? "جارٍ التصدير..." : "تصدير PPTX"}</span>
          </button>

          <button
            type="button"
            disabled
            title="قريباً"
            style={{ ...buttonStyle(true, "ghost"), opacity: 0.4 }}
          >
            <span>⬇</span>
            <span>تصدير PDF</span>
            <span style={{ fontSize: "10px", padding: "2px 6px", background: "rgba(125,45,255,0.2)", borderRadius: "6px", color: "#C8B5FF" }}>
              قريباً
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowSaveForm((v) => !v)}
            disabled={anyRunning}
            style={buttonStyle(anyRunning, "ghost")}
          >
            <span>★</span>
            <span>حفظ كقالب</span>
          </button>
        </div>

        {/* Status row */}
        {(regen.message || exportPptx.message || saveTpl.message) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
            {regen.message && (
              <span style={{ color: regen.status === "error" ? "#FF6B6B" : "#9A94A8" }}>
                {regen.message}
              </span>
            )}
            {exportPptx.message && (
              <span style={{ color: exportPptx.status === "error" ? "#FF6B6B" : exportPptx.status === "success" ? "#4AE3A1" : "#9A94A8" }}>
                {exportPptx.message}
              </span>
            )}
            {saveTpl.message && (
              <span style={{ color: saveTpl.status === "error" ? "#FF6B6B" : saveTpl.status === "success" ? "#4AE3A1" : "#9A94A8" }}>
                {saveTpl.message}
              </span>
            )}
          </div>
        )}
      </div>

      {showSaveForm && (
        <div
          style={{
            marginTop: "12px",
            padding: "12px",
            background: "rgba(7,6,15,0.6)",
            borderRadius: "12px",
            border: "1px solid rgba(42,36,59,0.8)",
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.target.value)}
            placeholder="اسم القالب"
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              background: "rgba(13,11,31,0.6)",
              border: "1px solid rgba(42,36,59,0.8)",
              color: "#FFFFFF",
              fontSize: "14px",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={handleSaveAsTemplate}
            disabled={saveTpl.status === "running"}
            style={buttonStyle(saveTpl.status === "running", "primary")}
          >
            {saveTpl.status === "running" ? "جارٍ..." : "حفظ"}
          </button>
          <button
            type="button"
            onClick={() => setShowSaveForm(false)}
            style={buttonStyle(false, "ghost")}
          >
            إلغاء
          </button>
        </div>
      )}
    </div>
  );
}
