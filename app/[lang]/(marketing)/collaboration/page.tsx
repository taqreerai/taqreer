// Public /collaboration spoke (one feature per page, 2026-10-01). Targets
// no measurable search demand; a menu destination.
// Layout + metadata: FeatureSpokePage; copy: dict.collaboration.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "collaboration";
// Material Symbol per "why" point, in dict.collaboration.why.points order.
const WHY_ICONS = ["admin_panel_settings", "comment", "group", "link"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.collaboration, PATH);
}

export default async function CollaborationPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.collaboration}
      path={PATH}
      spokeKey="collaboration"
      whyIcons={WHY_ICONS}
    />
  );
}
