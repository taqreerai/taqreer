"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html dir="rtl" lang="ar">
      <body className="page-container flex min-h-screen flex-col items-center justify-center gap-4 bg-[#03030D] text-white font-cairo">
        <h2 className="text-2xl">حدث خطأ غير متوقع</h2>
        <p className="text-muted">تم إبلاغ فريقنا تلقائياً</p>
        <button
          onClick={reset}
          className="rounded-lg bg-[#370BF4] px-6 py-3 text-base text-white cursor-pointer"
        >
          حاول مجدداً
        </button>
      </body>
    </html>
  );
}
