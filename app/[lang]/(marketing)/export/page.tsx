// Public /export spoke (one feature per page, 2026-10-01). Targets
// no fitting search demand; a menu destination.
// Layout + metadata: FeatureSpokePage; copy: dict.exportFormats.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "export";
// Material Symbol per "why" point, in dict.exportFormats.why.points order.
const WHY_ICONS = ["slideshow", "picture_as_pdf", "add_to_drive", "code"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.exportFormats, PATH);
}

export default async function ExportPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.exportFormats}
      path={PATH}
      spokeKey="exportFormats"
      whyIcons={WHY_ICONS}
    />
  );
}
