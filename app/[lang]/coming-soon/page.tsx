// Pre-launch coming-soon page. The proxy rewrites every page request here
// while COMING_SOON=1 and the tq_preview cookie is absent; visiting
// /preview?key=<COMING_SOON_KEY> sets the cookie and unlocks the full site.
// Minimal on purpose: wordmark + two lines on the app background.

import type { Metadata } from "next";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, defaultLocale } from "@/lib/i18n/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ComingSoonPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = isLocale(lang) ? lang : defaultLocale;
  const dict = await getDictionary(locale);
  const t = dict.landing.comingSoon;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6 text-center">
      <ThemeLogo width={180} height={42} priority />
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted">{t.body}</p>
      </div>
    </main>
  );
}
