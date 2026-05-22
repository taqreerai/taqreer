"use client";

// Dashboard widget: "قوالبي" (My Templates).
//
// Same grid as RecentProjects so the two widgets sit as a coherent
// pair. Tile rendering delegated to the shared TemplateTile component
// (used by /templates page too) — keeps the visual identity locked
// across both consumers.
//
// Click behaviour: clicking a tile opens the in-place TemplateLightbox
// instead of navigating to /templates. Users browsing the dashboard
// expect to peek at a template's slides without losing their place.
// The widget header still links to /templates for the full library
// browse + filter experience.

import { useEffect, useState } from "react";
import {
  DashboardEmptyState,
  DashboardWidget,
  DashboardWidgetHeader,
} from "@/components/app/DashboardWidget";
import {
  TemplateTile,
  type TemplateTileData,
} from "@/components/app/TemplateTile";
import { TemplateLightbox } from "@/components/app/TemplateLightbox";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";
import { seedFromTemplate } from "@/lib/create/seed-from-template";
import type { SlideFormat } from "@/lib/schema/slide";

export type MyTemplatesTemplate = TemplateTileData & {
  // The 3 showcase PNGs the lightbox renders. Empty array = render
  // still pending or failed; tile click in that case is a no-op
  // (we skip opening the lightbox).
  thumbnailUrls: string[];
  // True while Inngest is still rendering. Drives the shared refresh
  // hook so a fresh save picks up its PNGs without a manual reload.
  thumbnailsPending: boolean;
  brand: TemplateTileData["brand"] & {
    fontHeading: { name: string; url?: string };
  };
};

export function MyTemplates({
  templates,
}: {
  templates: MyTemplatesTemplate[];
}) {
  // null = lightbox closed; a template object = open at that template.
  const [preview, setPreview] = useState<MyTemplatesTemplate | null>(null);
  // Gate the "Use this template" CTA so a double-click can't fire
  // two seed requests + two navigations. Mirrors TemplateTile's
  // useBusy state — same UX contract, different surface.
  const [useBusy, setUseBusy] = useState(false);

  const handleUseTemplate = async () => {
    if (!preview || useBusy) return;
    setUseBusy(true);
    try {
      await seedFromTemplate(preview.id);
      // Full navigation (not router.push) so the destination page's
      // lazy initialisers + stepper mount-effect see the fresh
      // sessionStorage on their first render. Target is the parallel
      // /create-from-template route tree — keeps the normal /create
      // flow untouched.
      window.location.assign("/create-from-template/content");
    } catch (err) {
      console.warn("[MyTemplates] seedFromTemplate failed", err);
      setUseBusy(false);
    }
  };

  // Auto-refresh on freshly-saved templates so the user's just-saved
  // tile picks up its 3 showcase PNGs without a manual reload.
  useRefreshWhileThumbnailsPending(templates);

  // Eager-load every unique heading-font URL across the visible
  // templates so any tile that wants to render in the brand's actual
  // font (lightbox header, modal preview) finds the font already in
  // the document. Dedup via the data-tpl-font marker.
  useEffect(() => {
    const seen = new Set<string>();
    for (const t of templates) {
      const url = t.brand.fontHeading?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (document.querySelector(`link[data-tpl-font="${url}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.crossOrigin = "anonymous";
      link.dataset.tplFont = url;
      document.head.appendChild(link);
    }
  }, [templates]);

  const previewFormat: SlideFormat =
    preview?.brand.format === "9:16" ? "9:16" : "16:9";

  return (
    <DashboardWidget>
      <DashboardWidgetHeader title="قوالبي" href="/templates" />

      {templates.length === 0 ? (
        <DashboardEmptyState
          icon="dashboard_customize"
          title="لا توجد قوالب محفوظة"
          description="عند حفظ عرض كقالب، سيظهر هنا لتستخدمه في عروضك القادمة."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <TemplateTile
                template={tpl}
                onClick={() => {
                  // Skip if showcase render hasn't completed yet —
                  // opening the lightbox would show an empty stage.
                  if (tpl.thumbnailUrls.length === 0) return;
                  setPreview(tpl);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <TemplateLightbox
        open={!!preview}
        slides={preview?.thumbnailUrls ?? []}
        format={previewFormat}
        title={preview?.title ?? ""}
        onClose={() => setPreview(null)}
        onUseTemplate={preview ? handleUseTemplate : undefined}
        useBusy={useBusy}
      />
    </DashboardWidget>
  );
}
