// Shared chrome for the legal pages (Terms / Privacy / Refund): the SAME
// landing background + nav + footer wrap the content, so they read as part of
// the marketing site. The nav's logo is the way home (no separate back button,
// user direction 2026-06-13).

import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { MagneticGlow } from "@/components/app/MagneticGlow";

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
      {/* Panel-coloured base + the bottom aurora glow, same as the landing. */}
      <div aria-hidden className="fixed inset-0 -z-[2] bg-[var(--tq-panel)]" />
      <MagneticGlow fixed glowYOffset={0.2} dots={false} />

      <LandingNav />

      {/* pt clears the absolute h-20 nav (80px) + a big gap below it. */}
      <div className="relative mx-auto max-w-7xl px-4 pt-40 sm:px-6 md:pt-48 lg:px-8">
        {children}
      </div>

      <SiteFooter locale={locale} />
    </main>
  );
}
