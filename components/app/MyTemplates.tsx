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
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  TemplateTile,
  type TemplateTileData,
} from "@/components/app/TemplateTile";
import { TemplateLightbox } from "@/components/app/TemplateLightbox";
import { useRefreshWhileThumbnailsPending } from "@/components/app/useRefreshWhileThumbnailsPending";
import { prepareTemplateUse, isPremiumGate } from "@/lib/mimic/template-seed";
import { TemplateUpgradeModal, type TemplateGate } from "@/components/app/TemplateUpgradeModal";
import { useTemplateLock } from "@/lib/templates/use-template-lock";
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
  // §22: when embedded (inside HomeLibrary's toggle), render only the grid +
  // lightbox — no card wrapper, no header (the host card owns those).
  embedded = false,
  viewerIsAdmin = false,
}: {
  templates: MyTemplatesTemplate[];
  embedded?: boolean;
  // Admins get the 3-dots Delete affordance on every tile, not just their own.
  viewerIsAdmin?: boolean;
}) {
  const dict = useDict();
  const { dir, locale } = useLocale();
  // null = lightbox closed; a template object = open at that template.
  const [preview, setPreview] = useState<MyTemplatesTemplate | null>(null);
  // Gate the "Use this template" CTA so a double-click can't fire
  // two seed requests + two navigations. Mirrors TemplateTile's
  // useBusy state — same UX contract, different surface.
  const [useBusy, setUseBusy] = useState(false);
  // Premium gate: a public premium template used by a non-Pro non-owner 402s ->
  // open the in-place upgrade modal (mirrors TemplatesPageClient + the spec:
  // premium public templates are clickable but pop the payment when unmet).
  // Template gate (2026-10-02): the plan's template flow or the premium
  // tier, checked BEFORE preparing the template (lib/templates/use-template-lock).
  const [gate, setGate] = useState<TemplateGate>(null);
  const { lockFor, isPremiumLock } = useTemplateLock();

  const handleUseTemplate = async () => {
    if (!preview || useBusy) return;
    const tier = lockFor(preview);
    if (tier) {
      setGate({ tier, premium: isPremiumLock(preview) });
      return;
    }
    setUseBusy(true);
    try {
      // Prepare the Mimic reference (lightbox CTA shows its busy
      // spinner), then navigate to the forked flow which reads the
      // cache → no full-screen loader.
      await prepareTemplateUse("template", preview.id);
      window.location.assign(`/create?template=${encodeURIComponent(preview.id)}`);
    } catch (err) {
      if (isPremiumGate(err)) {
        setPreview(null);
        setGate({ tier: "pro", premium: true });
        setUseBusy(false);
        return;
      }
      console.warn("[MyTemplates] use prep failed", err);
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

  const body = (
    <>
      {templates.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          {dict.components.myTemplates.empty}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <TemplateTile
                template={tpl}
                viewerIsAdmin={viewerIsAdmin}
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
        isPremium={preview?.isPremium ?? false}
        onClose={() => setPreview(null)}
        onUseTemplate={preview ? handleUseTemplate : undefined}
        useBusy={useBusy}
      />
      <TemplateUpgradeModal gate={gate} onClose={() => setGate(null)} />
    </>
  );

  // Embedded (inside HomeLibrary's toggle): grid + lightbox only.
  if (embedded) {
    return <div dir={dir}>{body}</div>;
  }

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6" dir={dir}>
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="tq-widget-title">{dict.components.myTemplates.header}</h2>
          <p className="mt-1 text-xs text-muted">{dict.components.myTemplates.subtitle}</p>
        </div>
        <Link href={localizedHref("/templates", locale)} className="tq-widget-link no-underline">
          {dict.components.myTemplates.viewAll}
        </Link>
      </header>
      {body}
    </div>
  );
}
