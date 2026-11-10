"use client";

// The live-build lab (see app/[lang]/lab/live-build). Streams a real deck's
// slides back to back like a generation would, in bursts with the odd
// thinking pause, and plays them through LiveSlideBuild: the deck setup
// (colours, font, title) first, then each slide built in place, a light
// sweep when it is done, and the slide flying into the strip below.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveSlideBuild } from "@/lib/deck/live-build/engine";
import { sanitizeSlideHtml } from "@/lib/export/sanitize";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import type { ThemeType } from "@/lib/schema/slide";

type Deck = {
  title: string;
  theme: ThemeType;
  direction: "rtl" | "ltr";
  language: "ar" | "en";
  slides: { id: string; html: string }[];
};
type Fixture = Record<"ar" | "en", Deck>;

const W = 1920;
const H = 1080;
const THUMB_W = 168;

// Opus writes a slide in ~30 s (about 7,000 characters of HTML): ~240 chars/s.
const SPEEDS = { opus: 240, haiku: 720 } as const;
type Speed = keyof typeof SPEEDS;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function styleEnd(html: string | undefined): number {
  if (!html) return 0;
  const end = html.indexOf("</style>");
  return end < 0 ? 0 : end + "</style>".length;
}

/** Streams every slide back to back, in bursts, like the model would. */
function fakeStream(
  slides: string[],
  charsPerSec: number,
  onChunk: (i: number, text: string, done: boolean) => void,
): () => void {
  let cancelled = false;
  let timer = 0;
  let i = 0;
  let at = 0;
  const tick = () => {
    if (cancelled || i >= slides.length) return;
    const html = slides[i];
    // A thinking pause now and then, otherwise a burst every 150-650 ms.
    const pause = Math.random() < 0.06 ? rand(1500, 4000) : 0;
    const wait = rand(150, 650);
    timer = window.setTimeout(() => {
      at = Math.min(html.length, at + Math.round(charsPerSec * (wait / 1000) * rand(0.5, 1.6)));
      const done = at >= html.length;
      onChunk(i, html.slice(0, at), done);
      if (done) {
        i += 1;
        at = styleEnd(slides[i]);
      }
      tick();
    }, wait + pause);
  };
  // Each stored slide carries the whole deck style sheet, which a real run
  // streams once before slide 1 (the setup card): it arrives at once here.
  at = styleEnd(slides[0]);
  timer = window.setTimeout(tick, 3200 * (SPEEDS.opus / charsPerSec));
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

export function LiveBuildLab() {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [speed, setSpeed] = useState<Speed>("opus");
  const [run, setRun] = useState(0);

  useEffect(() => {
    fetch("/api/lab/live-build-fixture")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setFixture)
      .catch((e) => setError(String(e)));
  }, []);

  const deck = fixture?.[lang] ?? null;

  return (
    <main className="min-h-screen bg-[var(--tq-bg)] px-4 py-6 text-[var(--tq-text-primary)]">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="me-auto text-lg font-semibold">Live build lab</h1>
          {(["ar", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => { setLang(l); setRun((n) => n + 1); }}
              className={`rounded-full border px-3 py-1 text-sm ${lang === l ? "border-[var(--tq-brand-blue)]" : "border-[var(--tq-border-hairline)]"}`}>
              {l === "ar" ? "Arabic deck" : "English deck"}
            </button>
          ))}
          {(Object.keys(SPEEDS) as Speed[]).map((s) => (
            <button key={s} type="button" onClick={() => { setSpeed(s); setRun((n) => n + 1); }}
              className={`rounded-full border px-3 py-1 text-sm ${speed === s ? "border-[var(--tq-brand-blue)]" : "border-[var(--tq-border-hairline)]"}`}>
              {s === "opus" ? "Opus pace" : "Haiku pace"}
            </button>
          ))}
          <button type="button" onClick={() => setRun((n) => n + 1)} className="btn-unlock">Replay</button>
        </div>
        {error ? <p className="text-red-400">Fixture: {error}</p> : null}
        {deck ? <Player key={`${lang}-${speed}-${run}`} deck={deck} charsPerSec={SPEEDS[speed]} /> : null}
      </div>
    </main>
  );
}

function useFontLink(url: string | undefined) {
  useEffect(() => {
    if (!url) return;
    const id = `lab-font-${url}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
  }, [url]);
}

function Player({ deck, charsPerSec }: { deck: Deck; charsPerSec: number }) {
  useFontLink(deck.theme.font.url ?? undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(0.5);
  const [phase, setPhase] = useState<"setup" | "build" | "done">("setup");
  const [current, setCurrent] = useState(0);
  const [finished, setFinished] = useState<number[]>([]);
  const [sweep, setSweep] = useState(0);
  const [streamAt, setStreamAt] = useState(0);
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const texts = useRef<string[]>([]);
  const dones = useRef<boolean[]>([]);
  const engine = useRef<LiveSlideBuild | null>(null);
  const currentRef = useRef(0);
  const finishRef = useRef<(i: number) => void>(() => {});

  const cssVars = useMemo(() => themeToCssVars(deck.theme) as React.CSSProperties, [deck.theme]);
  const accent = deck.theme.palette[0] ?? "#2563eb";

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const k = el.clientWidth / W;
      scaleRef.current = k;
      setScale(k);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startSlide = useCallback(
    (i: number) => {
      const host = hostRef.current;
      if (!host) return;
      currentRef.current = i;
      setCurrent(i);
      engine.current?.stop();
      const caret = caretRef.current;
      const build = new LiveSlideBuild({
        host,
        scale: () => scaleRef.current,
        reducedMotion,
        onCaret: (c) => {
          if (!caret) return;
          if (!c) {
            caret.style.opacity = "0";
            return;
          }
          caret.style.opacity = "1";
          caret.style.transform = `translate(${c.x - 1.5}px, ${c.y}px)`;
          caret.style.height = `${Math.max(8, c.h)}px`;
          caret.classList.toggle("is-idle", c.idle);
        },
        onComplete: () => finishRef.current(i),
      });
      engine.current = build;
      build.push(texts.current[i] ?? "", dones.current[i] ?? false);
    },
    [reducedMotion],
  );

  const finishSlide = useCallback(
    (i: number) => {
      setSweep((n) => n + 1);
      window.setTimeout(() => {
        if (!reducedMotion) flyToStrip(hostRef.current, stageRef.current, stripRef.current, i);
        setFinished((f) => [...f, i]);
        if (i + 1 < deck.slides.length) startSlide(i + 1);
        else {
          hostRef.current?.replaceChildren();
          setPhase("done");
        }
      }, reducedMotion ? 150 : 720);
    },
    [deck.slides.length, startSlide, reducedMotion],
  );
  useEffect(() => {
    finishRef.current = finishSlide;
  }, [finishSlide]);

  // The stream runs on its own clock, like the model: playback follows it.
  useEffect(() => {
    texts.current = [];
    dones.current = [];
    const stop = fakeStream(
      deck.slides.map((s) => s.html),
      charsPerSec,
      (i, text, done) => {
        texts.current[i] = text;
        dones.current[i] = done;
        setStreamAt(i);
        if (i === currentRef.current) engine.current?.push(text, done);
      },
    );
    // The setup card covers the style sheet's stream, then slide 1 starts.
    const t = window.setTimeout(() => {
      setPhase("build");
      startSlide(0);
    }, 3200 * (SPEEDS.opus / charsPerSec));
    return () => {
      stop();
      window.clearTimeout(t);
      engine.current?.stop();
    };
  }, [deck, charsPerSec, startSlide]);

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stageRef}
        className="relative w-full overflow-hidden rounded-xl border border-[var(--tq-border-hairline)]"
        style={{ aspectRatio: `${W} / ${H}`, background: deck.theme.background }}
      >
        <div
          dir={deck.direction}
          lang={deck.language}
          style={{
            ...cssVars,
            width: W,
            height: H,
            position: "absolute",
            left: 0,
            top: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            color: deck.theme.text,
            fontFamily: "var(--font-body)",
          }}
        >
          <div ref={hostRef} style={{ width: W, height: H, position: "relative" }} />
        </div>
        {phase === "setup" ? <SetupCard deck={deck} speed={charsPerSec} /> : null}
        <div ref={caretRef} className="live-build-caret" style={{ ["--lb-accent" as string]: accent, opacity: 0 }} />
        {sweep > 0 ? <div key={sweep} className="live-build-sweep" /> : null}
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--tq-text-secondary,inherit)] opacity-70">
        <span>
          {phase === "setup" ? "Setting up the design" : phase === "done" ? "Deck complete" : `Building slide ${current + 1} of ${deck.slides.length}`}
        </span>
        <span>Stream is writing slide {Math.min(streamAt + 1, deck.slides.length)}</span>
      </div>

      <div ref={stripRef} dir="ltr" className="flex gap-[10px] overflow-x-auto pb-2">
        {deck.slides.map((s, i) => (
          <Thumb key={i} deck={deck} html={s.html} shown={finished.includes(i)} building={phase === "build" && current === i} />
        ))}
      </div>
    </div>
  );
}

// A copy of the finished slide shrinks from the stage into its strip slot.
function flyToStrip(host: HTMLElement | null, stage: HTMLElement | null, strip: HTMLElement | null, i: number) {
  if (!host || !stage || !strip) return;
  const from = stage.getBoundingClientRect();
  const slotLeft = strip.getBoundingClientRect().left + i * (THUMB_W + 10) - strip.scrollLeft;
  const slotTop = strip.getBoundingClientRect().top;
  const k = THUMB_W / from.width;
  const ghost = host.parentElement!.cloneNode(true) as HTMLElement;
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
    borderRadius: "12px",
    overflow: "hidden",
  });
  document.body.appendChild(ghost);
  ghost
    .animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${slotLeft - from.left}px, ${slotTop - from.top}px) scale(${k})`, opacity: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(.3,.7,.2,1)" },
    )
    .finished.finally(() => ghost.remove());
};


function Thumb({ deck, html, shown, building }: { deck: Deck; html: string; shown: boolean; building: boolean }) {
  const [safe, setSafe] = useState("");
  useEffect(() => {
    if (!shown) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSafe(sanitizeSlideHtml(html));
  }, [shown, html]);
  const k = THUMB_W / W;
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border ${building ? "border-[var(--tq-brand-blue)]" : "border-[var(--tq-border-hairline)]"}`}
      style={{ width: THUMB_W, height: THUMB_W * (H / W), background: shown ? deck.theme.background : "transparent" }}
    >
      {shown ? (
        <div
          dir={deck.direction}
          lang={deck.language}
          className="live-build-thumb-in"
          style={{
            ...(themeToCssVars(deck.theme) as React.CSSProperties),
            width: W,
            height: H,
            transform: `scale(${k})`,
            transformOrigin: "top left",
            color: deck.theme.text,
            fontFamily: "var(--font-body)",
          }}
          dangerouslySetInnerHTML={{ __html: safe }}
        />
      ) : building ? (
        <div className="live-build-thumb-pending" />
      ) : null}
    </div>
  );
}

// Before slide 1 the model writes the deck's style: show its colours dropping
// in, the font, and the title typing, so the first seconds are not blank.
function SetupCard({ deck, speed }: { deck: Deck; speed: number }) {
  const [typed, setTyped] = useState(0);
  const title = deck.title;
  useEffect(() => {
    const per = (2200 * (SPEEDS.opus / speed)) / Math.max(1, title.length);
    const id = window.setInterval(() => setTyped((n) => (n >= title.length ? n : n + 1)), per);
    return () => window.clearInterval(id);
  }, [title, speed]);
  return (
    <div className="live-build-setup" dir={deck.direction} style={{ background: deck.theme.background, color: deck.theme.text }}>
      <div className="flex gap-3">
        {deck.theme.palette.map((c, i) => (
          <span key={c + i} className="live-build-swatch" style={{ background: c, animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
      <span className="live-build-specimen" style={{ fontFamily: `"${deck.theme.font.name}"` }}>
        {deck.language === "ar" ? "أبجد" : "Aa"}
        <small>{deck.theme.font.name}</small>
      </span>
      <p className="live-build-title" style={{ fontFamily: `"${deck.theme.font.name}"` }}>
        {title.slice(0, typed)}
        <span className="live-build-title-caret" style={{ background: deck.theme.palette[0] }} />
      </p>
    </div>
  );
}
