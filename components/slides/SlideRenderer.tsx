"use client";

import { useMemo } from "react";
import DOMPurify, { type Config } from "dompurify";
import type { SlideType, ThemeType } from "@/lib/schema/slide";

// Renders one HTML-authored slide.
//
// Trust model: Claude's HTML is sanitised with DOMPurify (strips <script>,
// event handlers, javascript: URIs) and rendered via dangerouslySetInnerHTML.
// We deliberately keep <style>, <svg>, <link>, <img> — Claude needs them
// for typography, inline icons/logos, gradients, decorative shapes.
//
// Iframe sandboxing was considered but rejected: dom-to-pptx can't traverse
// across an iframe boundary, so the export would not match the preview.
// The threat model here is "Claude emits unexpected markup", not "untrusted
// third-party HTML" — DOMPurify is the right tool for that threat.

const DOMPURIFY_CONFIG: Config = {
  // Allow inline <style>, <svg>, <link rel="stylesheet"> — Claude needs
  // these for typography, gradients, icons, decorative shapes.
  ADD_TAGS: ["style", "link"],
  ADD_ATTR: ["dir", "lang", "viewBox", "preserveAspectRatio", "xmlns"],
  // Block nested iframes and embedded objects.
  FORBID_TAGS: ["iframe", "object", "embed", "frame", "frameset"],
  // <script>, event handlers, and javascript: URIs are blocked by default.
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
};

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
  const sanitized = useMemo(
    () => DOMPurify.sanitize(slide.html, DOMPURIFY_CONFIG),
    [slide.html]
  );

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
          transform: `scale(${scale})`,
          transformOrigin: direction === "rtl" ? "top right" : "top left",
          color: theme.text,
          fontFamily: `var(--font-body)`,
          position: "relative",
          overflow: "hidden",
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </div>
  );
}
