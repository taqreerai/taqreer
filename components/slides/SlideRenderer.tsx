"use client";

// Trust model
// -----------
// Claude-authored slide HTML is sanitised at render time using DOMPurify
// (via `lib/export/sanitize.ts`, which calls the DOMPurify factory with
// the live `window` to bypass the SSR-loaded singleton). Sanitisation runs
// inside `useEffect` so it happens AFTER mount, guaranteed on the client —
// the first render is intentionally empty to avoid hydration mismatches
// and to keep the SSR pass from ever touching slide HTML.
//
// Fail-closed: if sanitisation fails (DOMPurify unavailable, factory
// surprise), the renderer keeps the empty initial state and logs a
// console error. We never fall back to raw HTML.
//
// Pre-launch hardening TODO: move sanitisation server-side in
// `inngest/functions/deck-generate.ts`, BEFORE the manifest is written to
// the DB. Then this client-side step becomes belt-and-suspenders rather
// than the only line of defence.

import { useEffect, useMemo, useState } from "react";
import type { SlideType, ThemeType } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";

function themeToCssVars(theme: ThemeType): React.CSSProperties {
  const vars: Record<string, string> = {
    "--brand-bg": theme.background,
    "--brand-text": theme.text,
    "--font-heading": `"${theme.fontHeading.name}", system-ui, sans-serif`,
    "--font-body": `"${theme.fontBody.name}", system-ui, sans-serif`,
  };
  theme.palette.forEach((hex, i) => {
    vars[`--brand-${i + 1}`] = hex;
  });
  // Convenience aliases — Claude can use --primary / --accent / --secondary
  // without thinking about indexes.
  if (theme.palette[0]) vars["--primary"] = theme.palette[0];
  if (theme.palette[1]) vars["--secondary"] = theme.palette[1];
  if (theme.palette[2]) vars["--accent"] = theme.palette[2];
  return vars as React.CSSProperties;
}

export function SlideRenderer({
  slide,
  theme,
  direction = "rtl",
  language = "ar",
  width = 1920,
  height = 1080,
  scale = 1,
}: {
  slide: SlideType;
  theme: ThemeType;
  direction?: "rtl" | "ltr";
  language?: "ar" | "en";
  width?: number;
  height?: number;
  scale?: number;
}) {
  const cssVars = useMemo(() => themeToCssVars(theme), [theme]);

  // Empty until the client-side useEffect produces a sanitised string. This
  // means SSR and the first client render are identical (empty inner HTML),
  // avoiding hydration mismatches AND ensuring no raw HTML is ever painted.
  //
  // The set-state-in-effect lint rule below is suppressed on purpose: this
  // is the canonical "derive state from a prop using a side effect that
  // must run client-only" pattern. We can't compute during render because
  // SSR has no `window` for DOMPurify; we can't use useMemo because that
  // also runs during SSR. Effect → setState → re-render is exactly what
  // we want here, not "cascading" runaway state.
  const [sanitized, setSanitized] = useState<string>("");

  useEffect(() => {
    // sanitizeSlideHtml() is fail-closed: empty string on any failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSanitized(sanitizeSlideHtml(slide.html));
  }, [slide.html]);

  return (
    <div
      style={{
        width: width * scale,
        height: height * scale,
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        background: theme.background,
      }}
    >
      <div
        dir={direction}
        lang={language}
        data-slide-id={slide.slideId}
        style={{
          ...cssVars,
          width,
          height,
          // `position: absolute` + `left: 0; top: 0` pins the scaled
          // child to the outer wrapper's top-left corner regardless
          // of any ancestor's direction. Without this, an unscaled
          // box that is wider than its outer wrapper (always true:
          // 1080px content scaled to ~100px thumbnail) sits at
          // overflow's start edge — which is `right` in RTL flow
          // and `left` in LTR — so the matching `transform-origin`
          // would have to flip too. Pinning to top-left lets us use
          // a single `transform-origin: top left` everywhere.
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          color: theme.text,
          fontFamily: `var(--font-body)`,
          overflow: "hidden",
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </div>
  );
}
