// Public /gamma-arabic comparison page (2026-10-04). Targets the Arabic Gamma
// name searches (Saudi Arabia, all KD 0): "جاما ai" 880/mo, "موقع جاما" 590,
// "gamma app بالعربي" 480, "جاما اب" 320, "تطبيق جاما" 210, "gamma مجاني" 140,
// "جاما بوربوينت" 110 ("بديل gamma" is only ~10/mo, so not an alternative page). Evidence-led: the same brief (a
// Riyadh specialty-coffee launch plan) run through both tools, screenshots of
// the exported PowerPoint files side by side (public/compare/*.webp), then a
// plain-language table on what people notice: colors, spacing, design, Arabic
// with English. Claims stay to what the screenshots show. Copy:
// dict.gammaArabic; layout pieces shared with FeatureSpokePage.

import type { Metadata } from "next";
import Image from "next/image";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  FeatureArticleSection,
  featureSpokeMetadata,
} from "@/components/marketing/FeatureSpokePage";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ExploreMoreSection } from "@/components/marketing/ExploreMoreSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { RepeatCta } from "@/components/marketing/RepeatCta";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqPageSchema } from "@/lib/seo/schema";

export const dynamic = "force-static";

const PATH = "gamma-arabic";
// Screenshot pairs in dict.gammaArabic.compare.pairs order.
const SHOTS = ["cover", "content", "chart", "closing"] as const;
// Material Symbol per "why" point, in dictionary order.
const WHY_ICONS = ["palette", "grid_view", "format_textdirection_r_to_l", "brush"];

function resolve(lang: string): "ar" | "en" {
  return (isLocale(lang) ? lang : defaultLocale) as "ar" | "en";
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  return featureSpokeMetadata(locale, dict.gammaArabic, PATH);
}

export default async function GammaArabicPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const locale = resolve(lang);
  const dict = await getDictionary(locale);
  const t = dict.gammaArabic;
  const signup = localizedHref("/signup", locale);

  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/${PATH}` },
          ]),
          faqPageSchema(t.faq),
        ]}
      />

      {/* Hero: the page's single h1. */}
      <section className="pb-12 text-center">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-3xl">
            <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
              {t.hero.eyebrow}
            </span>
            <h1 className="mb-5 text-balance text-4xl font-medium leading-tight md:text-5xl">
              {t.hero.title}
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-muted">
              {t.hero.subtitle}
            </p>
            <a
              href={signup}
              className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
            >
              {t.hero.cta}
            </a>
          </div>
        </ScrollReveal>
      </section>

      {/* Side-by-side screenshots: taqreer.ai first (the reading-start side). */}
      <section className="py-12">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.compare.title} subtitle={t.compare.subtitle} />
        </ScrollReveal>
        <div className="flex flex-col gap-12">
          {t.compare.pairs.map((pair, i) => (
            <ScrollReveal key={SHOTS[i]} direction="up">
              <h3 className="mb-4 text-lg font-semibold text-foreground">{pair.title}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(["taqreer", "gamma"] as const).map((tool) => (
                  <figure key={tool} className="m-0">
                    <Image
                      src={`/compare/${tool}-${SHOTS[i]}.webp`}
                      alt={t.compare.alt[tool].replace("{title}", pair.title)}
                      width={1280}
                      height={720}
                      sizes="(min-width: 640px) 50vw, 100vw"
                      className="h-auto w-full rounded-[14px] border border-[var(--tq-border-hairline)]"
                    />
                    <figcaption
                      className={`mt-2 text-sm font-semibold ${
                        tool === "taqreer" ? "text-[var(--tq-violet)]" : "text-muted"
                      }`}
                    >
                      {t.compare[tool]}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="mt-4 max-w-3xl text-[15px] leading-7 text-muted">{pair.note}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <RepeatCta href={signup} label={t.hero.cta} />

      {/* Plain-language comparison table. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.table.title} subtitle={t.table.subtitle} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <div className="surface-card overflow-x-auto rounded-[14px]">
            <table className="w-full min-w-[560px] border-collapse text-start text-sm">
              <thead>
                <tr className="border-b border-[var(--tq-border-hairline)]">
                  <th scope="col" className="p-4 text-start font-semibold text-muted">
                    {t.table.criterion}
                  </th>
                  <th scope="col" className="p-4 text-start font-semibold text-[var(--tq-violet)]">
                    {t.compare.taqreer}
                  </th>
                  <th scope="col" className="p-4 text-start font-semibold text-muted">
                    {t.compare.gamma}
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.table.rows.map((row) => (
                  <tr
                    key={row.criterion}
                    className="border-b border-[var(--tq-border-hairline)] last:border-b-0"
                  >
                    <th scope="row" className="p-4 text-start align-top font-semibold text-foreground">
                      {row.criterion}
                    </th>
                    <td className="p-4 align-top leading-relaxed text-foreground">{row.taqreer}</td>
                    <td className="p-4 align-top leading-relaxed text-muted">{row.gamma}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollReveal>
      </section>

      {/* How taqreer.ai gets there: 4 points. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.why.title} subtitle={t.why.subtitle} />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.why.points.map((point, i) => (
            <ScrollReveal key={i} direction="up" delay={i * 0.06}>
              <div className="surface-card h-full rounded-[14px] p-6">
                <span
                  className="material-symbols-outlined mb-4 block text-[32px] leading-none text-[var(--tq-violet)]"
                  aria-hidden
                >
                  {WHY_ICONS[i]}
                </span>
                <h3 className="mb-2 text-base font-medium">{point.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{point.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <RepeatCta href={signup} label={t.hero.cta} />

      <FeatureArticleSection locale={locale} article={t.article} />

      <section className="py-16">
        <ScrollReveal direction="up" className="pb-8">
          <SectionHeader title={dict.landing.sections.faq.title} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FaqAccordion items={t.faq} />
        </ScrollReveal>
      </section>

      <RepeatCta href={signup} label={t.hero.cta} />

      <ExploreMoreSection locale={locale} current="gammaArabic" dict={dict} />
    </div>
  );
}
