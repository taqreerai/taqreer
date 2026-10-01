// Public /powerpoint-images spoke (one feature per page, 2026-10-01). Targets
// "صور بوربوينت" (AR) / "powerpoint images" (EN).
// Layout + metadata: FeatureSpokePage; copy: dict.powerpointImages.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "powerpoint-images";
// Material Symbol per "why" point, in dict.powerpointImages.why.points order.
const WHY_ICONS = ["auto_awesome", "refresh", "photo_library", "upload"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.powerpointImages, PATH);
}

export default async function PowerpointImagesPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.powerpointImages}
      path={PATH}
      spokeKey="powerpointImages"
      whyIcons={WHY_ICONS}
      previewView="create"
    />
  );
}
