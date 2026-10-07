"use client";

// Error boundary around the checkout UI (2026-10-07). The app had NO boundary
// below global-error, so any render / effect error inside the upgrade modal
// (opened from the studio's "unlock the rest of the slides" button, at the
// exact moment a visitor decides to pay) replaced the WHOLE page with "an
// unexpected error occurred". Now a failure stays inside the checkout: the
// user sees a retry button and a link to the full plans page (which has its
// own checkout), and the studio, their deck and the modal frame stay put.

import { Component, type ReactNode } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

type Fallback = (reset: () => void) => ReactNode;

class Boundary extends Component<
  { fallback: Fallback; where: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    Sentry.withScope((scope) => {
      scope.setTag("boundary", this.props.where);
      Sentry.captureException(error);
    });
    posthog.capture("checkout_ui_crashed", {
      where: this.props.where,
      message: error.message?.slice(0, 200),
    });
  }

  render() {
    return this.state.failed
      ? this.props.fallback(() => this.setState({ failed: false }))
      : this.props.children;
  }
}

export function CheckoutBoundary({
  where,
  children,
}: {
  where: string;
  children: ReactNode;
}) {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.checkout;
  return (
    <Boundary
      where={where}
      fallback={(reset) => (
        <div className="surface-card flex flex-col items-center gap-4 rounded-2xl p-8 text-center">
          <p className="text-sm text-muted">{t.error}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={reset} className="btn-gradient px-6 py-2.5 text-sm">
              {dict.globalError.retry}
            </button>
            <Link
              href={localizedHref("/plans", locale)}
              className="btn-pill px-6 py-2.5 text-sm no-underline"
            >
              {t.back}
            </Link>
          </div>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}
