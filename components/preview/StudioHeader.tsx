"use client";

// Studio top header (command-bar redesign, plan-editor §16). A thin fixed top
// bar that owns the DOCUMENT chrome — pulled OUT of the bottom command pill so
// that pill can be a pure Edit⇄AI composer:
//   • leading (RTL right): back-to-dashboard + the project title.
//   • trailing (RTL left):  Export ▾ (the 4 formats collapsed into one popover)
//     + Share (owner-only, opens ShareDialog).
// Detached from the floating Layers/Slides panels (they sit at top:76, below
// this 56px bar) — the header never docks them. Neutral glass, no gradients.

import { useState } from "react";
import Link from "next/link";
import type { SlideManifest, SlideFormat } from "@/lib/schema/slide";
import type { ProjectRole } from "@/lib/api/project-access";
import { ExportMenu } from "./ExportMenu";
import { ShareDialog } from "@/components/app/ShareDialog";

export function StudioHeader({
  projectId,
  projectTitle,
  manifest,
  formatFallback,
  role,
}: {
  projectId: string;
  projectTitle: string;
  manifest: SlideManifest;
  formatFallback?: SlideFormat;
  role: ProjectRole;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const isOwner = role === "owner";

  return (
    <>
      <header
        dir="rtl"
        className="fixed inset-x-0 top-0 z-[1060] flex h-14 items-center justify-between px-4"
      >
        {/* Leading (right): back + project title. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/dashboard"
            aria-label="الرجوع إلى لوحة التحكم"
            className="btn-pill flex h-9 w-9 items-center justify-center no-underline"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
          <h1 className="min-w-0 max-w-[280px] truncate text-[14px] font-medium text-white/90">
            {projectTitle}
          </h1>
        </div>

        {/* Trailing (left): export + share. */}
        <div className="flex items-center gap-2">
          <ExportMenu
            projectId={projectId}
            projectTitle={projectTitle}
            manifest={manifest}
            formatFallback={formatFallback}
          />
          {isOwner ? (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="مشاركة"
              className="btn-pill flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>
                person_add
              </span>
              <span>مشاركة</span>
            </button>
          ) : null}
        </div>
      </header>

      {isOwner ? (
        <ShareDialog
          open={shareOpen}
          projectId={projectId}
          projectTitle={projectTitle}
          manifest={manifest}
          formatFallback={formatFallback}
          showExportTab={false}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </>
  );
}
