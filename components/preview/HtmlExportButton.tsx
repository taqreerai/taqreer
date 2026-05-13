"use client";

import { useState } from "react";
import type { SlideManifest } from "@/lib/schema/slide";
import { exportManifestAsPptx } from "@/lib/export/html-export";

function sanitizeFileName(title: string): string {
  // Keep Arabic + Latin word chars, strip FS-forbidden characters.
  return (
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "presentation"
  );
}

type Status = "idle" | "running" | "success" | "error";

export function HtmlExportButton({ manifest }: { manifest: SlideManifest }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (status === "running") return;
    setStatus("running");
    setMessage(null);
    try {
      const fileName = `${sanitizeFileName(manifest.title)}.pptx`;
      const { stats, slideCount } = await exportManifestAsPptx(manifest, fileName);
      setStatus("success");
      setMessage(
        `${slideCount} slides · txBody rtlCol→1: ${stats.txBodiesFlipped} · paragraphs: ${stats.paragraphsModified} · runs merged: ${stats.runsMerged} · lang→ar-SA: ${stats.langsRetagged}`
      );
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "running"}
        className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
      >
        {status === "running" ? (
          <>
            <span className="spinner h-3 w-3 rounded-full border-2 border-white/40 border-t-white" />
            <span>Exporting…</span>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[16px]">
              download
            </span>
            <span>Export to .pptx (HTML beta)</span>
          </>
        )}
      </button>
      {message && (
        <p
          className={`text-xs ${
            status === "error" ? "text-[var(--tq-status-error,#FF6B6B)]" : "text-muted"
          }`}
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
