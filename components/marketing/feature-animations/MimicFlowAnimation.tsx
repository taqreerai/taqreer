"use client";

// ─── Mimic-flow feature animation ─────────────────────────────────
//
// RTL storyboard (plays once on hover, resets on hover-out):
//
//   Layout (LTR pixel coords; reads R→L in Arabic context):
//     [ enhanced result (left) ]  ←  [ 9:16 drop zone (right) ]
//                                              ↑
//                                   ┌──────────┴──────────┐
//                                   │  "محاكاة" button     │
//                                   └─────────────────────┘
//
//   1. Rest: left result is GHOSTED (opacity 0.3). Arrow is dim.
//      Right drop zone is empty + dashed muted grey.
//   2. Cursor + a plain 9:16 file enter from the top-right of the
//      slot and drag into the drop zone. Cursor is nested INSIDE
//      the file's motion group at the file's local centre so it's
//      structurally locked to the file — same pattern that fixed
//      the Create-flow drift.
//   3. Drop: dashed border flips to violet; nested cursor hides.
//   4. "محاكاة" button slides up below.
//   5. Click-cursor re-enters from below, clicks the button (squash
//      + ripple — same primitive as Create).
//   6. TRANSFORM: a violet scan line sweeps right→left across the
//      right file. As it passes, the plain content (text-only)
//      fades out and enhanced content (violet title + image + logo
//      dot) fades in. Simultaneously the LEFT ghosted result
//      brightens to full colour and the arrow brightens.
//
//   User direction 2026-05-28:
//     • Component repurposed from Enhance → Mimic (the before/after
//       beat lands better for "apply this style to my content").
//     • Plain "before" file is TEXT-ONLY — no decorative rects /
//       image placeholders inside.
//     • Files are vertically CENTRED in the 200×200 viewBox
//       (centre y = 100), with the button slotting just below.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  animate as animateValue,
  motion,
  useAnimate,
  useMotionValue,
} from "framer-motion";

// Shared with CreateFlowAnimation — slow→fast→slow ease-in-out.
const HUMAN_EASE = [0.65, 0, 0.35, 1] as const;

// Visual-centre-anchored cursor path (local (0,0) = body centre,
// tip at (-4.5, -6)). Same path as the Create flow.
const CURSOR_PATH =
  "M -4.5 -6 L -4.5 5 L -1.5 2 L 0.5 6 L 2.5 5 L 0.5 1 L 4.5 1 Z";

// File dimensions (in viewBox units). Width 42 per user direction
// 2026-05-28; height kept at 60 to keep the files vertically
// centred at y=100 without crowding the button.
const FILE_W = 42;
const FILE_H = 60;

// Right drop zone — 4 units of inset padding on every side around
// the 42-wide file so the dashed border reads as a clear container
// rather than visually pinching the file (user feedback 2026-05-28:
// "drop zone looks tighter than the file horizontally"). The rx=6
// corner curve + dashed stroke pattern made an equal-width drop
// zone look narrower than the file's straight edges.
const DROP_ZONE_W = 50; // 42 + 4·2
const DROP_ZONE_H = 68; // 60 + 4·2 (already had vertical padding)
const DROP_CENTER_X = 160;
const DROP_CENTER_Y = 100;
const DROP_ZONE_X = DROP_CENTER_X - DROP_ZONE_W / 2; // 135
const DROP_ZONE_Y = DROP_CENTER_Y - DROP_ZONE_H / 2; // 66

// File top-left translate values. Start is fully OUTSIDE the 200×200
// viewBox (left edge AT the right edge → the whole file sits past it)
// and above the top edge, so it slides in diagonally through the soft
// edge mask — same entrance as the Create flow (user direction
// 2026-05-28: "bring the file from outside the card not the corner,
// just like create").
const FILE_START_X = 200;        // file fully past the right viewBox edge
const FILE_START_Y = -40;        // file fully above the top viewBox edge
const FILE_END_X = DROP_CENTER_X - FILE_W / 2; // 139
const FILE_END_Y = DROP_CENTER_Y - FILE_H / 2; // 70

// LEFT enhanced result — vertically centred at y=100, mirroring the
// drop zone's horizontal margin on the opposite side (19 units).
const LEFT_FILE_X = 19;
const LEFT_FILE_Y = FILE_END_Y; // 70 — same vertical row as the right file

// Scan-line travel range: across the right file only.
const SCAN_START_X = FILE_END_X + FILE_W; // 181 (right edge of file)
const SCAN_END_X = FILE_END_X;            // 139 (left edge of file)

// Button geometry. Moved down from 146 → 158 per user direction
// 2026-05-28 ("the button shows too close to the files"). At y=158
// the pill (28 high) sits at y:144-172, giving 14 units of breathing
// room between the files (end at y=130) and the button.
const BUTTON_Y_CENTRE = 158;

// Click-cursor positions.
const CURSOR_REENTER_X = 100;
const CURSOR_REENTER_Y = 215;
const CURSOR_CLICK_Y = BUTTON_Y_CENTRE; // x stays at CURSOR_REENTER_X

export type MimicFlowAnimationHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const MimicFlowAnimation = forwardRef<MimicFlowAnimationHandle>(
  function MimicFlowAnimation(_, ref) {
    const [scope, animate] = useAnimate();
    const runIdRef = useRef(0);

    // File translate motion values — single source of truth for the
    // drag. Cursor is nested inside the file's motion group so it's
    // locked to the file by structure (no parallel animations).
    const fileX = useMotionValue(FILE_START_X);
    const fileY = useMotionValue(FILE_START_Y);

    const reset = useCallback(() => {
      fileX.set(FILE_START_X);
      fileY.set(FILE_START_Y);
      // Left reference file stays at full opacity throughout — user
      // direction 2026-05-28 ("make the left file visible always,
      // it doesn't have to be muted until mimic finishes"). The
      // ghosted-then-brightens beat was removed.
      animate(".mimic-arrow", { opacity: 0.3 }, { duration: 0 });
      animate(".drop-zone-active", { opacity: 0 }, { duration: 0 });
      animate(".drag-file", { opacity: 0 }, { duration: 0 });
      animate(".drag-cursor", { opacity: 1 }, { duration: 0 });
      animate(".file-content-plain", { opacity: 1 }, { duration: 0 });
      animate(".file-content-enhanced", { opacity: 0 }, { duration: 0 });
      animate(
        ".scan-line",
        { x: SCAN_START_X, opacity: 0 },
        { duration: 0 },
      );
      animate(
        ".click-cursor",
        { x: CURSOR_REENTER_X, y: CURSOR_REENTER_Y, opacity: 0 },
        { duration: 0 },
      );
      animate(".mimic-button", { y: 70, opacity: 0 }, { duration: 0 });
      animate(".btn-ripple", { scale: 0.4, opacity: 0 }, { duration: 0 });
    }, [animate, fileX, fileY]);

    const start = useCallback(async () => {
      runIdRef.current += 1;
      const myRun = runIdRef.current;
      reset();

      // ── PHASE 1: file fades in at its start position ────────
      animate(".drag-file", { opacity: 1 }, { duration: 0.2 });
      await new Promise((r) => setTimeout(r, 200));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 2: drag file → drop zone (cursor locked inside) ─
      const DRAG_DURATION = 1.2;
      const dragXAnim = animateValue(fileX, FILE_END_X, {
        duration: DRAG_DURATION,
        ease: HUMAN_EASE,
      });
      animateValue(fileY, FILE_END_Y, {
        duration: DRAG_DURATION,
        ease: HUMAN_EASE,
      });
      await dragXAnim.finished;
      if (runIdRef.current !== myRun) return;

      // ── PHASE 3: drop — nested cursor fades, violet outline ──
      animate(".drag-cursor", { opacity: 0 }, { duration: 0.2 });
      animate(
        ".drop-zone-active",
        { opacity: 1 },
        { duration: 0.25, ease: "easeOut" },
      );
      await new Promise((r) => setTimeout(r, 320));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 4: Mimic button slides up ─────────────────────
      await animate(
        ".mimic-button",
        { y: 0, opacity: 1 },
        { duration: 0.55, ease: HUMAN_EASE },
      );
      if (runIdRef.current !== myRun) return;
      await new Promise((r) => setTimeout(r, 180));
      if (runIdRef.current !== myRun) return;

      // ── PHASE 5: click-cursor enters from below + clicks ────
      animate(
        ".click-cursor",
        { x: CURSOR_REENTER_X, y: CURSOR_REENTER_Y, opacity: 0 },
        { duration: 0 },
      );
      await animate(
        ".click-cursor",
        { y: CURSOR_CLICK_Y, opacity: 1 },
        { duration: 0.6, ease: HUMAN_EASE },
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

      // ── PHASE 6: TRANSFORM (scan + crossfade + brighten) ────
      // Cursor + button fade in place (no upward translation) per
      // user direction 2026-05-28: "when the mouse clicks the
      // button, fade it aways instead of moving it up".
      animate(
        ".click-cursor, .mimic-button",
        { opacity: 0 },
        { duration: 0.4, ease: "easeIn" },
      );

      // Mimicking process slowed 50% per user direction 2026-05-28
      // ("slow down the mimicing process, the line scan is fast
      // make it 50% slower"). Scan + crossfade + arrow brighten
      // all stretched 1.5× so the transform reads slower as one
      // coherent beat.
      const SCAN_DURATION = 1.2; // was 0.8
      animate(
        ".scan-line",
        { opacity: [0, 1, 1, 0] },
        { duration: SCAN_DURATION, times: [0, 0.1, 0.85, 1] },
      );
      animate(
        ".scan-line",
        { x: SCAN_END_X },
        { duration: SCAN_DURATION, ease: "easeInOut" },
      );

      animate(
        ".file-content-plain",
        { opacity: 0 },
        { duration: 0.825, ease: "easeOut", delay: 0.27 },
      );
      animate(
        ".file-content-enhanced",
        { opacity: 1 },
        { duration: 0.825, ease: "easeOut", delay: 0.27 },
      );

      animate(
        ".mimic-arrow",
        { opacity: 0.9 },
        { duration: 0.75, delay: 0.45 },
      );
    }, [animate, reset, fileX, fileY]);

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
        // viewBox through the corner feather.
        className="mask-soft-edges"
      >
        {/* LEFT enhanced result — always at full opacity (user
            direction 2026-05-28). Static; no animation. */}
        <g transform={`translate(${LEFT_FILE_X}, ${LEFT_FILE_Y})`}>
          <EnhancedFileContent />
        </g>

        {/* Arrow pointing LEFT (RTL: input on right → output on left).
            Sits on the row's vertical centre (y=100). */}
        <motion.g className="mimic-arrow" initial={{ opacity: 0.3 }}>
          <line x1="115" y1="100" x2="85" y2="100" strokeOpacity="0.9" />
          <path d="M 91 96 L 85 100 L 91 104" strokeOpacity="0.9" />
        </motion.g>

        {/* RIGHT drop zone — muted-grey base + violet active overlay */}
        <rect
          x={DROP_ZONE_X}
          y={DROP_ZONE_Y}
          width={DROP_ZONE_W}
          height={DROP_ZONE_H}
          rx="6"
          strokeOpacity="0.55"
          strokeDasharray="3 3"
        />
        <motion.rect
          className="drop-zone-active"
          x={DROP_ZONE_X}
          y={DROP_ZONE_Y}
          width={DROP_ZONE_W}
          height={DROP_ZONE_H}
          rx="6"
          stroke="var(--tq-violet)"
          strokeDasharray="3 3"
          initial={{ opacity: 0 }}
        />

        {/* RIGHT FILE — dragged in, then transformed in place.
            Plain + enhanced content groups crossfade during the scan.
            Drag-cursor nested at the file's local centre — locked
            by structure, no parallel animations to desync. */}
        <motion.g
          className="drag-file"
          style={{ x: fileX, y: fileY, transformOrigin: "0 0" }}
          initial={{ opacity: 0 }}
        >
          <g className="file-content-plain">
            <PlainFileContent />
          </g>
          <motion.g
            className="file-content-enhanced"
            initial={{ opacity: 0 }}
          >
            <EnhancedFileContent />
          </motion.g>

          {/* Drag-cursor — anchored at file's local centre. The
              cursor path is visual-centre-anchored (local (0,0) =
              body centre), so it sits dead-centre on the file. */}
          <g
            className="drag-cursor"
            transform={`translate(${FILE_W / 2}, ${FILE_H / 2})`}
          >
            <path
              d={CURSOR_PATH}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </g>
        </motion.g>

        {/* Scan line — violet sweep R→L across the right file */}
        <motion.rect
          className="scan-line"
          y={FILE_END_Y - 2}
          width="1.5"
          height={FILE_H + 4}
          fill="var(--tq-violet)"
          stroke="none"
          initial={{ x: SCAN_START_X, opacity: 0 }}
        />

        {/* Mimic button — same primitive as Create's "إنشاء" */}
        <motion.g
          className="mimic-button"
          initial={{ y: 70, opacity: 0 }}
          style={{ transformOrigin: `100px ${BUTTON_Y_CENTRE}px` }}
        >
          <motion.g
            className="btn-pill"
            style={{ transformOrigin: `100px ${BUTTON_Y_CENTRE}px` }}
          >
            <rect
              x="68"
              y={BUTTON_Y_CENTRE - 14}
              width="64"
              height="28"
              rx="14"
              stroke="var(--tq-violet)"
              strokeOpacity="0.9"
            />
            <motion.circle
              className="btn-ripple"
              cx="100"
              cy={BUTTON_Y_CENTRE}
              r="32"
              stroke="var(--tq-violet)"
              strokeOpacity="0.9"
              initial={{ scale: 0.4, opacity: 0 }}
              style={{ transformOrigin: `100px ${BUTTON_Y_CENTRE}px` }}
            />
            <text
              x="100"
              y={BUTTON_Y_CENTRE + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fill="white"
              stroke="none"
            >
              محاكاة
            </text>
          </motion.g>
        </motion.g>

        {/* Click-cursor — sibling used only for the click phase */}
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
      </svg>
    );
  },
);

export default MimicFlowAnimation;

// ─── File-content variants ────────────────────────────────────────
//
// "Plain" (before) = TEXT ONLY. User direction 2026-05-28: no
// decorative rectangles / image placeholders inside the file body.
// The outline rect stays because it IS the file frame. Inside, only
// horizontal lines representing dim text.
//
// "Enhanced" (after) = violet title bar, sharper line contrast,
// small mini-illustration in an image area, and a violet logo dot.

function PlainFileContent() {
  return (
    <>
      {/* Stroke opacities match the Create flow exactly (outline
          0.85, content lines 0.55) so the file reads the same crisp
          white — user direction 2026-05-28: "make the mimic files
          same colors as create, they are not 100% white". */}
      <rect width={FILE_W} height={FILE_H} rx="3" strokeOpacity="0.85" />
      {/* Text-only content — every element is a horizontal line,
          no filled rects, no image placeholders. Lines extend to
          x≈36 (4 units padding from the file's right edge at 42). */}
      <line x1="4" y1="9" x2="26" y2="9" strokeOpacity="0.55" />
      <line x1="4" y1="15" x2="36" y2="15" strokeOpacity="0.55" />
      <line x1="4" y1="21" x2="30" y2="21" strokeOpacity="0.55" />
      <line x1="4" y1="27" x2="34" y2="27" strokeOpacity="0.55" />
      <line x1="4" y1="33" x2="28" y2="33" strokeOpacity="0.55" />
      <line x1="4" y1="39" x2="36" y2="39" strokeOpacity="0.55" />
      <line x1="4" y1="45" x2="24" y2="45" strokeOpacity="0.55" />
      <line x1="4" y1="51" x2="32" y2="51" strokeOpacity="0.55" />
    </>
  );
}

function EnhancedFileContent() {
  return (
    <>
      <rect width={FILE_W} height={FILE_H} rx="3" strokeOpacity="0.85" />
      {/* Violet title bar */}
      <rect
        x="4"
        y="5"
        width="24"
        height="4"
        rx="1"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
      {/* Content lines — family standard 0.55 (were 0.7, which read
          too bright on the always-full-opacity left result slide). */}
      <line x1="4" y1="14" x2="32" y2="14" strokeOpacity="0.55" />
      <line x1="4" y1="20" x2="26" y2="20" strokeOpacity="0.55" />
      {/* Image area with mini-illustration — muted further so it
          doesn't read brighter than the text lines (user 2026-05-28). */}
      <rect x="4" y="26" width="34" height="18" rx="2" strokeOpacity="0.55" />
      <circle cx="11" cy="33" r="2" strokeOpacity="0.4" />
      <path
        d="M 4 42 L 14 34 L 22 38 L 38 30 L 38 44 L 4 44 Z"
        strokeOpacity="0.4"
      />
      {/* Bottom line + violet logo dot */}
      <line x1="4" y1="50" x2="26" y2="50" strokeOpacity="0.55" />
      <circle
        cx="36"
        cy="54"
        r="2"
        fill="var(--tq-violet)"
        stroke="none"
        opacity="0.9"
      />
    </>
  );
}
