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
      <body
        style={{
          background: "#03030D",
          color: "#FFFFFF",
          fontFamily: "Cairo, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: "16px",
        }}
      >
        <h2 style={{ fontSize: "24px" }}>حدث خطأ غير متوقع</h2>
        <p style={{ color: "#9A94A8" }}>تم إبلاغ فريقنا تلقائياً</p>
        <button
          onClick={reset}
          style={{
            background: "#370BF4",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "8px",
            padding: "12px 24px",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          حاول مجدداً
        </button>
      </body>
    </html>
  );
}
