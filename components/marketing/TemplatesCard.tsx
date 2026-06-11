"use client";

// Wide ready-made-templates card — content LEFT, a live 2-column marquee of
// REAL curator-public template thumbnails RIGHT. Lives in the landing
// "#templates" section (moved out of FeatureFlowCards 2026-05-29 so every
// templates surface sits together).
//
// Client component: copy is i18n-driven (useDict) and the text block follows
// the chrome direction (useLocale). TemplatesScroll owns its own client work.

import Link from "next/link";
import { TemplatesScroll } from "@/components/marketing/TemplatesScroll";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { MarqueeThumbnail } from "@/lib/auth/marquee-projects";

export function TemplatesCard({
  thumbnails,
}: {
  thumbnails: MarqueeThumbnail[];
}) {
  const dict = useDict();
  const { dir } = useLocale();
  return (
    <div className="templates-host surface-card overflow-hidden rounded-2xl p-6">
      {/* LTR-locked layout: content LEFT, thumbnails RIGHT; the text
          block re-anchors RTL for natural Arabic reading. */}
      <div dir="ltr" className="flex flex-col items-stretch gap-8 md:flex-row">
        <div dir={dir} className="flex flex-1 flex-col justify-center md:py-4">
          <h3 className="mb-3 text-xl font-medium leading-snug text-foreground">
            {dict.landing.templatesCard.title}
          </h3>
          <p className="mb-6 text-sm leading-relaxed text-muted">
            {dict.landing.templatesCard.description}
          </p>
          <Link
            href="/signup"
            className="btn-gradient inline-block w-fit px-6 py-2 text-xs"
          >
            {dict.landing.templatesCard.cta}
          </Link>
        </div>
        <div className="w-full md:w-1/2">
          <TemplatesScroll thumbnails={thumbnails} />
        </div>
      </div>
    </div>
  );
}
