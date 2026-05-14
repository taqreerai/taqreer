import type { Metadata } from "next";
import { Cairo, Poppins } from "next/font/google";
import Script from "next/script";
import "./globals.css";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://taqreer.ai"),
  title: "Taqreer AI - Presentations | تقرير للذكاء الاصطناعي",
  description: "حوّل محتواك إلى عرض احترافي خلال دقائق. taqreer.ai يحوّل محتواك إلى عروض تقديمية مصممة بالكامل، يدعم العربية والإنجليزية.",
  keywords: ["presentations", "AI", "Arabic", "PowerPoint", "عروض تقديمية", "ذكاء اصطناعي", "تقرير", "Taqreer"],
  authors: [{ name: "Taqreer Team" }],
  openGraph: {
    title: "Taqreer AI - Presentations | تقرير للذكاء الاصطناعي",
    description: "حوّل محتواك إلى عرض احترافي خلال دقائق باستخدام الذكاء الاصطناعي.",
    url: "https://taqreer.ai",
    siteName: "Taqreer AI",
    images: [
      {
        url: "/images/hero/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Taqreer AI Presentations",
      },
    ],
    locale: "ar_SA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Taqreer AI - Presentations",
    description: "حوّل محتواك إلى عرض احترافي خلال دقائق باستخدام الذكاء الاصطناعي.",
    images: ["/images/hero/og-image.jpg"],
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,200,0,0&display=swap" rel="stylesheet" />
        <Script
          id="glass-preflight"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
          try {
            var p = localStorage.getItem('taqreer_glass_preset');
            var presets = {
              off:    ['0',    '0px',  '0.08', '100%'],
              subtle: ['0.02', '4px',  '0.06', '110%'],
              normal: ['0.04', '8px',  '0.09', '130%'],
              strong: ['0.07', '16px', '0.12', '160%']
            };
            var v = presets[p] || presets.normal;
            var r = document.documentElement;
            r.style.setProperty('--glass-opacity', v[0]);
            r.style.setProperty('--glass-blur', v[1]);
            r.style.setProperty('--glass-border-opacity', v[2]);
            r.style.setProperty('--glass-saturation', v[3]);
          } catch(e) {}
        `,
          }}
        />
      </head>
      <body className="font-sans antialiased overflow-x-hidden selection:bg-brand-purple-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
