"use client";

// Over-cap notice — shown on the upload-driven redesign flows (enhance,
// mimic) when the uploaded SOURCE deck has more pages than the user's
// tier slide cap. Without it the deck is silently clipped to the cap at
// generation time (slideCeiling in deck-generate) and the user is never
// told their file was too big for their plan — the exact surprise a Pro
// user hit uploading a 69-page deck against the 60-slide cap.
//
// Non-blocking by design: it INFORMS, generation stays allowed (a capped
// deck is still a legitimate outcome the user may accept). Uses the
// status-warn token triad so it reads as a heads-up, not an error, and
// carries the exact numbers + remedy. `message` is the already-
// interpolated string from the caller's dictionary (Latin numerals per
// the copy rules).

export function OverCapNotice({
  pages,
  cap,
  message,
}: {
  // Source deck page count (0/undefined when unknown, e.g. typed text).
  pages: number | undefined;
  // The user's tier slide cap (useSlideCap()).
  cap: number;
  // Interpolated warning copy, e.g. flows.overCapWarning with {pages}/{cap} filled.
  message: string;
}) {
  if (!pages || pages <= cap) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border p-3 text-[12px] leading-relaxed"
      style={{
        background: "var(--tq-status-warn-bg)",
        borderColor: "var(--tq-status-warn-border)",
        color: "var(--tq-status-warn-text)",
      }}
    >
      <span
        className="material-symbols-outlined leading-none"
        style={{ fontSize: 18 }}
        aria-hidden
      >
        info
      </span>
      <span>{message}</span>
    </div>
  );
}
