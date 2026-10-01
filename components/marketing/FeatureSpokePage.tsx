// Shared layout for the one-feature-per-page marketing spokes added 2026-10-01
// (pdf-to-powerpoint, word-to-powerpoint, powerpoint-online, powerpoint-images,
// brand-kit, collaboration, export). Same structure as the hand-built spokes
// (e.g. ai-presentations/page.tsx): hero (the page's single h1) -> optional
// static flow preview -> 4 "why" cards -> FAQ -> ExploreMore cross-links, plus
// breadcrumb + FAQPage JSON-LD. Copy comes from dict[key]; tokens only.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { localizedHref } from "@/lib/i18n/navigation";
import { FlowPreview } from "@/components/marketing/FlowPreview";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import {
  ExploreMoreSection,
  type SpokeKey,
} from "@/components/marketing/ExploreMoreSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqPageSchema } from "@/lib/seo/schema";
import { localeAlternates } from "@/lib/seo/alternates";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { RepeatCta } from "@/components/marketing/RepeatCta";

export type FeatureSpokeContent = {
  meta: { title: string; description: string };
  breadcrumb: string;
  hero: { eyebrow: string; title: string; subtitle: string; cta: string };
  preview?: { title: string; subtitle: string };
  why: {
    title: string;
    subtitle: string;
    points: { title: string; body: string }[];
  };
  faq: { q: string; a: string }[];
  // Long-form SEO article between the why cards and the FAQ (2026-10-01).
  article?: FeatureArticle;
};

// A block is a paragraph, a numbered how-to list, or a bullet list. Inline
// internal links are written [text](/path) in the copy (see InlineLinks).
export type ArticleBlock = string | { steps: string[] } | { bullets: string[] };

export type FeatureArticle = {
  title: string;
  intro: string;
  sections: { heading: string; blocks: ArticleBlock[] }[];
};

// Route path without the leading slash, e.g. "pdf-to-powerpoint".
export function featureSpokeMetadata(
  locale: "ar" | "en",
  t: FeatureSpokeContent,
  path: string,
): Metadata {
  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: localeAlternates(locale, path),
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: `/${locale}/${path}`,
      siteName: "taqreer.ai",
      images: ["/og-image.png"],
      type: "website",
      locale: locale === "en" ? "en_US" : "ar_SA",
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
      images: ["/og-image.png"],
    },
  };
}

export function FeatureSpokePage({
  locale,
  dict,
  t,
  path,
  spokeKey,
  whyIcons,
  previewView,
}: {
  locale: "ar" | "en";
  dict: Dictionary;
  t: FeatureSpokeContent;
  path: string;
  spokeKey: SpokeKey;
  // Material Symbol per "why" point, in dictionary order.
  whyIcons: readonly string[];
  // The real flow this feature starts in, inlined statically. Omitted for
  // studio-side features (editor, collaboration, export) with no flow step.
  previewView?: "create" | "enhance" | "mimic" | "social";
}) {
  return (
    <div className="pb-8">
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: locale === "ar" ? "الرئيسية" : "Home", url: `/${locale}` },
            { name: t.breadcrumb, url: `/${locale}/${path}` },
          ]),
          faqPageSchema(t.faq),
        ]}
      />

      {/* Hero — the page's single h1. */}
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
              href={localizedHref("/signup", locale)}
              className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
            >
              {t.hero.cta}
            </a>
          </div>
        </ScrollReveal>
      </section>

      {previewView && t.preview ? (
        <section className="py-12">
          <ScrollReveal direction="up" className="pb-10">
            <SectionHeader title={t.preview.title} subtitle={t.preview.subtitle} />
          </ScrollReveal>
          <ScrollReveal direction="up">
            <FlowPreview view={previewView} />
          </ScrollReveal>
        </section>
      ) : null}

      <RepeatCta href={localizedHref("/signup", locale)} label={t.hero.cta} />

      {/* Why — 4 points. */}
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
                  {whyIcons[i]}
                </span>
                <h3 className="mb-2 text-base font-medium">{point.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{point.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <RepeatCta href={localizedHref("/signup", locale)} label={t.hero.cta} />

      {t.article ? <FeatureArticleSection locale={locale} article={t.article} /> : null}

      {/* FAQ. */}
      <section className="py-16">
        <ScrollReveal direction="up" className="pb-8">
          <SectionHeader title={dict.landing.sections.faq.title} />
        </ScrollReveal>
        <ScrollReveal direction="up">
          <FaqAccordion items={t.faq} />
        </ScrollReveal>
      </section>

      <RepeatCta href={localizedHref("/signup", locale)} label={t.hero.cta} />

      {/* Cross-links to the sibling marketing pages (crawl path between spokes). */}
      <ExploreMoreSection locale={locale} current={spokeKey} dict={dict} />
    </div>
  );
}

// Long-form article (h2 under the page h1, h3 per section), styled like the
// long-form legal text in LegalDoc: 15px / leading-7 / muted, ps-5 lists.
// Exported so the hand-built spokes can render the same section.
export function FeatureArticleSection({
  locale,
  article,
}: {
  locale: "ar" | "en";
  article: FeatureArticle;
}) {
  return (
    <section className="py-16">
      <ScrollReveal direction="up">
        <article className="mx-auto w-full max-w-3xl text-start">
          <h2 className="text-2xl font-medium leading-tight text-foreground md:text-3xl">
            {article.title}
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            <InlineLinks text={article.intro} locale={locale} />
          </p>
          <div className="mt-10 flex flex-col gap-9">
            {article.sections.map((section, i) => (
              <section key={i}>
                <h3 className="text-lg font-semibold text-foreground">{section.heading}</h3>
                {section.blocks.map((block, j) => (
                  <ArticleBlockView key={j} block={block} locale={locale} />
                ))}
              </section>
            ))}
          </div>
        </article>
      </ScrollReveal>
    </section>
  );
}

function ArticleBlockView({
  block,
  locale,
}: {
  block: ArticleBlock;
  locale: "ar" | "en";
}) {
  if (typeof block === "string") {
    return (
      <p className="mt-3 text-[15px] leading-7 text-muted">
        <InlineLinks text={block} locale={locale} />
      </p>
    );
  }
  const ordered = "steps" in block;
  const items = ordered ? block.steps : block.bullets;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <ListTag
      className={`mt-3 flex flex-col gap-2 ps-5 text-[15px] leading-7 text-muted marker:text-muted ${ordered ? "list-decimal" : "list-disc"}`}
    >
      {items.map((item, i) => (
        <li key={i}>
          <InlineLinks text={item} locale={locale} />
        </li>
      ))}
    </ListTag>
  );
}

// Renders [text](/path) as an internal, locale-prefixed link. Only paths that
// start with a single "/" are linked (no external URLs, no protocol-relative
// "//"), so dictionary copy can never inject an outbound or unsafe href.
const LINK_RE = /\[([^\]]+)\]\((\/(?!\/)[^)\s]*)\)/g;

function InlineLinks({ text, locale }: { text: string; locale: "ar" | "en" }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link
        key={at}
        href={localizedHref(m[2], locale)}
        className="text-[var(--tq-violet)] underline-offset-4 hover:underline"
      >
        {m[1]}
      </Link>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
