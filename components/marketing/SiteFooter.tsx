// Shared site footer — used by the landing (app/[lang]/page.tsx) and the legal
// pages so they share one chrome. Self-contained (own max-w column + dict
// fetch) so it can drop into any public page with just a locale.

import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";

// In-page anchors keep their "#…"; route hrefs ("/…") get the locale prefix.
const FOOTER_LINK_HREFS: Record<string, string> = {
  features: "#features",
  pricing: "#pricing",
  faq: "#faq",
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund",
};

const PX = "px-4 sm:px-6 lg:px-8";

export async function SiteFooter({ locale }: { locale: "ar" | "en" }) {
  const dict = await getDictionary(locale);
  const footer = dict.landing.footer.groups;
  const footerGroups = [
    footer.contact,
    footer.links,
    footer.social,
    footer.legal,
  ].map((group) => ({
    title: group.title,
    links: Object.entries(group.links).map(([key, label]) => {
      const href = FOOTER_LINK_HREFS[key] ?? "#";
      return {
        label: label as string,
        href: href.startsWith("/") ? localizedHref(href, locale) : href,
      };
    }),
  }));

  return (
    <footer className={`${PX} pt-20 pb-8`}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
          {footerGroups.map((group) => (
            <div key={group.title} className="md:px-8 md:first:pe-0">
              <h4 className="mb-6 font-medium text-foreground">{group.title}</h4>
              <ul className="space-y-3 text-sm text-muted">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      className="transition-colors hover:text-foreground"
                      href={link.href}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between pt-8 text-sm text-muted md:flex-row">
          <div className="mb-4 flex items-center gap-2 md:mb-0">
            <ThemeLogo
              width={120}
              height={28}
              className="h-7 w-auto object-contain opacity-80"
            />
          </div>
          <p>
            {dict.landing.footer.copyright.replace(
              "{year}",
              String(new Date().getFullYear()),
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
