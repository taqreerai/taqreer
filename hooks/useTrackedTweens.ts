import { useCallback, useRef } from "react";

/**
 * Tracks framer-motion playback controls so a scene's `reset()` can
 * cancel any in-flight / delayed tweens before re-parking elements.
 *
 * Without this, an un-awaited `animate(..., { delay })` or a
 * motion-value tween started in `start()` keeps running after a
 * hover-out and overwrites `reset()`'s parked state — jumping the
 * scene forward. The SVG feature-flow animations (Create / Enhance /
 * Datasheet) all share this start()/reset() shape, so the buffer +
 * cancel logic lives here once instead of being hand-copied per file.
 *
 * `track(controls)` records the controls and returns them UNCHANGED.
 * The generic preserves the exact input type, so
 * `track(animateValue(...)).finished` still type-checks (the drag
 * tween in CreateFlowAnimation relies on this).
 *
 * `cancelAll()` stops everything tracked and empties the buffer — call
 * it at the top of `reset()`. Both entry points (`start()` and the
 * hover-out `stop()`) run `reset()`, so the buffer is bounded to a
 * single hover cycle.
 */
export function useTrackedTweens() {
  const pendingRef = useRef<Array<{ stop: () => void }>>([]);

  const track = useCallback(<T extends { stop: () => void }>(c: T): T => {
    pendingRef.current.push(c);
    return c;
  }, []);

  const cancelAll = useCallback(() => {
    pendingRef.current.forEach((c) => c.stop());
    pendingRef.current = [];
  }, []);

  return { track, cancelAll };
}
