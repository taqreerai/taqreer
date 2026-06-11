"use client";

// Shared 404 body (icon + message + recovery link), used by both not-found
// boundaries. A client component so it can read the active locale + dictionary
// from <LocaleProvider> — both not-found files render inside the [lang] layout,
// so the provider (and the correct <html dir>) are already in place. The outer
// container/padding is supplied by each parent; this is just the inner trio.
import Link from "next/link";
import { ParagraphWriteIcon } from "@/components/preview/ParagraphWriteIcon";
import { useLocale, useDict } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

export function NotFoundContent({ recovery }: { recovery: "home" | "dashboard" }) {
  const { locale } = useLocale();
  const t = useDict().notFound;

  return (
    <>
      <ParagraphWriteIcon size={88} className="text-foreground" mode="break" />
      <p className="max-w-md whitespace-pre-line text-base leading-relaxed text-foreground/70">
        {t.messagePrefix}
        <Link
          href={`${localizedHref("/", locale)}#contact`}
          className="text-foreground underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
        >
          {t.reportLink}
        </Link>
        .
      </p>
      <Link
        href={localizedHref(recovery === "home" ? "/" : "/dashboard", locale)}
        className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-foreground/[0.04] px-5 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-foreground/[0.08]"
      >
        {recovery === "home" ? t.backHome : t.backDashboard}
      </Link>
    </>
  );
}
