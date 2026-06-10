// Auth route group shell — wraps signup / login / forgot-password
// (and the OAuth `callback` route, which renders nothing visible). The
// `confirmed` page also lives here.
//
// Visual model (user direction 2026-05-28):
//   • Background = 12-column marquee wall of random project
//     thumbnails (`AuthMarqueeBackground`). Calm 90 s loop, columns
//     alternate direction. Dimmed + violet-washed so the modal stays
//     the focal point.
//   • Foreground = centered glass modal containing the page logo, the
//     route's form (children), and a fine-print legal footer.
//
// The marquee is server-rendered — `getMarqueeColumns()` is a cached
// (60 s) Prisma query so a fresh batch loads on each session but the
// same session reuses it. Children rendered inside the modal still use
// `AuthAnimations` for the existing route-change fade/slide.

import Image from "next/image";
import Link from "next/link";
import { AuthAnimations } from "./AuthAnimations";
import { AuthMarqueeBackground } from "@/components/auth/AuthMarqueeBackground";
import { getMarqueeColumns } from "@/lib/auth/marquee-projects";
import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import { isLocale, type Locale } from "@/lib/i18n/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const dict = await getDictionary(isLocale(lang) ? lang : "ar");
  return {
    title: dict.meta.authTitle,
    description: dict.meta.authDescription,
  };
}

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next's generated `LayoutProps<"/[lang]">` types `params` as `{ lang: string }`,
  // so the prop annotation must be `string` (a narrower `Locale` here fails the
  // typegen constraint). The parent [lang] layout already 404s on an unknown
  // locale, so we just narrow back to `Locale` below for the typed helpers.
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang: Locale = isLocale(rawLang) ? rawLang : "ar";
  const [columns, dict] = await Promise.all([
    getMarqueeColumns(),
    getDictionary(lang),
  ]);
  const legal = dict.auth.legal;

  return (
    // `dashboard-bg` brings in the same chrome the app uses — `--tq-bg`
    // solid + a fixed `::before` violet glow anchored at the bottom of
    // the viewport. The marquee renders ON TOP of the body bg but
    // BELOW the violet glow (the ::before is z:0 on a fixed layer);
    // the user wants the auth pages to share the same gradient
    // signature as the dashboard so the brand chrome reads consistent
    // edge-to-edge.
    <div className="dashboard-bg relative min-h-screen overflow-hidden">
      <AuthMarqueeBackground columns={columns} />

      {/* Modal layer — fills the viewport, centers the glass panel.
          `z-10` keeps it above the marquee + dim layers but below any
          portal'd dropdowns the form might open. */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <div
          // Canonical `.surface-modal` + `.`
          // (custom utility defined in globals.css via Tailwind v4's
          // `@utility` directive). Multiplier 7 on `--glass-blur`
          // gives a heavy frosted-glass read against the marquee —
          // preset "normal" (8 px) → 56 px effective blur. Still
          // tracks the user's Settings glass preset.
          className="auth-modal surface-modal w-full max-w-md rounded-3xl p-8"
        >
          <Link
            href={localizedHref("/", lang)}
            className="mb-8 flex flex-shrink-0 justify-center cursor-pointer"
          >
            <Image
              src="/logo-light.svg"
              alt="taqreer.ai"
              width={140}
              height={40}
              className="h-6 w-auto"
              priority
            />
          </Link>

          <AuthAnimations>{children}</AuthAnimations>

          {/* Fine print — Terms + Privacy. Routes don't exist yet
              (placeholder hrefs); the labels match the landing
              footer's legal group so the wording reads consistent
              when the real pages ship. */}
          <p className="mt-8 text-center text-xs text-muted">
            {legal.prefix}
            <Link
              href={localizedHref("/#", lang)}
              className="underline transition-colors hover:text-white"
            >
              {legal.terms}
            </Link>
            {legal.and}
            <Link
              href={localizedHref("/#", lang)}
              className="underline transition-colors hover:text-white"
            >
              {legal.privacy}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
