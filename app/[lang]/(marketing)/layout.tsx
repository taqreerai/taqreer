// Shared chrome for public marketing spoke pages (/templates, and future
// /pricing, /ai-presentations, ...). Mirrors the (legal) layout exactly: the
// landing background + nav + footer wrap the content so the pages read as part
// of the marketing site. Per user direction (2026-06-18) these spokes "stay
// within the chrome like the privacy pages".
//
// No index page.tsx lives in this group (the spokes are subpaths), which
// sidesteps the Next 16 + Turbopack (marketing)/page.tsx resolution bug noted
// in app/[lang]/page.tsx.

import { createClient } from "@/lib/supabase/server";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LandingNav } from "@/components/marketing/LandingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { MagneticGlow } from "@/components/app/MagneticGlow";

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="relative overflow-x-clip">
      {/* Panel-coloured base + the bottom aurora glow, same as the landing. */}
      <div aria-hidden className="fixed inset-0 -z-[2] bg-[var(--tq-panel)]" />
      <MagneticGlow fixed glowYOffset={0.2} dots={false} />

      <LandingNav isAuthed={!!user} />

      {/* pt clears the absolute h-20 nav (80px) + a big gap below it. */}
      <div className="relative mx-auto max-w-7xl px-4 pt-40 sm:px-6 md:pt-48 lg:px-8">
        {children}
      </div>

      <SiteFooter locale={locale} />
    </main>
  );
}
