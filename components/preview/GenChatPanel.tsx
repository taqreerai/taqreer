"use client";

// GenChat - the backend-transparency feed shown in the Layers rail while a
// deck GENERATES and BAKES (owner spec 2026-07-10: "the user sees what is
// happening on the backend and not wait indefinitely"). It renders the same
// floating card as LayersPanel, sitting one z above it; DeckView fades it
// out when the bake lands, revealing the layers beneath.
//
// Entry shapes (lib/schema/slide GenChatEntry):
//   user     - what we asked the model (the brief digest / review ask)
//   thinking - the model's LIVE summarized reasoning (the API's thinking
//              display:"summarized" stream); ONE entry per call, its text
//              grows in place, so the row keeps a spinner while it updates
//   event    - localizable milestones (slide closed / revised / review
//              started / review done / baked), rendered through the dict
//              so the feed reads right in both languages.

import { useEffect, useRef } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import {
  SLIDE_NAV_WIDTH,
  RAIL_TOP,
  RAIL_BOTTOM,
} from "@/components/preview/SlideNavSidebar";
import type { GenChatEntry } from "@/lib/schema/slide";

export function GenChatPanel({
  entries,
  language,
  collapsed = false,
}: {
  entries: GenChatEntry[];
  language: "ar" | "en";
  collapsed?: boolean;
}) {
  const dict = useDict();
  const t = dict.editor.genchat;
  const dir = language === "en" ? "ltr" : "rtl";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the tail: new entries AND in-place thinking growth both extend
  // the scroll height, so key the effect on the last entry's text length
  // in addition to the count.
  const last = entries[entries.length - 1];
  const tailKey = `${entries.length}:${last?.text?.length ?? 0}:${last?.kind ?? ""}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  const eventLabel = (e: GenChatEntry): string => {
    switch (e.kind) {
      case "slide":
        return t.slideDone.replace("{n}", String(e.n ?? ""));
      case "revise":
      case "reviseSlide":
        return t.revised.replace("{n}", String(e.n ?? ""));
      case "reviewDone":
        return (e.n ?? 0) > 0
          ? t.reviewImproved.replace("{n}", String(e.n))
          : t.reviewClean;
      case "baked":
        return t.baked;
      default:
        return "";
    }
  };

  // The live row: the trailing thinking entry keeps a spinner while the
  // deck is still working; a terminal "baked" event ends the feed (the
  // panel is about to fade out anyway).
  const isDone = last?.kind === "baked";

  return (
    <aside
      inert={collapsed}
      aria-hidden={collapsed || undefined}
      dir={dir}
      aria-label={t.title}
      className="fixed z-[31] flex flex-col overflow-hidden rounded-3xl border p-3"
      style={{
        left: 16,
        top: RAIL_TOP,
        bottom: RAIL_BOTTOM,
        transform: collapsed ? "translateX(calc(-100% - 24px))" : undefined,
        width: SLIDE_NAV_WIDTH,
        background: "var(--tq-surface)",
        borderColor: "var(--tq-border-hairline)",
        pointerEvents: collapsed ? "none" : undefined,
        transition: "transform 300ms ease",
      }}
    >
      <header className="border-b border-foreground/[0.08] px-1 pb-3 pt-1">
        <h2 className="text-sm font-semibold text-foreground">{t.title}</h2>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-1 py-3"
      >
        {entries.map((e, i) => {
          if (e.role === "user") {
            // The REVIEW ask: localized copy + the exact screenshots sent
            // to the reviewer (kind "review" carries them as tiny thumbs).
            return (
              <div key={i} className="space-y-1.5">
                <div
                  dir="auto"
                  className="rounded-2xl bg-foreground/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/80"
                >
                  {e.kind === "review" ? t.reviewAsk : e.text}
                  {e.thumbs && e.thumbs.length > 0 ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {e.thumbs.map((src, ti) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={ti}
                          src={src}
                          alt=""
                          className="h-12 w-auto rounded-md border border-foreground/10"
                        />
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          }
          if (e.role === "thinking") {
            const live = i === entries.length - 1 && !isDone;
            return (
              <div key={i} className="space-y-1">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
                  {live ? (
                    <span className="spinner h-2.5 w-2.5 shrink-0 rounded-full border border-foreground/20 border-t-foreground/70" />
                  ) : null}
                  {t.thinking}
                </p>
                {/* Reasoning summaries arrive in the model's own voice
                    (usually English) - dir=auto lets each render naturally
                    under either UI direction. */}
                <p
                  dir="auto"
                  className="px-1 text-[11px] italic leading-relaxed text-foreground/55"
                >
                  {e.text}
                </p>
              </div>
            );
          }
          const label = eventLabel(e);
          if (!label) return null;
          return (
            <p
              key={i}
              className="flex items-center gap-2 px-1 text-[12px] font-medium text-foreground/75"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    e.kind === "baked"
                      ? "var(--tq-status-ok-dot)"
                      : "var(--tq-status-warn-dot)",
                }}
              />
              {label}
            </p>
          );
        })}
        {/* Nothing yet (the very first seconds): the working pulse alone. */}
        {entries.length === 0 ? (
          <p className="flex items-center gap-2 px-1 py-2 text-[12px] text-foreground/45">
            <span className="spinner h-3 w-3 shrink-0 rounded-full border border-foreground/20 border-t-foreground/60" />
            {t.starting}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
