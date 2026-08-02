"use client";

// Retry overlay for PERMANENTLY failed gen-image boxes (studio editor).
//
// A box whose gpt-image generation was rejected (OpenAI safety system:
// sensitive or copyrighted prompt content) used to keep its loading shimmer
// forever - indistinguishable from "still generating". DeckView now tracks
// those genids (`failedImages`, fed by the `slide.image.failed` broadcast +
// the status poll's `imageFailed`); this component floats a card over each
// failed box: what happened, why it likely happened, and a one-click retry.
//
// Positioning follows the StylePill recipe: the boxes live INSIDE the editor
// iframe (a separate document), so a rAF loop reads each box's on-screen rect
// (post-stage-scale), offsets it by the iframe element's own rect, and writes
// the card's fixed left/top in the PARENT document - where app tokens, fonts
// and the dictionary all apply. Physical left/top is correct here (measured
// screen geometry, same exemption as StylePill / Moveable chrome).
//
// Retry reuses the EXACT StylePill regen contract: prompt from the box's
// committed `data-genimage`, aspect from `data-genaspect` (falling back to
// the same box-shape derivation), handed to DeckView's handleRegenImage.
// DeckView clears the genid from `failedImages` on click, so the card drops
// and the honest shimmer resumes until the retry resolves either way.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import type { GenImageAspect } from "@/lib/images/slide-images";

type RetryInput = {
  genid: string;
  slideId: string;
  prompt: string;
  aspect: GenImageAspect;
};

type GenImageFailedOverlayProps = {
  editorDoc: Document;
  failed: ReadonlySet<string>;
  slideId: string;
  onRetry: (input: RetryInput) => void;
};

function findBox(editorDoc: Document, genid: string): HTMLImageElement | null {
  // genids are SAFE_GENID-validated upstream; CSS.escape is belt-and-braces.
  return editorDoc.querySelector<HTMLImageElement>(
    `img[data-genid="${CSS.escape(genid)}"][data-genimage]`,
  );
}

export function GenImageFailedOverlay({
  editorDoc,
  failed,
  slideId,
  onRetry,
}: GenImageFailedOverlayProps) {
  const t = useDict().editor.imageFailed;
  const { dir } = useLocale();
  const genids = useMemo(() => Array.from(failed).sort(), [failed]);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  // rAF follow loop (StylePill's recipe, continuous): centre each card over
  // its box every frame so it tracks canvas fit/zoom, panel collapses and
  // Moveable drags without any bespoke listeners. A handful of
  // getBoundingClientRect calls per frame - negligible.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const frame = editorDoc.defaultView?.frameElement as HTMLElement | null;
      const fr = frame?.getBoundingClientRect();
      for (const genid of genids) {
        const el = cardRefs.current.get(genid);
        if (!el) continue;
        const img = fr ? findBox(editorDoc, genid) : null;
        // Box gone (slide swapped mid-frame) or already filled → no card.
        if (!fr || !img || img.getAttribute("src")) {
          el.style.display = "none";
          continue;
        }
        const r = img.getBoundingClientRect();
        el.style.display = "";
        el.style.left = `${fr.left + r.left + r.width / 2}px`;
        el.style.top = `${fr.top + r.top + r.height / 2}px`;
        el.style.maxWidth = `${Math.max(120, Math.min(340, r.width - 16))}px`;
        // Small on-screen box → icon + button only (the hint wouldn't fit).
        el.dataset.compact = r.width < 240 || r.height < 150 ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editorDoc, genids]);

  const handleRetry = useCallback(
    (genid: string) => {
      const img = findBox(editorDoc, genid);
      if (!img) return;
      const prompt = (img.getAttribute("data-genimage") ?? "").trim();
      if (!prompt) return;
      const declared = img.getAttribute("data-genaspect");
      let aspect: GenImageAspect;
      if (
        declared === "landscape" ||
        declared === "portrait" ||
        declared === "square"
      ) {
        aspect = declared;
      } else {
        // Same box-shape derivation as StylePill's handleRegenConfirm.
        const r = img.getBoundingClientRect();
        const ratio = r.height > 0 ? r.width / r.height : 1;
        aspect = ratio >= 1.15 ? "landscape" : ratio <= 0.87 ? "portrait" : "square";
      }
      onRetry({ genid, slideId, prompt, aspect });
    },
    [editorDoc, slideId, onRetry],
  );

  return (
    <>
      {genids.map((genid) => (
        <div
          key={genid}
          ref={(el) => {
            if (el) cardRefs.current.set(genid, el);
            else cardRefs.current.delete(genid);
          }}
          dir={dir}
          className="group surface-menu fixed z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-center text-foreground shadow-lg"
          // Hidden until the first rAF places it (no top-left flash); hairline
          // border so the card reads over any slide colour.
          style={{ display: "none", border: "1px solid var(--tq-border-hairline)" }}
        >
          <span
            className="material-symbols-outlined text-foreground/55"
            style={{ fontSize: 20 }}
            aria-hidden
          >
            broken_image
          </span>
          <p className="mt-0.5 text-[12px] font-medium">{t.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/55 group-data-[compact=1]:hidden">
            {t.hint}
          </p>
          <button
            type="button"
            onClick={() => handleRetry(genid)}
            className="btn-gradient-anim mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium text-foreground"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
              aria-hidden
            >
              refresh
            </span>
            {t.retry}
          </button>
        </div>
      ))}
    </>
  );
}
