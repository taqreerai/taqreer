// Public /word-to-powerpoint spoke (one feature per page, 2026-10-01). Targets
// "تحويل وورد الى بوربوينت" (AR) / "word to powerpoint" (EN).
// Layout + metadata: FeatureSpokePage; copy: dict.wordToPowerpoint.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "word-to-powerpoint";
// Material Symbol per "why" point, in dict.wordToPowerpoint.why.points order.
const WHY_ICONS = ["format_list_bulleted", "auto_awesome", "palette", "download"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.wordToPowerpoint, PATH);
}

export default async function WordToPowerpointPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.wordToPowerpoint}
      path={PATH}
      spokeKey="wordToPowerpoint"
      whyIcons={WHY_ICONS}
      previewView="create"
    />
  );
}
