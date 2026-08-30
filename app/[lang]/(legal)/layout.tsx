// Shared chrome for the legal pages (Terms / Privacy / Refund): the SAME
// landing background + nav + footer wrap the content, so they read as part of
// the marketing site. The nav's logo is the way home (no separate back button,
// user direction 2026-06-13).

import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { StitchBackdrop } from "@/components/marketing/StitchBackdrop";

export default async function LegalLayout({
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
          dots), same as the landing + marketing spokes (2026-08-30). */}
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
