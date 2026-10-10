"use client";

// One dismissible line for visitors whose browser is set to Arabic but who are
// on an English page: points them to the real Arabic page (proper RTL layout)
// instead of the browser's auto-translate, which rewrites text inside an LTR
// page and breaks the layout. Auto-translate is switched off site-wide
// (translate="no" on <html>, see app/[lang]/layout.tsx), so this is the
// replacement path. Inline Arabic copy: it only ever renders for Arabic readers.
//
// Browser language and the dismissal flag are read through
// useSyncExternalStore with a "hidden" server snapshot, so nothing renders at
// first paint or on the server (no hydration flip).

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { switchLocaleHref } from "@/lib/i18n/navigation";

const DISMISS_KEY = "tq_ar_suggestion_dismissed";

function subscribe() {
  return () => {};
}
function shouldOffer(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return false;
  } catch {
    /* storage blocked: still offer, dismissal lasts the session */
  }
  return (navigator.languages?.[0] ?? navigator.language ?? "")
    .toLowerCase()
    .startsWith("ar");
}
function shouldOfferServer() {
  return false;
}

export function ArabicSuggestion() {
  const { locale } = useLocale();
  const pathname = usePathname();
  const offer = useSyncExternalStore(subscribe, shouldOffer, shouldOfferServer);
  const [dismissed, setDismissed] = useState(false);

  if (locale !== "en" || !offer || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[1250] flex justify-center px-3">
      <div
        dir="rtl"
        lang="ar"
        className="surface-card pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm"
      >
        <p className="min-w-0 flex-1 text-muted">هذه الصفحة متوفرة بالعربية.</p>
        <Link
          href={switchLocaleHref(pathname, "ar")}
          className="btn-gradient shrink-0 px-4 py-1.5 text-sm"
        >
          التبديل إلى العربية
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="إغلاق"
          className="shrink-0 text-muted hover:text-foreground"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
            close
          </span>
        </button>
      </div>
    </div>
  );
}
