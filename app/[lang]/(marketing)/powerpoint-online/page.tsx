// Public /powerpoint-online spoke (one feature per page, 2026-10-01). Targets
// "بوربوينت اون لاين" (AR) / "edit powerpoint online" (EN).
// Layout + metadata: FeatureSpokePage; copy: dict.powerpointOnline.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "powerpoint-online";
// Material Symbol per "why" point, in dict.powerpointOnline.why.points order.
const WHY_ICONS = ["open_with", "layers", "auto_awesome", "history"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.powerpointOnline, PATH);
}

export default async function PowerpointOnlinePage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.powerpointOnline}
      path={PATH}
      spokeKey="powerpointOnline"
      whyIcons={WHY_ICONS}
    />
  );
}
