"use client";

// The studio canvas while a deck generates (2026-11-10): the slide the model
// is writing, built in place shape by shape and letter by letter
// (lib/deck/live-build/engine.ts), a light sweep when it is done, then a copy
// flies into its thumbnail and the next slide starts.
//
// Fed by the generation progress poll: `live` is the slide still being
// written, `done` the last one the model closed (same live form, so playback
// can finish it), `css` the deck stylesheet both render with. A visitor who
// joins mid-generation starts at the slide being written. When playback has
// nothing to show (before the first slide, or after the last), `fallback`
// renders instead. Mobile: the engine runs its light mode on touch screens
// and drops to it by itself on any device whose frames run slow.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LiveSlideBuild } from "@/lib/deck/live-build/engine";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import type { ThemeType } from "@/lib/schema/slide";

export type LiveFeed = { index: number; html: string };

const SWEEP_MS = 650;

/** The live text with the deck stylesheet placed as the section's first child. */
function withStyle(html: string, css: string): string {
  const open = /^<section\b[^>]*>/i.exec(html);
  if (!open) return html;
  return `${open[0]}<style>${css}</style>${html.slice(open[0].length)}`;
}

export function LiveSlideStage({
  live,
  done,
  css,
  finishedCount,
  theme,
  direction,
  language,
  width,
  height,
  scale,
  onShown,
  fallback,
}: {
  live: LiveFeed | null;
  done: LiveFeed | null;
  css: string | null;
  // Slides the model has closed so far (the streaming preview's length).
  finishedCount: number;
  theme: ThemeType;
  direction: "rtl" | "ltr";
  language: "ar" | "en";
  width: number;
  height: number;
  scale: number;
  // A slide has finished playing (the nav may show its thumbnail now).
  onShown: (index: number) => void;
  fallback: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const engine = useRef<LiveSlideBuild | null>(null);
  const cssAtStart = useRef<string | null>(null);
  const scaleRef = useRef(scale);
  const onShownRef = useRef(onShown);
  const [playing, setPlaying] = useState<number | null>(null);
  const [sweep, setSweep] = useState(0);
  // The slide that has finished playing and waits for the next to start.
  const [resting, setResting] = useState(false);

  useEffect(() => {
    scaleRef.current = scale;
    onShownRef.current = onShown;
  }, [scale, onShown]);

  const motion = useMemo(() => {
    if (typeof window === "undefined") return { reduced: false, lite: false };
    return {
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      lite: window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768,
    };
  }, []);

  // Which slide to play: the one being written when nothing is playing yet;
  // the next one once the current has played out and rested.
  const more =
    playing !== null &&
    ((live !== null && live.index > playing) || (done !== null && done.index > playing) || finishedCount > playing + 1);
  const next = playing === null ? (live && css ? live.index : null) : resting && more ? playing + 1 : null;
  useEffect(() => {
    if (next === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaying(next);
    setResting(false);
  }, [next]);

  // One engine per slide.
  useEffect(() => {
    const host = hostRef.current;
    if (playing === null || !host) return;
    cssAtStart.current = css;
    const caret = caretRef.current;
    const build = new LiveSlideBuild({
      host,
      scale: () => scaleRef.current,
      reducedMotion: motion.reduced,
      lite: motion.lite,
      onCaret: (c) => {
        if (!caret) return;
        if (!c) {
          caret.style.opacity = "0";
          return;
        }
        caret.style.opacity = "1";
        caret.style.transform = `translate(${c.x - 1.5}px, ${c.y}px)`;
        caret.style.height = `${Math.max(6, c.h)}px`;
        caret.classList.toggle("is-idle", c.idle);
      },
      onComplete: () => {
        onShownRef.current(playing);
        if (motion.reduced) {
          setResting(true);
          return;
        }
        setSweep((n) => n + 1);
        window.setTimeout(() => {
          flyToThumb(stageRef.current, playing);
          setResting(true);
        }, SWEEP_MS);
      },
    });
    engine.current = build;
    return () => {
      build.stop();
      if (engine.current === build) engine.current = null;
    };
    // css is read once per slide (cssAtStart); motion is fixed per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Feed the playing slide: its live text, its closed text, or (when a poll
  // gap skipped its end) whatever it has, marked complete.
  useEffect(() => {
    const build = engine.current;
    const style = cssAtStart.current ?? css;
    if (!build || playing === null || !style || build.finished) return;
    if (done?.index === playing) build.push(withStyle(done.html, style), true);
    else if (live?.index === playing) build.push(withStyle(live.html, style), false);
    else if ((live && live.index > playing) || finishedCount > playing) {
      // Its text never reached this tab (joined late, or a long gap): skip it.
      if (!build.hasContent) {
        build.stop();
        onShownRef.current(playing);
        setResting(true);
        return;
      }
      build.finishNow();
    }
  }, [live, done, css, playing, finishedCount]);

  const cssVars = useMemo(() => themeToCssVars(theme) as CSSProperties, [theme]);
  const accent = theme.palette[0] ?? "var(--tq-brand-blue)";
  const dispW = Math.ceil(width * scale);
  const dispH = Math.ceil(height * scale);
  const fillScale = Math.max(dispW / width, dispH / height);

  // The playing slide stays on screen while it rests between slides.
  if (playing === null) return <>{fallback}</>;
  return (
    <div ref={stageRef} className="relative" style={{ width: dispW, height: dispH }}>
      <div
        dir={direction}
        lang={language}
        style={{
          ...cssVars,
          width,
          height,
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${fillScale})`,
          transformOrigin: "top left",
          color: theme.text,
          fontFamily: "var(--font-body)",
        }}
      >
        <div ref={hostRef} style={{ width, height, position: "relative" }} />
      </div>
      <div ref={caretRef} className="live-build-caret" style={{ ["--lb-accent" as string]: accent, opacity: 0 }} aria-hidden />
      {sweep > 0 ? <div key={sweep} className="live-build-sweep" aria-hidden /> : null}
    </div>
  );
}

// A copy of the finished slide shrinks into its thumbnail, when that
// thumbnail is on screen (the nav is collapsed or off-screen on phones).
function flyToThumb(stage: HTMLElement | null, index: number) {
  if (!stage) return;
  const thumb = document.querySelector<HTMLElement>(`[data-nav-index="${index}"]`);
  if (!thumb) return;
  const to = thumb.getBoundingClientRect();
  const from = stage.getBoundingClientRect();
  const visible = to.width > 0 && to.bottom > 0 && to.top < window.innerHeight && to.right > 0 && to.left < window.innerWidth;
  if (!visible || from.width === 0) return;
  const ghost = stage.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
    transformOrigin: "top left",
    overflow: "hidden",
    borderRadius: "10px",
  });
  ghost.querySelectorAll(".live-build-caret, .live-build-sweep").forEach((n) => n.remove());
  document.body.appendChild(ghost);
  const k = to.width / from.width;
  ghost
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${k})`, opacity: 0.6 },
      ],
      { duration: 600, easing: "cubic-bezier(.3,.7,.2,1)" },
    )
    .finished.catch(() => undefined)
    .finally(() => ghost.remove());
}
