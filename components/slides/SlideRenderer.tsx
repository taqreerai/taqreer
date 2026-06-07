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

import { memo, useEffect, useMemo, useState } from "react";
import type { SlideType, ThemeType } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { scanGenImages } from "@/lib/images/slide-images";
import { usedGoogleFonts, googleFontUrl } from "@/lib/editor/font-search";
import { useGenImageFills } from "@/components/slides/gen-image-context";

type SlideRendererProps = {
  slide: SlideType;
  theme: ThemeType;
  direction?: "rtl" | "ltr";
  language?: "ar" | "en";
  width?: number;
  height?: number;
  scale?: number;
};

// The renderer's FIRST paint is intentionally empty (sanitisation runs in a
// post-mount effect — see the trust-model note at the top), so on every mount
// the outer wrapper shows for one frame before the slide HTML lands. Painting
// the deck `theme.background` there flashes WHITE under a dark slide in a light
// deck — the FOUC the user saw on reload + tab-switch. Resolve the slide's OWN
// root background from its <style> so that first frame is the slide's colour and
// the flash vanishes. Best-effort with a safe fallback to the deck theme bg, so
// a slide we can't parse just keeps today's behaviour (no regression).
export function slideRootBackground(html: string, fallback: string): string {
  const style = html.match(/<style[\s\S]*?<\/style>/i)?.[0];
  if (!style) return fallback;
  const vars: Record<string, string> = {};
  // Stop at `;` OR `}` (lookahead, non-consuming) — the LAST declaration in a
  // rule has no trailing semicolon (e.g. `.tq-canvas{--paper:#FFF}`), which a
  // `;`-terminated pattern would miss and fall back to the deck theme.
  for (const m of style.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g)) {
    vars[m[1].trim()] = m[2].trim();
  }
  // Root rule(s): `.tq-canvas`, `.tq-canvas.s`, `.tq-canvas.<rootclass>` (compound,
  // NOT a descendant `.tq-canvas .x`) carrying a background. Last one wins.
  let bg: string | null = null;
  for (const m of style.matchAll(/\.tq-canvas(?:\.[\w-]+)*\s*\{([^}]*)\}/gi)) {
    const decl = m[1].match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
    if (!decl) continue;
    let val = decl[1].trim();
    const v = val.match(/var\(\s*(--[\w-]+)/);
    if (v && vars[v[1]]) val = vars[v[1]].trim();
    if (val && val !== "transparent" && !val.startsWith("var(")) bg = val;
  }
  return bg ?? fallback;
}

function SlideRendererImpl({
  slide,
  theme,
  direction = "rtl",
  language = "ar",
  width = 1920,
  height = 1080,
  scale = 1,
}: SlideRendererProps) {
  // The slide's own root background (falls back to the deck theme) — painted on
  // the wrapper so the empty first-paint frame doesn't flash white. See
  // slideRootBackground above.
  const rootBg = useMemo(
    // Fallback TRANSPARENT (not the deck theme): many decks paint the visible
    // background on a CHILD element and leave the root white, so falling back to
    // the (white) theme bg would still flash white before the child paints.
    // Transparent lets the dark editor/nav panel show through that one frame
    // instead. Slides that DO set a resolvable root bg still get it exactly.
    () => slideRootBackground(slide.html, "transparent"),
    [slide.html],
  );
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

  // Live generated-image fills (context/images.md). Empty outside a
  // provider — so exports / standalone thumbnails are untouched and just
  // render the saved HTML (which already carries reconciled src).
  const fills = useGenImageFills();

  // The reserved-box genids present in THIS slide. Found via the shared
  // scanner, which is QUOTE-AGNOSTIC — Claude emits attributes single-OR
  // double-quoted (`data-genid='img-cover'`), so a hardcoded
  // `includes('data-genid="…"')` check silently matched NOTHING and the
  // live fill never injected. Memoised on slide.html alone so an unrelated
  // slide's fill doesn't force a re-scan.
  const slideGenids = useMemo(() => {
    if (!slide.html.includes("data-genid")) return null;
    return new Set(scanGenImages(slide.html).map((m) => m.genid));
  }, [slide.html]);

  // Signature of THIS slide's relevant fills only. A string primitive, so
  // its VALUE is stable when this slide's boxes haven't changed — that's
  // what stops an unrelated `slide.image.ready` for another slide from
  // re-sanitising every mounted SlideRenderer (hero + N nav thumbnails).
  const fillSig = useMemo(() => {
    if (!slideGenids) return "";
    return Object.entries(fills)
      .filter(([genid]) => slideGenids.has(genid))
      .map(([genid, url]) => `${genid}=${url}`)
      .sort()
      .join("\n");
  }, [slideGenids, fills]);

  // Sanitise the slide HTML AND bake in THIS slide's ready image fills, as one
  // string. Keyed on `[slide.html, fillSig]` where `fillSig` is THIS slide's
  // fills only.
  //
  // Why bake the image into the content instead of patching it onto the DOM
  // afterward (the previous approach): a generated image used to live OUTSIDE
  // the slide HTML and was re-stitched by a separate effect every time the
  // slide rendered. That left it fragile — any rebuild (a Claude re-stream
  // mid-generation, the streaming→completed swap) recreated the <img> EMPTY,
  // and the re-stitch lagged a poll cycle, so an already-shown image dropped
  // back to its shimmer for seconds. Worse, because the patch keyed on the
  // shared `sanitized`, a LATER image landing rebuilt EARLIER slides and wiped
  // their images (the observed chain reaction). Making the image part of the
  // slide's own content fixes both:
  //   • another slide's fill can't change THIS `fillSig` → no rebuild here;
  //   • any genuine rebuild carries the baked <img src> with it → no empty flash.
  useEffect(() => {
    // sanitizeSlideHtml() is fail-closed: empty string on any failure.
    const safe = sanitizeSlideHtml(slide.html);
    if (!safe || !fillSig) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSanitized(safe);
      return;
    }
    const byGenid = new Map(
      fillSig.split("\n").map((pair) => {
        const eq = pair.indexOf("=");
        return [pair.slice(0, eq), pair.slice(eq + 1)] as const;
      }),
    );
    // Inject via the DOM (client-only effect) rather than string-splicing
    // unsanitised markup. URLs are our own deterministic Supabase public URLs.
    const scratch = document.createElement("div");
    scratch.innerHTML = safe;
    let touched = false;
    for (const img of scratch.querySelectorAll<HTMLImageElement>(
      "img[data-genimage]",
    )) {
      const url = byGenid.get(img.getAttribute("data-genid") ?? "");
      // Skip a box whose src is ALREADY the reconciled URL (reload / export
      // path, where the saved HTML carries src) so the fade-in doesn't replay
      // on every navigation — it only runs for a box filled live this session.
      if (!url || img.getAttribute("src") === url) continue;
      img.setAttribute("src", url);
      img.classList.add("tq-genimg-in"); // one-shot fade for live-injected boxes
      touched = true;
    }
    setSanitized(touched ? scratch.innerHTML : safe);
  }, [slide.html, fillSig]);

  // Per-element picked fonts (font-search) — render side. SlideRenderer paints
  // INLINE in the parent document, so any Google font the slide references must
  // be loaded into <head>. Inject the css2 <link> once per family (deduped by id)
  // — same trusted-code pattern as the theme font, never into user HTML.
  useEffect(() => {
    for (const family of usedGoogleFonts(sanitized)) {
      const id = `tq-gfont-${family.replace(/[^A-Za-z0-9]+/g, "-")}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = googleFontUrl(family);
      document.head.appendChild(link);
    }
  }, [sanitized]);

  // NO inset buffer (was attempted 2026-05-23 then reverted same
  // day). The buffer-ring approach assumed the slide's own root bg
  // matched `theme.background`, but Claude-generated slides
  // routinely override the root bg (e.g. a hero slide with dark
  // root inside a light-theme deck). The result was a visible
  // theme-coloured frame around darker slides in the
  // SlideNavSidebar thumbnails — the user reported "thumbnails
  // don't fit the frame, there is padding inside" 2026-05-23.
  //
  // OVERSCAN to kill the sub-pixel edge bleed at low scales: at the exact fit,
  // `width*scale` is fractional and the scaled slide's edge lands ON the consumer's
  // fractional overflow-hidden boundary, so its anti-aliased edge blends with the
  // outer `theme.background` (often white) — a ~1px line on differently-coloured
  // slides (e.g. a dark slide). ceil the outer so it's ≥ the consumer's clip, and
  // scale the content to FILL it: the slide's edge then lands PAST the clip, which
  // trims the fuzzy edge so only solid slide colour meets it. The sub-px overshoot
  // is clipped too. (Same fix the SlideEditor iframe uses.)
  const dispW = Math.ceil(width * scale);
  const dispH = Math.ceil(height * scale);
  const fillScale = Math.max(dispW / width, dispH / height);
  return (
    <div
      style={{
        width: dispW,
        height: dispH,
        position: "relative",
        // No `overflow: hidden` on either wrapper. The CONSUMER owns
        // the visual clip (hero canvas + thumbnail button both wrap
        // SlideRenderer in their own overflow-hidden box).
        flexShrink: 0,
        background: rootBg,
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
          transform: `scale(${fillScale})`,
          transformOrigin: "top left",
          color: theme.text,
          fontFamily: `var(--font-body)`,
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </div>
  );
}

// Skip re-render when a slide's CONTENT + layout are unchanged. The live
// preview status poll re-fetches the whole streaming manifest every ~1.5s and
// hands DeckView all-new slide/theme objects even when nothing changed; without
// this guard each SlideRenderer re-applies its `dangerouslySetInnerHTML` on
// every tick, which DESTROYS + recreates every <img> inside — resetting the
// load shimmer AND wiping a freshly-patched gen-image `src` before it can
// stick (~1300 needless rebuilds across one image-generation window, measured).
// Comparing by VALUE here freezes a Claude-finished slide so only its image box
// changes when gpt delivers it.
//
// Crucially this does NOT block live image fills: those arrive through the
// GenImageFills CONTEXT (`useGenImageFills`), and a context change re-renders
// its consumers regardless of React.memo — so a landing image still triggers
// the imperative patch effect. We only skip the wasteful poll-churn re-renders
// that carry identical content.
function slideRendererPropsEqual(
  a: SlideRendererProps,
  b: SlideRendererProps,
): boolean {
  return (
    a.scale === b.scale &&
    a.width === b.width &&
    a.height === b.height &&
    a.direction === b.direction &&
    a.language === b.language &&
    a.slide.slideId === b.slide.slideId &&
    a.slide.role === b.slide.role &&
    a.slide.html === b.slide.html &&
    // theme is kept referentially stable upstream for unchanged content
    // (streaming theme + setManifestStable); a genuine theme change is a new
    // object, so a ref check both skips churn and catches real changes.
    a.theme === b.theme
  );
}

export const SlideRenderer = memo(SlideRendererImpl, slideRendererPropsEqual);

