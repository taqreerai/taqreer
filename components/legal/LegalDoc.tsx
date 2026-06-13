// Server-component renderer for a legal document (Terms / Privacy / Refund).
// Standalone public page (no app shell) — a centred prose column on the app
// background, chrome-dir aware via the [lang] layout's <html dir>. Content is
// the same in both languages structurally, so this stays purely presentational.

import Link from "next/link";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  LEGAL_DOCS,
  LEGAL_META,
  type LegalKind,
  type LegalBlock,
} from "@/lib/legal/content";

type Locale = "ar" | "en";

// Inline micro-copy (these standalone pages render outside the dictionary-fed
// app chrome; the global-error page sets the same precedent).
const UI = {
  en: {
    lastUpdated: "Last updated",
    home: "Back to home",
    operatedBy: "Operated by",
    related: "Terms · Privacy · Refunds",
  },
  ar: {
    lastUpdated: "آخر تحديث",
    home: "العودة للرئيسية",
    operatedBy: "تشغّلها",
    related: "الشروط · الخصوصية · الاسترداد",
  },
} as const;

const RELATED: { kind: LegalKind; href: string }[] = [
  { kind: "terms", href: "/terms" },
  { kind: "privacy", href: "/privacy" },
  { kind: "refund", href: "/refund" },
];

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return <p className="mt-3 text-[15px] leading-7 text-muted">{block}</p>;
  }
  return (
    <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 text-[15px] leading-7 text-muted marker:text-muted">
      {block.list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalDoc({ kind, locale }: { kind: LegalKind; locale: Locale }) {
  const doc = LEGAL_DOCS[kind][locale];
  const t = UI[locale];

  return (
    <main className="page-container mx-auto flex w-full max-w-3xl flex-col px-6 py-10">
      {/* Header: logo home-link */}
      <Link
        href={localizedHref("/", locale)}
        className="mb-10 inline-flex w-fit items-center no-underline"
        aria-label={t.home}
      >
        <ThemeLogo width={120} height={28} />
      </Link>

      <h1 className="text-3xl font-bold text-foreground">{doc.title}</h1>
      <p className="mt-2 text-xs text-muted">
        {t.lastUpdated}: {LEGAL_META.effectiveDate} · {t.operatedBy}{" "}
        {LEGAL_META.entityName}
      </p>

      <p className="mt-6 text-[15px] leading-7 text-muted">{doc.intro}</p>

      <div className="mt-10 flex flex-col gap-9">
        {doc.sections.map((section, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold text-foreground">
              {section.heading}
            </h2>
            {section.blocks.map((block, j) => (
              <Block key={j} block={block} />
            ))}
          </section>
        ))}
      </div>

      {/* Footer: related docs + home */}
      <div className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--tq-border-hairline)] pt-6 text-sm">
        {RELATED.filter((r) => r.kind !== kind).map((r) => (
          <Link
            key={r.kind}
            href={localizedHref(r.href, locale)}
            className="text-muted no-underline transition-colors hover:text-foreground"
          >
            {LEGAL_DOCS[r.kind][locale].title}
          </Link>
        ))}
        <Link
          href={localizedHref("/", locale)}
          className="text-muted no-underline transition-colors hover:text-foreground"
        >
          {t.home}
        </Link>
      </div>
    </main>
  );
}
