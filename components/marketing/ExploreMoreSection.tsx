// "Explore more" cross-link band for the marketing spokes. Server component:
// pure links, no client JS. Each spoke renders 3 sibling spokes + pricing so
// the landing hub is no longer the only crawl path between them (topical
// cluster + crawl depth). Copy from dict.exploreMore; tokens only.

import { localizedHref } from "@/lib/i18n/navigation";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import type { Locale } from "@/lib/i18n/config";
import type { getDictionary } from "@/lib/i18n/dictionaries";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

export type SpokeKey =
  | "aiPresentations"
  | "socialMediaPosts"
  | "redesign"
  | "presentationStyle"
  | "arabicPresentations"
  | "templates"
  | "stockImages"
  | "pdfToPowerpoint"
  | "wordToPowerpoint"
  | "powerpointOnline"
  | "powerpointImages"
  | "brandKit"
  | "collaboration"
  | "exportFormats";

const SPOKE_PATHS: Record<SpokeKey, string> = {
  aiPresentations: "/ai-presentations",
  socialMediaPosts: "/social-media-posts",
  redesign: "/redesign",
  presentationStyle: "/presentation-style",
  arabicPresentations: "/arabic-presentations",
  templates: "/presentation-templates",
  stockImages: "/free-stock-images",
  // One-feature-per-page spokes (2026-10-01).
  pdfToPowerpoint: "/pdf-to-powerpoint",
  wordToPowerpoint: "/word-to-powerpoint",
  powerpointOnline: "/powerpoint-online",
  powerpointImages: "/powerpoint-images",
  brandKit: "/brand-kit",
  collaboration: "/collaboration",
  exportFormats: "/export",
};

// Each spoke links the 3 siblings that FOLLOW it in SPOKE_PATHS order,
// wrapping around (a rotation, not a fixed slice) - so every spoke gets
// linked from 3 others and the crawl graph covers all of them. A plain
// filter + slice(0, 3) would never surface the last entries.
export function ExploreMoreSection({
  locale,
  current,
  dict,
}: {
  locale: Locale;
  current: SpokeKey;
  dict: Dict;
}) {
  const t = dict.exploreMore;
  const keys = Object.keys(SPOKE_PATHS) as SpokeKey[];
  const start = keys.indexOf(current);
  const siblings = Array.from(
    { length: 3 },
    (_, i) => keys[(start + 1 + i) % keys.length],
  );
  const links = [
    ...siblings.map((key) => ({
      href: localizedHref(SPOKE_PATHS[key], locale),
      title: t.links[key].title,
      body: t.links[key].body,
    })),
    {
      href: localizedHref("/pricing", locale),
      title: t.links.pricing.title,
      body: t.links.pricing.body,
    },
  ];

  return (
    <section className="py-16">
      <ScrollReveal direction="up" className="pb-10">
        <SectionHeader title={t.title} subtitle={t.subtitle} />
      </ScrollReveal>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {links.map((link, i) => (
          <ScrollReveal key={link.href} direction="up" delay={i * 0.06}>
            <a
              href={link.href}
              className="surface-card group flex h-full flex-col rounded-[14px] p-6 transition-colors"
            >
              <span className="mb-2 flex items-center gap-2 text-base font-medium">
                {link.title}
                <span
                  className="material-symbols-outlined text-[18px] leading-none text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                  aria-hidden
                >
                  arrow_forward
                </span>
              </span>
              <span className="text-sm leading-relaxed text-muted">
                {link.body}
              </span>
            </a>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
