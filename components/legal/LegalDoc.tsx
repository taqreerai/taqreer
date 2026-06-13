// Legal document body (Terms / Privacy / Refund). PURE CONTENT: the chrome
// (landing background + nav + footer) is provided by app/[lang]/(legal)/layout.
// Renders a centred prose column, chrome-dir aware via the [lang] layout.

import {
  LEGAL_DOCS,
  LEGAL_META,
  type LegalKind,
  type LegalBlock,
} from "@/lib/legal/content";

type Locale = "ar" | "en";

const LABELS = {
  en: { lastUpdated: "Last updated" },
  ar: { lastUpdated: "آخر تحديث" },
} as const;

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
  const t = LABELS[locale];

  return (
    <article className="mx-auto w-full max-w-3xl pb-16">
      <h1 className="text-3xl font-bold text-foreground">{doc.title}</h1>
      <p className="mt-2 text-xs text-muted">
        {t.lastUpdated}: {LEGAL_META.effectiveDate}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {LEGAL_META.entityName} · {LEGAL_META.address}
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
    </article>
  );
}
