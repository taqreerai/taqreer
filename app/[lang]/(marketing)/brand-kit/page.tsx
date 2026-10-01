// Public /brand-kit spoke (one feature per page, 2026-10-01). Targets
// "brand kit" (EN); AR uses هوية بصرية in copy only (search intent there is identity design).
// Layout + metadata: FeatureSpokePage; copy: dict.brandKit.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "brand-kit";
// Material Symbol per "why" point, in dict.brandKit.why.points order.
const WHY_ICONS = ["bookmark", "font_download", "star", "collections"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.brandKit, PATH);
}

export default async function BrandKitPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.brandKit}
      path={PATH}
      spokeKey="brandKit"
      whyIcons={WHY_ICONS}
      previewView="create"
    />
  );
}
