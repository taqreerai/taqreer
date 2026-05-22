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
import { themeToCssVars } from "@/lib/export/theme-css-vars";

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
  // Shared helper returns a `Record<string, string>` so the html-document
  // export can reuse the same source of truth. Cast to CSSProperties for
  // the inline-style API — React accepts string keys prefixed with `--`.
  const cssVars = useMemo(
    () => themeToCssVars(theme) as React.CSSProperties,
    [theme],
  );

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

  // NO inset buffer (was attempted 2026-05-23 then reverted same
  // day). The buffer-ring approach assumed the slide's own root bg
  // matched `theme.background`, but Claude-generated slides
  // routinely override the root bg (e.g. a hero slide with dark
  // root inside a light-theme deck). The result was a visible
  // theme-coloured frame around darker slides in the
  // SlideNavSidebar thumbnails — the user reported "thumbnails
  // don't fit the frame, there is padding inside" 2026-05-23.
  //
  // Trade-off: slide-edge strokes (full-width dividers / borders
  // at the canvas edges) may get sub-pixel-aliased at low scales
  // (thumbnails). Accepting that for now — visible padding is the
  // worse defect. A proper fix would either (a) snapshot
  // thumbnails to PNG so sub-pixel rendering applies once
  // server-side, or (b) detect the actual slide-root bg and feed
  // it into the outer wrapper instead of `theme.background`.
  return (
    <div
      style={{
        width: width * scale,
        height: height * scale,
        position: "relative",
        // No `overflow: hidden` on either wrapper. The CONSUMER owns
        // the visual clip (hero canvas + thumbnail button both wrap
        // SlideRenderer in their own overflow-hidden box).
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
          // `position: absolute` + a small `EDGE_STROKE_BUFFER_PX`
          // offset on left/top pins the scaled child to the outer
          // wrapper's top-left corner, INSET by the buffer amount.
          // The transform-origin: top-left means the scaled content
          // starts at exactly the buffer offset, ending at
          // `BUFFER + width·adjustedScale = outerWidth − BUFFER`.
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          color: theme.text,
          fontFamily: `var(--font-body)`,
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </div>
  );
}
