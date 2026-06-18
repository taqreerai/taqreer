import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LEGAL_DOCS, LEGAL_META } from "@/lib/legal/content";
import { localeAlternates } from "@/lib/seo/alternates";

export const dynamic = "force-static";

function resolve(lang: string): "ar" | "en" {
  return isLocale(lang) ? (lang as "ar" | "en") : (defaultLocale as "ar" | "en");
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  return {
    title: `${LEGAL_DOCS.refund[locale].title} · ${LEGAL_META.brand}`,
    alternates: localeAlternates(locale, "refund"),
  };
}

export default async function RefundPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  return <LegalDoc kind="refund" locale={resolve(lang)} />;
}
