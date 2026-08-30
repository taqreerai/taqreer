// Shared chrome for public marketing spoke pages (/templates, and future
// /pricing, /ai-presentations, ...). Mirrors the (legal) layout exactly: the
// landing background + nav + footer wrap the content so the pages read as part
// of the marketing site. Per user direction (2026-06-18) these spokes "stay
// within the chrome like the privacy pages".
//
// No index page.tsx lives in this group (the spokes are subpaths), which
// sidesteps the Next 16 + Turbopack (marketing)/page.tsx resolution bug noted
// in app/[lang]/page.tsx.

import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { StitchBackdrop } from "@/components/marketing/StitchBackdrop";

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";

  return (
    <main className="relative overflow-x-clip">
      {/* Pure-black base + the animated Stitch backdrop (wave + reactive
          dots), same as the landing (2026-08-30 - replaced the panel base
          + MagneticGlow aurora so every marketing page matches). */}
      <div aria-hidden className="tq-stitch-base fixed inset-0 -z-[2]" />
      <StitchBackdrop />

      <LandingNav />

      {/* pt clears the absolute h-20 nav (80px) + a big gap below it. */}
      <div className="relative mx-auto max-w-7xl px-4 pt-40 sm:px-6 md:pt-48 lg:px-8">
        {children}
      </div>

      <SiteFooter locale={locale} />
    </main>
  );
}
