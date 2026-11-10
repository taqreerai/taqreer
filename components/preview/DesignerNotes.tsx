"use client";

// The designer's notes (owner, 2026-11-10): before slide 1 the model thinks,
// often 40 s or more, and the canvas used to sit on a spinner. The summary of
// that thinking already streams in (the GenChat "thinking" entry), so it is
// typed out here on the canvas, letter by letter, with the deck's colours
// and font beside it, until the first slide starts building in its place.
//
// The feed carries only the summary's last ~600 characters, so each update
// is stitched onto what was already received (overlap match), and playback
// keeps an even pace a little behind it, like the live slide build. Text is
// written straight into the DOM each frame (no React render per letter).

import { useEffect, useRef } from "react";
import type { ThemeType } from "@/lib/schema/slide";

const MIN_RATE = 22; // letters/s while little is buffered
const MAX_RATE = 420;
const TARGET_LAG_S = 1.8;
const SHOW_CHARS = 700; // the tail kept in the DOM; older lines fade out above

// "**Planning the cover**" headings and other markdown marks read as noise.
function clean(text: string): string {
  return text.replace(/^…/, "").replace(/\*\*|__|`/g, "").replace(/\n{3,}/g, "\n\n");
}

// Append the new window onto what we have: find where it overlaps the tail.
function stitch(acc: string, win: string): string {
  if (!acc) return win;
  if (acc.endsWith(win) || acc.includes(win)) return acc;
  for (const probe of [80, 40, 20]) {
    if (win.length < probe) continue;
    const at = acc.lastIndexOf(win.slice(0, probe));
    if (at >= 0) {
      const overlap = acc.length - at;
      return overlap < win.length ? acc + win.slice(overlap) : acc;
    }
  }
  // No overlap (a long gap between updates): start a new paragraph.
  return `${acc}\n\n${win}`;
}

export function DesignerNotes({
  text,
  theme,
  label,
}: {
  // The live thinking summary window, or null before it starts.
  text: string | null;
  theme: ThemeType | null;
  // "Designer's notes" in the page language.
  label: string;
}) {
  const acc = useRef("");
  const shown = useRef(0);
  const outRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (text) acc.current = stitch(acc.current, clean(text));
  }, [text]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let rate = MIN_RATE;
    let painted = -1;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const ahead = acc.current.length - shown.current;
      const want = reduced ? MAX_RATE : Math.min(MAX_RATE, Math.max(MIN_RATE, ahead / TARGET_LAG_S));
      rate += (want - rate) * Math.min(1, dt / 0.5);
      if (ahead > 0) shown.current = Math.min(acc.current.length, shown.current + rate * dt);
      const n = Math.floor(shown.current);
      if (n !== painted && outRef.current) {
        painted = n;
        const start = Math.max(0, n - SHOW_CHARS);
        outRef.current.textContent = acc.current.slice(start, n);
      }
      caretRef.current?.classList.toggle("is-idle", ahead < 1);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const accent = theme?.palette[0] ?? "var(--tq-brand-blue)";
  return (
    <div className="designer-notes" style={{ ["--lb-accent" as string]: accent }}>
      {theme ? (
        <div className="designer-notes-head">
          <span className="flex gap-1.5">
            {theme.palette.slice(0, 6).map((c, i) => (
              <span key={c + i} className="live-build-swatch designer-notes-swatch" style={{ background: c, animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          <span className="designer-notes-font" style={{ fontFamily: `"${theme.font.name}", var(--font-sans, system-ui)` }}>
            Aa <small>{theme.font.name}</small>
          </span>
        </div>
      ) : null}
      <p className="designer-notes-label">{label}</p>
      <div className="designer-notes-body" dir="auto">
        <div>
          <span ref={outRef} />
          <span ref={caretRef} className="designer-notes-caret" aria-hidden />
        </div>
      </div>
    </div>
  );
}
