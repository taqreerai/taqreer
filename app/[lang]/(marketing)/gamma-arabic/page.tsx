// Public /gamma-arabic comparison page (2026-10-04). Targets the Arabic Gamma
// name searches (Saudi Arabia, all KD 0): "جاما ai" 880/mo, "موقع جاما" 590,
// "gamma app بالعربي" 480, "جاما اب" 320, "تطبيق جاما" 210, "gamma مجاني" 140,
// "جاما بوربوينت" 110 ("بديل gamma" is only ~10/mo, so not an alternative page). Evidence-led: the same brief (a
// Riyadh specialty-coffee launch plan) run through both tools, screenshots of
// the exported PowerPoint files side by side (public/compare/*.webp), then a
// plain-language table on what people notice: colors, spacing, design, Arabic
// with English. Claims stay to what the screenshots show. Layout follows the
// familiar "A vs B" pattern: face-off hero, "pick X if" verdict cards, tabbed
// screenshot pairs, then the comparison grid. Copy: dict.gammaArabic; layout
// pieces shared with FeatureSpokePage.

import type { Metadata } from "next";
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
import { CompareSlideTabs } from "@/components/marketing/CompareSlideTabs";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
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

      {/* Hero: the familiar "A vs B" face-off, then the page's single h1. */}
      <section className="pb-12 text-center">
        <ScrollReveal direction="up">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 flex items-center justify-center gap-3 sm:gap-5">
              <div className="compare-pick flex h-20 w-40 items-center justify-center rounded-[18px] px-5 sm:w-52">
                <ThemeLogo width={130} height={31} className="h-auto w-full max-w-[130px]" priority />
              </div>
              <span className="compare-vs">{t.hero.vs}</span>
              <div className="surface-card flex h-20 w-40 items-center justify-center rounded-[18px] px-5 sm:w-52">
                <span className="text-2xl font-semibold text-muted" dir="ltr">
                  Gamma
                </span>
              </div>
            </div>
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

      {/* Quick verdict: "Pick X if..." cards, taqreer.ai first (reading-start side). */}
      <section className="py-12">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.verdict.title} subtitle={t.verdict.subtitle} />
        </ScrollReveal>
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
          {(["taqreer", "gamma"] as const).map((tool, i) => (
            <ScrollReveal key={tool} direction="up" delay={i * 0.06}>
              <div
                className={`h-full rounded-[18px] p-6 sm:p-7 ${
                  tool === "taqreer" ? "compare-pick" : "surface-card"
                }`}
              >
                <h3
                  className={`mb-5 text-lg font-semibold ${
                    tool === "taqreer" ? "text-[var(--tq-violet)]" : "text-foreground"
                  }`}
                >
                  {t.verdict[tool].title}
                </h3>
                <ul className="flex flex-col gap-3">
                  {t.verdict[tool].points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[15px] leading-relaxed">
                      <span
                        className={`material-symbols-outlined mt-0.5 text-[20px] leading-none ${
                          tool === "taqreer" ? "text-[var(--tq-violet)]" : "text-muted"
                        }`}
                        aria-hidden
                      >
                        check_circle
                      </span>
                      <span className="text-foreground">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Slide-by-slide screenshots, one tabbed pair at a time. */}
      <section className="py-12">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.compare.title} subtitle={t.compare.subtitle} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <CompareSlideTabs
            pairs={t.compare.pairs}
            shots={SHOTS}
            labels={{ taqreer: t.compare.taqreer, gamma: t.compare.gamma }}
            alt={t.compare.alt}
            notice={t.compare.notice}
          />
        </ScrollReveal>
      </section>

      {/* Side-by-side comparison: a table on wide screens, stacked cards on phones. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-10">
          <SectionHeader title={t.table.title} subtitle={t.table.subtitle} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <div className="surface-card overflow-hidden rounded-[18px]">
            <div className="hidden grid-cols-[1fr_1.6fr_1.6fr] border-b border-[var(--tq-border-hairline)] text-sm font-semibold sm:grid">
              <div className="p-4 text-muted">{t.table.criterion}</div>
              <div className="compare-pick-cell p-4 text-[var(--tq-violet)]">{t.compare.taqreer}</div>
              <div className="p-4 text-muted">{t.compare.gamma}</div>
            </div>
            {t.table.rows.map((row) => (
              <div
                key={row.criterion}
                className="grid grid-cols-1 border-b border-[var(--tq-border-hairline)] last:border-b-0 sm:grid-cols-[1fr_1.6fr_1.6fr]"
              >
                <h3 className="px-4 pt-4 text-[15px] font-semibold text-foreground sm:p-4">
                  {row.criterion}
                </h3>
                {(["taqreer", "gamma"] as const).map((tool) => (
                  <div
                    key={tool}
                    className={`flex items-start gap-2.5 p-4 text-sm leading-relaxed ${
                      tool === "taqreer" ? "compare-pick-cell" : ""
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined mt-0.5 text-[18px] leading-none ${
                        tool === "taqreer" ? "text-[var(--tq-violet)]" : "text-muted"
                      }`}
                      aria-hidden
                    >
                      {tool === "taqreer" ? "check_circle" : "remove_circle_outline"}
                    </span>
                    <div>
                      <span className="mb-0.5 block text-xs font-semibold text-muted sm:hidden">
                        {t.compare[tool]}
                      </span>
                      <span className={tool === "taqreer" ? "text-foreground" : "text-muted"}>
                        {row[tool]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ScrollReveal>
      </section>

      <RepeatCta href={signup} label={t.hero.cta} />

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
