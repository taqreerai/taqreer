"use client";

// ─── Create-flow feature animation ────────────────────────────────
//
// Storyboard (plays once on hover, resets on hover-out):
//
//   1. Rest state: input field (right) + drop zone (left), side-by-
//      side. No dashed chrome.
//   2. PARALLEL:
//        • Arabic types into the input (caret follows the leading
//          edge of the text leftward).
//        • A LARGE file (48 × 60, same scale as the final slides)
//          enters from the top-right corner of the card and travels
//          diagonally to the drop zone, SHRINKING as it goes.
//        • The cursor rides the file's BOTTOM-RIGHT corner so it
//          stays visible throughout the drag.
//   3. Drop: file + arrow hint fade out → violet check tick draws
//      in. Cursor hides instantly.
//   4. Inputs shift up; Generate ("إنشاء") button slides up from
//      below (white label, violet pill). Cursor RE-ENTERS the
//      card from the bottom edge and rises to land ON TOP of the
//      button (rendered after the button in DOM order so it's
//      visibly above it).
//   5. Click — pill squashes, violet ripple expands. Scene fades up.
//   6. Loading line fills from the right (no track stroke, just the
//      violet bar growing leftward).
//   7. Three smaller, distinct slides appear in a centered 1 × 3
//      row (text-heavy / chart / image+caption).

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  animate as animateValue,
  motion,
  useAnimate,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { useTrackedTweens } from "@/hooks/useTrackedTweens";

const TYPED_TEXT = "اكتب فكرتك";

// Easing curve: "slow → fast → slow" (classic ease-in-out). User
// direction 2026-05-28 — the prior fast-start / slow-end profile
// felt like the cursor was already mid-flight when the drag began.
// This curve eases in (gentle pickup), accelerates through the
// middle, then settles softly on the target. Applied to every
// cursor + file movement so the whole sequence reads as one hand.
const HUMAN_EASE = [0.65, 0, 0.35, 1] as const;

// File is the same size as the final slides → 48 × 60. Drag scale
// reduces it to a thumbnail that fits the 40-wide drop zone.
const FILE_W = 48;
const FILE_H = 60;
const FILE_DRAG_SCALE = 0.45;

// Drop zone geometry — file + cursor land on the centre of this box.
// Rect: x=16, y=84, w=40, h=32 → centre (36, 100).
const DROP_CENTER_X = 36;
const DROP_CENTER_Y = 100;

// Drag-time keyframes for the file's motion.g (top-left x,y). End
// position is computed so the file's scaled centre lands exactly on
// the drop-zone centre.
//
// Start position is fully OUTSIDE the 200×200 viewBox (top-right
// corner, just past the right edge) so the file enters the card
// through the soft edge mask — user direction 2026-05-28: "bring
// the file from outside the card so we see the mask effect".
const FILE_START_X = 200;  // file's left edge at the viewBox right edge → fully outside
const FILE_START_Y = -40;  // file fully above the viewBox top edge
const FILE_END_X = DROP_CENTER_X - (FILE_W * FILE_DRAG_SCALE) / 2; // 25.2
const FILE_END_Y = DROP_CENTER_Y - (FILE_H * FILE_DRAG_SCALE) / 2; // 86.5

// Cursor positions for the click phase. With the visual-centre
// anchor (see cursor path below), translate(x, y) places the
// cursor's body centre at (x, y) — so to click the button we
// translate to the button's geometric centre (100, 140).
//
// NOTE: There is no separate cursor position for the DRAG phase —
// the drag cursor is nested inside the file's motion group at the
// file's local centre (24, 30) and uses a 1/fileScale counter-scale
// so it follows the file exactly with no chance of desync (user
// direction 2026-05-28: "lock their both animations").
const CURSOR_REENTER_X = 100;
const CURSOR_REENTER_Y = 215; // off-screen below the viewBox (visual centre at y=215 → body spans 209-221)
const CURSOR_CLICK_Y = 140;   // body centred on button (x stays at CURSOR_REENTER_X)

// Cursor path: visual-centre-anchored (local (0,0) sits at the
// cursor's bounding-box centre, tip at (-4.5, -6)). Reused for both
// the drag-cursor (inside .drag-file) and the click-cursor.
const CURSOR_PATH =
  "M -4.5 -6 L -4.5 5 L -1.5 2 L 0.5 6 L 2.5 5 L 0.5 1 L 4.5 1 Z";

export type CreateFlowAnimationHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const CreateFlowAnimation = forwardRef<CreateFlowAnimationHandle>(
  function CreateFlowAnimation(_, ref) {
    const [scope, animate] = useAnimate();
    const [typedCount, setTypedCount] = useState(0);
    const typingControlsRef = useRef<{
      stop: () => void;
      finished: Promise<void>;
    } | null>(null);
    const runIdRef = useRef(0);
    // In-flight tween controls (motion-value drag tweens + un-awaited
    // delayed selector reveals) are tracked so reset() can cancel them
    // before re-parking — otherwise a still-running tween overwrites
    // the reset and jumps the scene forward.
    const { track, cancelAll } = useTrackedTweens();

    // File's translate + scale are SINGLE SOURCE OF TRUTH motion
    // values. The drag-cursor lives INSIDE the file's motion.g at
    // the file's local centre (24, 30), with a 1/scale counter-scale
    // that keeps its visual size constant. By construction the
    // cursor cannot drift off-centre — there are no parallel
    // animations to desync. User direction 2026-05-28: "lock their
    // both animations".
    const fileX = useMotionValue(FILE_START_X);
    const fileY = useMotionValue(FILE_START_Y);
    const fileScale = useMotionValue(1);
    const cursorCounterScale = useTransform(fileScale, (s) => 1 / s);

    const reset = useCallback(() => {
      typingControlsRef.current?.stop();
      // Stop any in-flight tweens before re-parking — otherwise a
      // still-running drag/reveal tween overwrites the `.set()` calls
      // and selector resets below.
      cancelAll();
      setTypedCount(0);
      // File transform — set motion values directly (no selector
      // animate, since the file element binds these via style).
      fileX.set(FILE_START_X);
      fileY.set(FILE_START_Y);
      fileScale.set(1);
      animate(".scene-inputs", { y: 0, opacity: 1 }, { duration: 0 });
      animate(".drag-file", { opacity: 0 }, { duration: 0 });
      animate(".drop-arrow", { opacity: 0.4 }, { duration: 0 });
      animate(".drop-zone-active", { opacity: 0 }, { duration: 0 });
      animate(".drop-check", { pathLength: 0, opacity: 0 }, { duration: 0 });
      // Click-cursor parked off-screen below the viewBox, invisible.
      animate(
        ".click-cursor",
        { x: CURSOR_REENTER_X, y: CURSOR_REENTER_Y, opacity: 0 },
        { duration: 0 },
      );
      animate(".gen-button", { y: 70, opacity: 0 }, { duration: 0 });
      animate(".btn-ripple", { scale: 0.4, opacity: 0 }, { duration: 0 });
      // Loader fill parked at the right edge (width 0, x at the end).
      animate(
        ".loader-fill",
        { width: 0, x: 160, opacity: 0 },
        { duration: 0 },
      );
      animate(
        ".final-slide",
        { opacity: 0, y: 18, scale: 0.9 },
        { duration: 0 },
      );
    }, [animate, fileX, fileY, fileScale, cancelAll]);

    const start = useCallback(async () => {
      runIdRef.current += 1;
      const myRun = runIdRef.current;
      reset();

      // ── PHASE 1+2: typing + drag-drop ───────────────────────
      typingControlsRef.current = animateValue(0, TYPED_TEXT.length, {
        duration: TYPED_TEXT.length * 0.07,
        ease: "linear",
        onUpdate: (v) => setTypedCount(Math.round(v)),
      });

      // Drag phase. Two parts:
      //   (a) File fades in at its start position (0.2s).
      //   (b) File translates + scales toward the drop zone (1.2s).
      // The drag-cursor is NESTED inside the file's motion.g at the
      // file's local centre (24, 30) with a counter-scale, so it
      // follows the file's transform automatically — no parallel
      // animation, no chance of desync.
      animate(".drag-file", { opacity: 1 }, { duration: 0.2 });
      await new Promise((r) => setTimeout(r, 200));
      if (runIdRef.current !== myRun) return;

      const DRAG_DURATION = 1.2;
      const dragXAnim = track(
        animateValue(fileX, FILE_END_X, {
          duration: DRAG_DURATION,
          ease: HUMAN_EASE,
        }),
      );
      track(
        animateValue(fileY, FILE_END_Y, {
          duration: DRAG_DURATION,
          ease: HUMAN_EASE,
        }),
      );
      track(
        animateValue(fileScale, FILE_DRAG_SCALE, {
          duration: DRAG_DURATION,
          ease: HUMAN_EASE,
        }),
      );
      await dragXAnim.finished;
      if (runIdRef.current !== myRun) return;

      // Drop: file (with nested cursor) fades out; arrow fades;
      // dashed border flips to violet; check draws in.
      animate(".drag-file", { opacity: 0 }, { duration: 0.25 });
      animate(".drop-arrow", { opacity: 0 }, { duration: 0.25 });
      animate(
        ".drop-zone-active",
        { opacity: 1 },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".drop-check",
        { pathLength: 1, opacity: 1 },
        { duration: 0.35, ease: "easeOut", delay: 0.1 },
      );

      await typingControlsRef.current.finished;
      if (runIdRef.current !== myRun) return;
      await new Promise((r) => setTimeout(r, 280));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 3: shift up + reveal Generate button ──────────
      animate(
        ".scene-inputs",
        { y: -22 },
        { duration: 0.55, ease: HUMAN_EASE },
      );
      await animate(
        ".gen-button",
        { y: 0, opacity: 1 },
        { duration: 0.6, ease: HUMAN_EASE, delay: 0.15 },
      );
      if (runIdRef.current !== myRun) return;
      await new Promise((r) => setTimeout(r, 200));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 4a: click-cursor re-enters from BELOW + click ─
      // Park the cursor below the viewBox first, then animate it
      // up to the button. (Separate element from the drag-cursor
      // that lived inside the file's motion.g.)
      animate(
        ".click-cursor",
        { x: CURSOR_REENTER_X, y: CURSOR_REENTER_Y, opacity: 0 },
        { duration: 0 },
      );
      await animate(
        ".click-cursor",
        { y: CURSOR_CLICK_Y, opacity: 1 },
        { duration: 0.65, ease: HUMAN_EASE },
      );
      if (runIdRef.current !== myRun) return;
      animate(
        ".btn-pill",
        { scale: [1, 0.94, 1] },
        { duration: 0.35, ease: HUMAN_EASE },
      );
      animate(
        ".btn-ripple",
        { scale: [0.4, 1.5], opacity: [0.7, 0] },
        { duration: 0.55, ease: HUMAN_EASE },
      );
      await new Promise((r) => setTimeout(r, 280));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 4b: fade scene + show loader ─────────────────
      // Scene-inputs translate up + fade (clears the way for the
      // loader). Button + click-cursor fade IN PLACE — no upward
      // translation — per user direction 2026-05-28: "when the
      // mouse clicks the button, fade it aways instead of moving
      // it up".
      animate(
        ".scene-inputs",
        { y: -60, opacity: 0 },
        { duration: 0.5, ease: "easeIn" },
      );
      animate(
        ".gen-button, .click-cursor",
        { opacity: 0 },
        { duration: 0.5, ease: "easeIn" },
      );
      animate(
        ".loader-fill",
        { opacity: 1 },
        { duration: 0.25, delay: 0.15 },
      );
      if (runIdRef.current !== myRun) return;
      // RTL fill: animate the rect's WIDTH 0→120 while moving its
      // x from 160 (right edge) ← back to 40 (left edge). The
      // visible right edge stays pinned at x=160 throughout, so
      // the bar visibly grows leftward from the right.
      await animate(
        ".loader-fill",
        { width: 120, x: 40 },
        { duration: 1.1, ease: "easeInOut", delay: 0.2 },
      );
      if (runIdRef.current !== myRun) return;
      await new Promise((r) => setTimeout(r, 200));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 5: fade loader, reveal 3 distinct slides ─────
      // These reveals carry `delay` and aren't awaited (start() returns
      // right after), so a hover-out landing in the delay window would
      // otherwise let them fire and re-show slides after reset() —
      // track them so reset() can cancel.
      track(animate(".loader-fill", { opacity: 0 }, { duration: 0.35 }));
      track(
        animate(
          ".slide-text",
          { opacity: 1, y: 0, scale: 1 },
          { duration: 0.5, ease: "easeOut" },
        ),
      );
      track(
        animate(
          ".slide-chart",
          { opacity: 1, y: 0, scale: 1 },
          { duration: 0.5, delay: 0.12, ease: "easeOut" },
        ),
      );
      track(
        animate(
          ".slide-image",
          { opacity: 1, y: 0, scale: 1 },
          { duration: 0.5, delay: 0.24, ease: "easeOut" },
        ),
      );
    }, [animate, reset, track]);

    const stop = useCallback(() => {
      runIdRef.current += 1;
      reset();
    }, [reset]);

    useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }));

    useEffect(() => {
      reset();
    }, [reset]);

    return (
      <svg
        ref={scope}
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Shared soft edge mask (.mask-soft-edges) — content fades at
        // the card bounds; the file enters from fully outside the
        // viewBox through the corner feather. Outermost <svg> clips at
        // the viewBox edge via the UA default overflow:hidden.
        className="mask-soft-edges"
      >
        {/* ─── INPUTS GROUP: input (right) + drop zone (left) ── */}
        <g className="scene-inputs">
          <rect
            x="64"
            y="84"
            width="120"
            height="32"
            rx="6"
            strokeOpacity="0.55"
          />
          {/* Typing surface — native SVG <text> (NOT foreignObject).
              Safari mis-handles foreignObject inside transformed +
              masked <g> groups: the inner HTML doesn't repaint on
              React state changes (text shows only AFTER typing
              finishes), doesn't move with the parent group's
              transform, and ignores the SVG edge mask. Native SVG
              text has none of those bugs — it repaints per frame,
              rides the .scene-inputs transform, fades with the group
              opacity, and is clipped by the mask.
              RTL: direction=rtl + text-anchor=start anchored at the
              input's right inset (x=176), so Arabic grows leftward.
              The blinking caret is the logically-LAST tspan, which in
              an RTL run renders at the leading (left) edge of the
              typed text — caret-follows-text without measurement. */}
          <text
            x="176"
            y="100"
            textAnchor="start"
            dominantBaseline="central"
            direction="rtl"
            fontSize="11"
            fill="currentColor"
            fillOpacity="0.85"
            stroke="none"
          >
            {TYPED_TEXT.slice(0, typedCount)}
            <tspan className="create-flow-caret" fill="var(--tq-violet)">
              |
            </tspan>
          </text>

          {/* Drop zone — dashed stroke to read as a drop target.
              Two stacked rects: muted-grey base (always visible) and
              the violet "active" overlay (fades in the moment the
              file lands). User direction 2026-05-28: "once the file
              and cursor reach the drop zone, the dashed lines becomes
              purple". */}
          <rect
            x="16"
            y="84"
            width="40"
            height="32"
            rx="6"
            strokeOpacity="0.55"
            strokeDasharray="3 3"
          />
          <motion.rect
            className="drop-zone-active"
            x="16"
            y="84"
            width="40"
            height="32"
            rx="6"
            stroke="var(--tq-violet)"
            strokeDasharray="3 3"
            initial={{ opacity: 0 }}
          />
          {/* ↓ arrow hint — fades out when the file lands. */}
          <g
            className="drop-arrow"
            transform="translate(36, 100)"
            opacity="0.4"
          >
            <line x1="0" y1="-6" x2="0" y2="4" />
            <path d="M -3 1 L 0 4 L 3 1" />
          </g>
          {/* Check tick — draws into the dropzone post-drop. */}
          <motion.path
            className="drop-check"
            d="M 28 100 L 33 105 L 44 92"
            stroke="var(--tq-violet)"
            strokeWidth="1.75"
            initial={{ pathLength: 0, opacity: 0 }}
          />
        </g>

        {/* ─── DRAGGED FILE + nested DRAG-CURSOR ────────────────
              The file binds x / y / scale to motion values directly
              (no selector animation). The drag-cursor lives INSIDE
              this group at the file's local centre (24, 30) and
              uses a 1/scale counter-scale so its visual size stays
              constant while it follows the file's transform.
              Result: cursor visual centre is ALWAYS exactly on the
              file's visual centre, by construction — no parallel
              animations to desync. ─────────────────────────────── */}
        <motion.g
          className="drag-file"
          style={{
            x: fileX,
            y: fileY,
            scale: fileScale,
            transformOrigin: "0 0",
          }}
          initial={{ opacity: 0 }}
        >
          <path d="M 0 0 L 36 0 L 48 12 L 48 60 L 0 60 Z" />
          <path d="M 36 0 L 36 12 L 48 12" strokeOpacity="0.6" />
          <line x1="6" y1="22" x2="42" y2="22" strokeOpacity="0.45" />
          <line x1="6" y1="32" x2="36" y2="32" strokeOpacity="0.45" />
          <line x1="6" y1="42" x2="40" y2="42" strokeOpacity="0.45" />

          {/* Drag cursor — anchored at file's local centre, counter-
              scaled to constant visible size. The cursor path is
              visual-centre-anchored (local (0,0) = body centre), so
              the cursor's body centre lines up perfectly with the
              file's centre at every frame. */}
          <g transform="translate(24, 30)">
            <motion.g
              style={{ scale: cursorCounterScale, transformOrigin: "0 0" }}
            >
              <path
                d={CURSOR_PATH}
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </motion.g>
          </g>
        </motion.g>

        {/* ─── GENERATE BUTTON (rendered BEFORE cursor so cursor
              sits on top of it). ──────────────────────────────── */}
        <motion.g
          className="gen-button"
          // Hidden on first paint — reset() (in a mount effect) hides
          // these via `animate()` only AFTER the first render, so an
          // `initial` matching reset()'s parked state prevents a flash.
          initial={{ y: 70, opacity: 0 }}
          style={{ transformOrigin: "100px 140px" }}
        >
          <motion.g
            className="btn-pill"
            style={{ transformOrigin: "100px 140px" }}
          >
            <rect
              x="68"
              y="126"
              width="64"
              height="28"
              rx="14"
              stroke="var(--tq-violet)"
              strokeOpacity="0.9"
            />
            <motion.circle
              className="btn-ripple"
              cx="100"
              cy="140"
              r="32"
              stroke="var(--tq-violet)"
              strokeOpacity="0.9"
              // Hidden on first paint (see gen-button note above).
              initial={{ scale: 0.4, opacity: 0 }}
              style={{ transformOrigin: "100px 140px" }}
            />
            {/* White label per user direction 2026-05-28 (was
                violet — read low-contrast against the page bg). */}
            <text
              x="100"
              y="144"
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fill="white"
              stroke="none"
            >
              إنشاء
            </text>
          </motion.g>
        </motion.g>

        {/* ─── LOADING LINE (no track stroke; just the violet bar
              growing leftward from the right edge). ──────────── */}
        <motion.rect
          className="loader-fill"
          y="98"
          height="4"
          rx="2"
          fill="var(--tq-violet)"
          stroke="none"
          initial={{ width: 0, x: 160, opacity: 0 }}
        />

        {/* ─── FINAL SLIDES (centered 1 × 3 row).
              At scale 0.7 each slide is 33.6 × 42 in viewBox units.
              Layout maths (user direction 2026-05-28: scaled up but
              keeping the same gap as the prior 0.55 layout):
                3 slides × 33.6 + 2 gaps × 12.4 = 125.6
                start x = (200 − 125.6) / 2 ≈ 37.2 → 37
                positions: x = 37, 83, 129
                row spans x:37 → 162.6, midpoint ≈ 100 ✓
              y = 79 → row spans y:79-121, midpoint = 100 ✓
              (scene-inputs has fully faded out by the time the
              slides reveal, so they can share its y range). ──── */}
        <g transform="translate(37, 79)">
          <motion.g
            className="final-slide slide-text"
            style={{ transformOrigin: "17px 21px" }}
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
          >
            <g transform="scale(0.7)">
              <SlideTextHeavy />
            </g>
          </motion.g>
        </g>
        <g transform="translate(83, 79)">
          <motion.g
            className="final-slide slide-chart"
            style={{ transformOrigin: "17px 21px" }}
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
          >
            <g transform="scale(0.7)">
              <SlideChart />
            </g>
          </motion.g>
        </g>
        <g transform="translate(129, 79)">
          <motion.g
            className="final-slide slide-image"
            style={{ transformOrigin: "17px 21px" }}
            initial={{ opacity: 0, y: 18, scale: 0.9 }}
          >
            <g transform="scale(0.7)">
              <SlideImageCaption />
            </g>
          </motion.g>
        </g>

        {/* ─── CLICK-CURSOR (LAST in DOM so it sits on top of the
              button during the click). Separate element from the
              drag-cursor inside .drag-file — the drag-cursor is
              never visible during the click phase (the whole
              .drag-file group has opacity 0 by then). Visual-centre-
              anchored path: translate(x, y) puts the cursor's body
              centre at (x, y). ─────────────────────────────────── */}
        <motion.g
          className="click-cursor"
          initial={{ opacity: 0, x: CURSOR_REENTER_X, y: CURSOR_REENTER_Y }}
        >
          <path
            d={CURSOR_PATH}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </motion.g>

        <style>{`
          /* Blink the caret tspan via fill-opacity (animating
             plain opacity on a tspan is unreliable in Safari;
             fill-opacity is solid). */
          @keyframes create-flow-caret {
            0%, 50%   { fill-opacity: 1; }
            51%, 100% { fill-opacity: 0; }
          }
          .create-flow-caret {
            animation: create-flow-caret 0.8s steps(1, end) infinite;
          }
        `}</style>
      </svg>
    );
  },
);

export default CreateFlowAnimation;

// ─── Slide variants ───────────────────────────────────────────────

function SlideOutline() {
  return <rect width="48" height="60" rx="3" strokeOpacity="0.85" />;
}

function SlideTitleBar({ width = 32 }: { width?: number }) {
  return (
    <rect
      x="6"
      y="6"
      width={width}
      height="4"
      rx="1.5"
      fill="var(--tq-violet)"
      stroke="none"
      opacity="0.85"
    />
  );
}

function SlideTextHeavy() {
  return (
    <>
      <SlideOutline />
      <SlideTitleBar width={28} />
      <line x1="6" y1="18" x2="38" y2="18" strokeOpacity="0.55" />
      <line x1="6" y1="24" x2="42" y2="24" strokeOpacity="0.55" />
      <line x1="6" y1="30" x2="34" y2="30" strokeOpacity="0.55" />
      <line x1="6" y1="36" x2="40" y2="36" strokeOpacity="0.55" />
      <line x1="6" y1="42" x2="30" y2="42" strokeOpacity="0.55" />
      <circle
        cx="42"
        cy="48"
        r="1"
        fill="currentColor"
        stroke="none"
        opacity="0.55"
      />
      <line x1="6" y1="48" x2="38" y2="48" strokeOpacity="0.55" />
    </>
  );
}

function SlideChart() {
  return (
    <>
      <SlideOutline />
      <SlideTitleBar width={20} />
      <line x1="6" y1="48" x2="42" y2="48" strokeOpacity="0.7" />
      <rect x="9" y="38" width="5" height="10" strokeOpacity="0.85" />
      <rect x="18" y="32" width="5" height="16" strokeOpacity="0.85" />
      <rect x="27" y="24" width="5" height="24" strokeOpacity="0.85" />
      <rect
        x="36"
        y="18"
        width="5"
        height="30"
        fill="var(--tq-violet)"
        stroke="var(--tq-violet)"
        opacity="0.85"
      />
      <line x1="6" y1="14" x2="24" y2="14" strokeOpacity="0.45" />
    </>
  );
}

function SlideImageCaption() {
  return (
    <>
      <SlideOutline />
      <SlideTitleBar width={24} />
      <rect x="6" y="16" width="36" height="22" rx="2" strokeOpacity="0.7" />
      <circle cx="14" cy="24" r="2.5" strokeOpacity="0.55" />
      <path
        d="M 6 36 L 18 24 L 28 32 L 42 22 L 42 38 L 6 38 Z"
        strokeOpacity="0.55"
      />
      <line x1="6" y1="46" x2="36" y2="46" strokeOpacity="0.5" />
      <line x1="6" y1="52" x2="28" y2="52" strokeOpacity="0.5" />
    </>
  );
}
