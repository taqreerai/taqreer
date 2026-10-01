// Public /pdf-to-powerpoint spoke (one feature per page, 2026-10-01). Targets
// "تحويل pdf الى بوربوينت" (AR, 1,900/mo) / "convert pdf to powerpoint" (EN).
// Layout + metadata: FeatureSpokePage; copy: dict.pdfToPowerpoint.

import type { Metadata } from "next";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  FeatureSpokePage,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";

export const dynamic = "force-static";

const PATH = "pdf-to-powerpoint";
// Material Symbol per "why" point, in dict.pdfToPowerpoint.why.points order.
const WHY_ICONS = ["auto_awesome", "edit", "format_textdirection_r_to_l", "auto_fix_high"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.pdfToPowerpoint, PATH);
}

export default async function PdfToPowerpointPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return (
    <FeatureSpokePage
      locale={locale}
      dict={dict}
      t={dict.pdfToPowerpoint}
      path={PATH}
      spokeKey="pdfToPowerpoint"
      whyIcons={WHY_ICONS}
      previewView="create"
    />
  );
}
