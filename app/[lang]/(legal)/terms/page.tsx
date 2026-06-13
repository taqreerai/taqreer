import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LEGAL_DOCS, LEGAL_META } from "@/lib/legal/content";

function resolve(lang: string): "ar" | "en" {
  return isLocale(lang) ? (lang as "ar" | "en") : (defaultLocale as "ar" | "en");
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  return {
    title: `${LEGAL_DOCS.terms[resolve(lang)].title} · ${LEGAL_META.brand}`,
  };
}

export default async function TermsPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  return <LegalDoc kind="terms" locale={resolve(lang)} />;
}
