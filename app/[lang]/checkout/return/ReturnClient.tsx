"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { ThemeLogo } from "@/components/brand/ThemeLogo";
import { NoticeCard } from "@/components/common/NoticeCard";

type State = "processing" | "success" | "failed";

export function ReturnClient({ sessionId }: { sessionId: string | null }) {
  const dict = useDict();
  const { locale, dir } = useLocale();
  const t = dict.checkout;
  const [state, setState] = useState<State>("processing");

  useEffect(() => {
    if (!sessionId) {
      setState("failed");
      return;
    }
    let live = true;
    fetch(`/api/stripe/checkout/status?session_id=${encodeURIComponent(sessionId)}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: string; paymentStatus?: string } | null) => {
        if (!live) return;
        const ok =
          d?.status === "complete" &&
          (d.paymentStatus === "paid" || d.paymentStatus === "no_payment_required");
        setState(ok ? "success" : "failed");
      })
      .catch(() => {
        if (live) setState("failed");
      });
    return () => {
      live = false;
    };
  }, [sessionId]);

  return (
    <main dir={dir} className="min-h-screen bg-[var(--tq-panel)]">
      <header className="mx-auto flex max-w-2xl items-center px-6 py-5">
        <Link href={localizedHref("/", locale)} aria-label="taqreer.ai">
          <ThemeLogo width={108} height={28} />
        </Link>
      </header>
      <div className="mx-auto max-w-md px-6 pt-[10vh]">
        <div className="surface-card rounded-2xl">
          {state === "processing" ? (
            <NoticeCard icon="hourglass_top" title={t.returnProcessing} />
          ) : state === "success" ? (
            <NoticeCard
              icon="check"
              title={t.returnSuccess}
              body={t.returnSuccessBody}
              actions={
                <Link
                  href={localizedHref("/settings", locale)}
                  className="btn-gradient px-5 py-2.5 text-center text-sm no-underline"
                >
                  {t.toBilling}
                </Link>
              }
            />
          ) : (
            <NoticeCard
              icon="warning"
              tone="warn"
              title={t.returnFailed}
              body={t.returnFailedBody}
              actions={
                <Link
                  href={localizedHref("/settings", locale)}
                  className="btn-pill px-5 py-2.5 text-center text-sm no-underline"
                >
                  {t.toBilling}
                </Link>
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}
