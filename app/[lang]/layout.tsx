import type { Metadata, Viewport } from "next";
import { Cairo, Poppins } from "next/font/google";
import "../globals.css";
import { notFound } from "next/navigation";
import { headers, cookies } from "next/headers";
import { ScrollReset } from "@/components/app/ScrollReset";
import { isLocale, dirForLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { isAppPath } from "@/lib/app-routes";
import { stripLocale } from "@/lib/i18n/navigation";
import { THEME_COOKIE } from "@/lib/ui-cookies";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "ar";
  const dict = await getDictionary(locale);

  // Per-page hreflang: the proxy forwards the request path as `x-pathname`, so
  // we can map THIS page to its sibling-locale URLs (e.g. /ar/pricing ↔
  // /en/pricing) rather than just the locale roots. Relative hrefs resolve
  // against `metadataBase`.
  const pathname = (await headers()).get("x-pathname") ?? `/${locale}`;
  const logical = stripLocale(pathname);
  const subpath = logical === "/" ? "" : logical;
  const localeHref = (l: string) => `/${l}${subpath}`;

  return {
    metadataBase: new URL("https://taqreer.ai"),
    title: dict.meta.siteTitle,
    description: dict.meta.siteDescription,
    // Keywords target both languages regardless of UI locale (SEO).
    keywords: ["presentations", "AI", "Arabic", "PowerPoint", "عروض تقديمية", "ذكاء اصطناعي", "تقرير", "Taqreer"],
    authors: [{ name: "taqreer.ai" }],
    alternates: {
      canonical: localeHref(locale),
      languages: {
        ar: localeHref("ar"),
        en: localeHref("en"),
        // x-default → Arabic (the product's default locale).
        "x-default": localeHref("ar"),
      },
    },
    openGraph: {
      title: dict.meta.siteTitle,
      description: dict.meta.ogDescription,
      url: localeHref(locale),
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
    icons: {
      icon: "/icon.svg",
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

  // Set the app's body-scroll mode on the SERVER for app routes (path forwarded
  // as x-pathname by the proxy), so the RTL scrollbar is already on the body
  // (left) at first paint instead of jumping there when DashboardShell mounts.
  const appShell = isAppPath(stripLocale((await headers()).get("x-pathname") ?? ""));

  const cookieStore = await cookies();
  // Theme class on <html> at first paint (no flash) from the tq_theme cookie.
  // :root.light in globals.css flips the neutral tokens; default is dark.
  const themeClass = cookieStore.get(THEME_COOKIE)?.value === "light" ? " light" : "";
  // Cookie-consent: resolve on the server so the banner has no first-paint flip.
  // A new accept/reject choice OR the legacy ack both count as decided.
  const cookieConsentDecided =
    !!cookieStore.get("tq_cookie_consent")?.value ||
    cookieStore.get("tq_cookie_ack")?.value === "1";
  // Analytics consent is the STRICT "accept" only (legacy ack = saw-the-notice,
  // not consent-to-analytics). PostHog boots from first paint for accepted
  // returning visitors; everyone else stays untracked until they accept.
  const cookieConsentAccepted =
    cookieStore.get("tq_cookie_consent")?.value === "accept";

  return (
    <html
      lang={lang}
      dir={dir}
      className={`${cairo.variable} ${poppins.variable}${appShell ? " app-shell-scroll" : ""}${themeClass}`}
      suppressHydrationWarning
    >
      <head>
        {/* FILL axis range bumped to `0..1` (was `0`) so callers can
            toggle to the filled variant via inline font-variation-
            settings. Used today by the Comment toolbar button to
            signal commentMode (outlined → filled). Tiny size bump
            on the variable font file; same axes, just an extra
            value on the FILL axis. */}
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
          <PostHogProvider initialConsent={cookieConsentAccepted} />
          <CookieBanner initialDecided={cookieConsentDecided} />
        </LocaleProvider>
      </body>
    </html>
  );
}
