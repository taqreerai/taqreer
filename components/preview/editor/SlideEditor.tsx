"use client";

// In-canvas slide editor (context/plan-editor.md §0.5/§0.6 — the claude.ai/design
// clone). Renders the slide inside a SAME-ORIGIN srcdoc iframe — CSS isolation +
// export-parity-by-construction + a security boundary; no app styles bleed onto the
// slide. Because it's same-origin we script the iframe document directly (no
// postMessage bridge — that's the prod hardening step). Owns: element tagging
// (data-tq-id / data-tq-cc), hover + selection overlays drawn INSIDE the iframe
// (inflated ~2px so borders never touch glyphs), click→select-visual-leaf, and
// hardened dbl-click→contentEditable. Selection is controlled by the parent shell.
//
// Proven in /lab/editor (Phase 0). Content is scaled INSIDE the iframe (#tqe-stage):
// a transform on the iframe ELEMENT clips its paint in Chromium.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SlideType, ThemeType } from "@/lib/schema/slide";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { isVisualLeaf, isTextEditable, resolveSelectable } from "@/lib/editor/leaves";
import { buildDeckFontHead } from "@/lib/export/font-head";

type Props = {
  slide: SlideType;
  theme: ThemeType;
  direction: "rtl" | "ltr";
  language: "ar" | "en";
  width: number;
  height: number;
  scale: number;
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement | null) => void;
  onDocReady: (doc: Document | null) => void;
};

export function SlideEditor({
  slide, theme, direction, language, width, height, scale,
  selected, onSelect, onDocReady,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const selBoxRef = useRef<HTMLElement | null>(null);
  const hoverBoxRef = useRef<HTMLElement | null>(null);
  // Keep the latest onSelect without re-attaching iframe listeners every render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Latest selection, read by the (once-attached) iframe hover handler.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Sanitise the slide HTML in an effect — DOMPurify needs the live window, so doing
  // it during render hits the fail-closed (empty) path. Same pattern as SlideRenderer;
  // first render is intentionally empty, then this fills it.
  const [bodyHtml, setBodyHtml] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyHtml(sanitizeSlideHtml(slide.html));
  }, [slide.html]);

  // Scale the CONTENT inside the iframe — a `transform` on the iframe ELEMENT clips
  // its paint in Chromium (element box scales but the slide gets cut to a sliver). The
  // iframe sits at DISPLAY size; an inner #tqe-stage holds the full slide scaled to
  // fit. getBoundingClientRect of slide elements then returns display coords, which the
  // overlays use directly.
  const dispW = Math.round(width * scale);
  const dispH = Math.round(height * scale);
  const srcDoc = useMemo(() => {
    const vars = themeToCssVars(theme) as Record<string, string>;
    const rootVars = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
    // Load the deck's actual fonts INTO the iframe (Google <link> + uploaded
    // @font-face) — same source the export uses; without it the iframe is its own
    // document and falls back to a system font (wrong, esp. Arabic).
    const { links, faceCss } = buildDeckFontHead(theme);
    return `<!doctype html><html dir="${direction}" lang="${language}"><head><meta charset="utf-8">
${links}
<style>
${faceCss ? `${faceCss}\n` : ""}  html,body{margin:0;padding:0}
  :root{${rootVars}}
  body{position:relative;width:${dispW}px;height:${dispH}px;overflow:hidden;background:${theme.background};color:${theme.text};font-family:var(--font-body),'Cairo',system-ui,sans-serif}
  /* absolute + top-left so the RTL body can't right-align this wider-than-body stage */
  #tqe-stage{position:absolute;top:0;left:0;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left}
  .tqe-ov{position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;display:none}
  .tqe-hover{border:2px solid #10B981}
  .tqe-sel{border:2px solid #15B04F}
  [contenteditable="true"]{outline:none}
</style></head><body><div id="tqe-stage">${bodyHtml}</div></body></html>`;
  }, [bodyHtml, theme, direction, language, width, height, scale, dispW, dispH]);

  // Wire the iframe document once it loads (and on every srcDoc change → reload).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const wire = () => {
      const doc = iframe.contentDocument;
      const sec = doc?.querySelector("section");
      if (!doc || !sec) return;

      // Tag every element with a stable id; flag visual leaves (the editable units).
      let i = 0;
      for (const el of doc.querySelectorAll("*")) {
        if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
        el.setAttribute("data-tq-id", String(i++));
        if (isVisualLeaf(el)) el.setAttribute("data-tq-cc", "1");
      }

      // Overlay boxes (drawn inside the iframe → perfectly aligned, scale with it).
      const hover = doc.createElement("div");
      hover.className = "tqe-ov tqe-hover";
      const selBox = doc.createElement("div");
      selBox.className = "tqe-ov tqe-sel";
      doc.body.append(hover, selBox);
      hoverBoxRef.current = hover;
      selBoxRef.current = selBox;

      const onMove = (e: MouseEvent) => {
        const t = e.target as Element | null;
        if (!t || t === sec || !sec.contains(t)) { place(hover, null); return; }
        const unit = resolveSelectable(t, sec);
        place(hover, unit && unit !== selectedRef.current ? unit : null);
      };
      const onLeave = () => place(hover, null);
      const onClick = (e: MouseEvent) => {
        const t = e.target as Element | null;
        if (!t || !sec.contains(t)) return;
        if ((t as HTMLElement).isContentEditable) return;
        e.preventDefault();
        // null when the click lands on a layout container or the bare slide bg → deselect.
        onSelectRef.current(resolveSelectable(t, sec));
      };
      const onDbl = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (!t || t === sec || !sec.contains(t) || t.isContentEditable) return;
        if (!isTextEditable(t)) return;
        t.setAttribute("contenteditable", "true");
        t.focus();
        try { doc.execCommand("defaultParagraphSeparator", false, "br"); } catch { /* unsupported */ }
        const onPaste = (ev: ClipboardEvent) => {
          ev.preventDefault();
          const raw = ev.clipboardData?.getData("text/plain") ?? "";
          const lines = raw.replace(/\r\n?/g, "\n").replace(/\n+$/g, "").split("\n");
          lines.forEach((line, idx) => {
            if (idx > 0) doc.execCommand("insertLineBreak");
            if (line) doc.execCommand("insertText", false, line);
          });
        };
        const finish = () => {
          t.removeAttribute("contenteditable");
          t.removeEventListener("blur", finish);
          t.removeEventListener("paste", onPaste);
        };
        t.addEventListener("paste", onPaste);
        t.addEventListener("blur", finish);
      };

      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseleave", onLeave);
      doc.addEventListener("click", onClick);
      doc.addEventListener("dblclick", onDbl);
      onDocReady(doc);
    };

    iframe.addEventListener("load", wire);
    if (iframe.contentDocument?.readyState === "complete") wire();
    return () => {
      iframe.removeEventListener("load", wire);
      onDocReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDoc]);

  // Reposition the selection box whenever the controlled `selected` changes.
  useEffect(() => {
    place(selBoxRef.current, selected);
  }, [selected]);

  return (
    <div style={{ width: dispW, height: dispH, position: "relative" }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="slide editor"
        width={dispW}
        height={dispH}
        style={{
          border: 0,
          display: "block",
          width: `${dispW}px`,
          height: `${dispH}px`,
          background: theme.background,
        }}
      />
    </div>
  );
}

// Position an overlay box over a target element (in the iframe's own viewport coords),
// inflated ~2px so the border floats just OUTSIDE the content.
function place(box: HTMLElement | null, el: HTMLElement | null) {
  if (!box) return;
  if (!el) { box.style.display = "none"; return; }
  const r = el.getBoundingClientRect();
  box.style.display = "block";
  box.style.left = `${r.left - 2}px`;
  box.style.top = `${r.top - 2}px`;
  box.style.width = `${r.width + 4}px`;
  box.style.height = `${r.height + 4}px`;
}
