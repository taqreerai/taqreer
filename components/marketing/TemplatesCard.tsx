// Wide "قوالب جاهزة تدعم RTL" card — content LEFT, a live 2-column
// marquee of REAL curator-public template thumbnails RIGHT. Lives in the
// landing "#templates" section (moved out of FeatureFlowCards 2026-05-29
// so every templates surface sits together).
//
// No interactivity of its own (TemplatesScroll owns the client boundary),
// so this stays a server component.

import Link from "next/link";
import { TemplatesScroll } from "@/components/marketing/TemplatesScroll";
import type { MarqueeThumbnail } from "@/lib/auth/marquee-projects";

export function TemplatesCard({
  thumbnails,
}: {
  thumbnails: MarqueeThumbnail[];
}) {
  return (
    <div className="templates-host surface-card overflow-hidden rounded-2xl p-6">
      {/* LTR-locked layout: content LEFT, thumbnails RIGHT; the text
          block re-anchors RTL for natural Arabic reading. */}
      <div dir="ltr" className="flex flex-col items-stretch gap-8 md:flex-row">
        <div dir="rtl" className="flex flex-1 flex-col justify-center md:py-4">
          <h3 className="mb-3 text-xl font-medium leading-snug text-white">
            قوالب جاهزة تدعم RTL
          </h3>
          <p className="mb-6 text-sm leading-relaxed text-muted">
            ابدأ من قوالب مصممة للعروض العربية والإنجليزية، مع دعم كامل
            لاتجاه النص من اليمين إلى اليسار، وتنسيق مناسب للعناوين،
            الفقرات، الجداول، والشرائح ثنائية اللغة.
          </p>
          <Link
            href="/signup"
            className="btn-gradient inline-block w-fit px-6 py-2 text-xs"
          >
            ابدأ مجانًا
          </Link>
        </div>
        <div className="w-full md:w-1/2">
          <TemplatesScroll thumbnails={thumbnails} />
        </div>
      </div>
    </div>
  );
}
