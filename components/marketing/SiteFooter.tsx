// Shared site footer: used by the landing (app/[lang]/page.tsx) and the legal
// pages so they share one chrome. Self-contained (own max-w column + dict
// fetch) so it can drop into any public page with just a locale.

import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localizedHref } from "@/lib/i18n/navigation";
import { LEGAL_META } from "@/lib/legal/content";

// In-page anchors keep their "#…"; route hrefs ("/…") get the locale prefix.
const FOOTER_LINK_HREFS: Record<string, string> = {
  features: "#features",
  pricing: "#pricing",
  faq: "#faq",
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund",
};

// Real social handles (taqreerai). Rendered as brand icons, not text links.
const SOCIALS: { label: string; href: string; path: string }[] = [
  {
    label: "X",
    href: "https://x.com/taqreerai",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    label: "Instagram",
    href: "https://instagram.com/taqreerai",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/company/taqreerai",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
];

const PX = "px-4 sm:px-6 lg:px-8";

export async function SiteFooter({
  locale,
  // The landing renders the footer INSIDE its max-w-7xl column, so the footer's
  // own padding + inner max-w-7xl would double-inset it and it reads narrower
  // than the full-width FAQ rows above it. `fullBleed` drops both so the footer
  // grid spans the full column like the FAQ (user direction 2026-06-14). Legal
  // pages render it at viewport width, so they keep the default constraint.
  fullBleed = false,
}: {
  locale: "ar" | "en";
  fullBleed?: boolean;
}) {
  const dict = await getDictionary(locale);
  const footer = dict.landing.footer.groups;
  // Keyed so the social column can render icons instead of text links.
  const columns = [
    { key: "contact", group: footer.contact },
    { key: "links", group: footer.links },
    { key: "social", group: footer.social },
    { key: "legal", group: footer.legal },
  ];

  return (
    <footer className={`${fullBleed ? "px-4 sm:px-6 lg:px-0" : PX} pt-20 pb-8`}>
      <div className={fullBleed ? "" : "mx-auto max-w-7xl"}>
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-4">
          {columns.map(({ key, group }) => (
            <div key={key} className="md:px-8 md:first:pe-0">
              <h4 className="mb-6 font-medium text-foreground">{group.title}</h4>
              {key === "social" ? (
                <div className="flex items-center gap-3">
                  {SOCIALS.map((s) => (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="icon-hover"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d={s.path} />
                      </svg>
                    </a>
                  ))}
                </div>
              ) : key === "contact" ? (
                <ul className="space-y-3 text-sm">
                  {/* Block follows the page direction (right-aligned in RTL);
                      only the LTR content is BiDi-isolated. */}
                  <li className="text-muted">
                    <bdi dir="ltr">{LEGAL_META.address}</bdi>
                  </li>
                  <li>
                    <a className="icon-hover" href="mailto:support@taqreer.ai">
                      <bdi dir="ltr">support@taqreer.ai</bdi>
                    </a>
                  </li>
                  <li>
                    <a
                      className="btn-gradient inline-flex w-fit rounded-full px-4 py-2 text-xs font-medium"
                      href={localizedHref("/contact", locale)}
                    >
                      {footer.contact.links.form}
                    </a>
                  </li>
                </ul>
              ) : (
                <ul className="space-y-3 text-sm">
                  {Object.entries(group.links).map(([k, label]) => {
                    const raw = FOOTER_LINK_HREFS[k] ?? "#";
                    const href = raw.startsWith("/")
                      ? localizedHref(raw, locale)
                      : raw;
                    return (
                      <li key={label as string}>
                        <a className="icon-hover" href={href}>
                          {label as string}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
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
