import type { Metadata, Viewport } from "next";
import { Cairo, Poppins } from "next/font/google";
import "../globals.css";
import { notFound } from "next/navigation";
import { ScrollReset } from "@/components/app/ScrollReset";
import { isLocale, dirForLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  organizationSchema,
  webSiteSchema,
  softwareApplicationSchema,
} from "@/lib/seo/schema";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});

const poppins = Poppins({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-poppins",
  display: "swap",
});

// Pre-paint chrome init injected into <head> (runs before the stylesheet, so no
// theme flash + no app-route scrollbar jump). Sets `.light` from the tq_theme
// cookie and `.app-shell-scroll` from the first path segment — CLIENT-side, so
// the layout needs no server cookies()/headers() read, which is the prerequisite
// for static rendering. Keep the app-route list in sync with lib/app-routes.ts
// (APP_ROUTE_SEGMENTS).
const CHROME_INIT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)tq_theme=(\\w+)/);if(m&&m[1]==="light")document.documentElement.classList.add("light");var p=location.pathname.split("/").filter(Boolean);var s=(p[0]==="ar"||p[0]==="en")?p[1]:p[0];var A={dashboard:1,projects:1,favorites:1,library:1,templates:1,"brand-kits":1,settings:1,create:1,enhance:1,mimic:1,datasheet:1,project:1,preview:1,"use-template":1};if(s&&A[s])document.documentElement.classList.add("app-shell-scroll");}catch(e){}})();`;

// Prerender both locales so the static-eligible pages (landing, marketing
// spokes, legal) build to static HTML. App routes (cookies/auth) opt out of
// static generation and keep rendering on demand.
export function generateStaticParams() {
  return [{ lang: "ar" }, { lang: "en" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "ar";
  const dict = await getDictionary(locale);

  // Per-page canonical + hreflang live in each page's own generateMetadata (via
  // localeAlternates) so this layout needs NO per-request headers() read — that's
  // what lets the marketing pages render statically. The landing sets its own in
  // app/[lang]/page.tsx.
  return {
    metadataBase: new URL("https://taqreer.ai"),
    title: dict.meta.siteTitle,
    description: dict.meta.siteDescription,
    // Keywords target both languages regardless of UI locale (SEO).
    keywords: ["presentations", "AI", "Arabic", "PowerPoint", "عروض تقديمية", "ذكاء اصطناعي", "تقرير", "Taqreer"],
    authors: [{ name: "taqreer.ai" }],
    openGraph: {
      title: dict.meta.siteTitle,
      description: dict.meta.ogDescription,
      siteName: "taqreer.ai",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt:
            locale === "en"
              ? "taqreer.ai: AI presentation and report maker"
              : "taqreer.ai: تصميم عروض تقديمية وتقارير بالذكاء الاصطناعي",
        },
      ],
      locale: locale === "en" ? "en_US" : "ar_SA",
      // Declare the other locale so crawlers know the page exists in both.
      alternateLocale: locale === "en" ? ["ar_SA"] : ["en_US"],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.siteTitle,
      description: dict.meta.ogDescription,
      images: ["/og-image.png"],
    },
    // Classic /favicon.ico (app/favicon.ico, 16/32/48) for crawlers + legacy
    // browsers that probe the root path, plus the SVG for modern/theme-aware
    // tabs. SEO auditors specifically check for /favicon.ico.
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
    },
    // Rendered only once NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION is set in .env
    // (Search Console HTML-tag verification). Undefined → the tag is omitted.
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    },
  };
}

// themeColor belongs in `viewport` (Next 16), not `metadata`. Tints the mobile
// browser chrome to the brand page background per colour scheme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  // Chrome direction axis: <html dir> comes from the UI locale in the URL — NOT
  // from any deck. The slide canvas sets its own dir from manifest.direction.
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dir = dirForLocale(lang);
  const dict = await getDictionary(lang);

  return (
    <html
      lang={lang}
      dir={dir}
      className={`${cairo.variable} ${poppins.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint chrome init (theme + app-shell scroll mode) — see
            CHROME_INIT. Must run before the stylesheet to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: CHROME_INIT }} />
        {/* FILL axis range bumped to `0..1` (was `0`) so callers can
            toggle to the filled variant via inline font-variation-
            settings. Used today by the Comment toolbar button to
            signal commentMode (outlined → filled). Tiny size bump
            on the variable font file; same axes, just an extra
            value on the FILL axis. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- Material Symbols icon font with variable FILL/GRAD axes we toggle inline; next/font/google doesn't expose those axis controls */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,200,0..1,0&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased overflow-x-hidden selection:bg-brand-purple-500 selection:text-white">
        {/* Site-wide brand entities (Organization + WebSite + the product
            itself). Localized per UI locale. The landing page adds FAQPage on
            top. See lib/seo/schema.ts. */}
        <JsonLd
          data={[
            organizationSchema(lang),
            webSiteSchema(lang),
            softwareApplicationSchema(lang),
          ]}
        />
        <ScrollReset />
        <LocaleProvider locale={lang} dict={dict}>
          {children}
          <PostHogProvider />
          <CookieBanner />
        </LocaleProvider>
      </body>
    </html>
  );
}
