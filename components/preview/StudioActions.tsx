"use client";

// §22: document actions — Export ▾ + Share. Relocated out of the (removed)
// StudioHeader into the slide-nav footer so the app sidebar rail is the only
// chrome. Renders inline (no bar); owns the Share dialog. Back-to-dashboard is
// dropped — the always-present sidebar logo handles returning home.

import { useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import type { ProjectRole } from "@/lib/api/project-access";
import { ExportMenu } from "./ExportMenu";
import { ShareDialog } from "@/components/app/ShareDialog";

export function StudioActions({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
  role,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest | null;
  formatFallback?: SlideFormat;
  role: ProjectRole;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const [shareOpen, setShareOpen] = useState(false);
  const isOwner = role === "owner";

  // No completed deck → nothing to export/share (the footer wrapper is gated on
  // a truthy slot by the parent, so returning null keeps it from rendering).
  if (!manifest) return null;

  return (
    <div dir={dir} className="flex items-center gap-2">
      <ExportMenu
        projectId={projectId}
        projectTitle={projectTitle}
        manifest={manifest}
        formatFallback={formatFallback}
      />
      {isOwner ? (
        <>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label={dict.editor.share}
            className="btn-pill flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden>
              person_add
            </span>
            {/* Icon-only on phones (see ExportMenu) — the aria-label carries it. */}
            <span className="max-md:hidden">{dict.editor.share}</span>
          </button>
          <ShareDialog
            open={shareOpen}
            projectId={projectId}
            projectTitle={projectTitle}
            manifest={manifest}
            formatFallback={formatFallback}
            showExportTab={false}
            onClose={() => setShareOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
