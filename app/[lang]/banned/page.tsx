// Account-suspended gate. A banned user (User.bannedAt set via the admin
// console) is redirected here by the (app) layout. Lives OUTSIDE the (app)
// route group so it renders without the dashboard shell and can't redirect-loop.
// Bilingual + theme-aware (a user-facing surface, unlike the admin console).

import type { Metadata } from "next";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { BannedSignOut } from "@/components/app/BannedSignOut";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, defaultLocale } from "@/lib/i18n/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BannedPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = isLocale(lang) ? lang : defaultLocale;
  const dict = await getDictionary(locale);
  const t = dict.banned;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6 text-center">
      <ThemeLogo width={180} height={42} priority />
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-bold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted">{t.body}</p>
      </div>
      <BannedSignOut locale={locale} label={t.signOut} />
    </main>
  );
}
