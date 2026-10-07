"use client";

// "Upload yours" over enhance photo slots (studio editor, 2026-10-06).
//
// Enhance never carries the user's original pictures into the redesign (the
// source-asset extraction was removed 2026-05-25), so deck-generate turns a
// source photo / map / screenshot into a placeholder <div data-photoslot>
// describing it. This floats a small card over each unfilled slot with one
// button: pick the original picture, and DeckView puts it in the slot.
//
// Same positioning recipe as GenImageFailedOverlay: the slots live inside the
// editor iframe, so a rAF loop reads each slot's on-screen rect, offsets it by
// the iframe's own rect, and writes the card's fixed left/top in the parent
// document (measured screen geometry, the same exemption as StylePill).
// Slots carry no id, so cards are keyed by their order on the slide.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export const PHOTO_SLOT_SELECTOR = "[data-photoslot]";

type PhotoSlotOverlayProps = {
  editorDoc: Document;
  // Puts the uploaded picture into the index-th slot of the slide and saves.
  onUpload: (index: number, url: string) => void;
};

export function PhotoSlotOverlay({ editorDoc, onUpload }: PhotoSlotOverlayProps) {
  const t = useDict().editor.photoSlot;
  const { dir } = useLocale();
  const [count, setCount] = useState(0);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());

  // rAF follow loop: count the slots (a slide swap or an upload changes it)
  // and centre each card over its slot every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const frame = editorDoc.defaultView?.frameElement as HTMLElement | null;
      const fr = frame?.getBoundingClientRect();
      const slots = Array.from(editorDoc.querySelectorAll<HTMLElement>(PHOTO_SLOT_SELECTOR));
      setCount((c) => (c === slots.length ? c : slots.length));
      slots.forEach((slot, i) => {
        const el = cardRefs.current.get(i);
        if (!el) return;
        if (!fr) {
          el.style.display = "none";
          return;
        }
        const r = slot.getBoundingClientRect();
        el.style.display = "";
        el.style.left = `${fr.left + r.left + r.width / 2}px`;
        el.style.top = `${fr.top + r.top + r.height / 2}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editorDoc]);

  // One hidden input shared by every card; uploadFor holds the slot being
  // filled while its upload runs.
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingIndex = useRef<number | null>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      const index = pendingIndex.current;
      if (!file || index == null) return;
      setUploadFor(index);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/storage/upload-image", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as { url?: string } | null;
        if (!res.ok || !data?.url) throw new Error("upload failed");
        onUpload(index, data.url);
      } catch (err) {
        console.error("Photo slot upload failed:", err);
      } finally {
        setUploadFor(null);
      }
    },
    [onUpload],
  );

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el) cardRefs.current.set(i, el);
            else cardRefs.current.delete(i);
          }}
          dir={dir}
          className="fixed z-10 -translate-x-1/2"
          // Hidden until the first rAF places it (no top-left flash). Sits a
          // little below the slot's centre so the slot's own label stays
          // readable above it.
          style={{ display: "none", marginTop: 18 }}
        >
          <button
            type="button"
            disabled={uploadFor !== null}
            onClick={() => {
              pendingIndex.current = i;
              fileRef.current?.click();
            }}
            title={t.hint}
            className="btn-gradient-anim inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium text-foreground shadow-lg disabled:opacity-60"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
              add_photo_alternate
            </span>
            {uploadFor === i ? t.uploading : t.upload}
          </button>
        </div>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={onPickFile}
      />
    </>
  );
}
