"use client";

// Static generated-image thumbnails — shared URL rewrite + load ladder.
//
// Replaces the Supabase render/image transformation URLs the gallery/library
// tiles used to build (billed per distinct origin image per month — 510 last
// period and climbing with SEO traffic). storeGeneratedImage now writes a
// sibling `${projectId}/gen/thumb/${genid}-${hash}.webp` (700px long edge,
// lib/images/store.ts) and scripts/backfill-image-thumbs.ts backfills the
// corpus; here the tiles derive that path with a pure string rewrite.
//
// The 3-step load ladder is kept from the transform era: attempt 0 = thumb,
// 1 = cache-busted thumb (transient storage blip), 2 = the full original —
// which is also the graceful path for any image whose thumb doesn't exist
// (mid-backfill, or a live thumb-write failure). After that, a calm
// placeholder. `key={attempt}` on the <img> remounts it so onError re-fires.

import { useState } from "react";

// Rewrite a stored generated-image URL to its static thumb sibling:
//   .../object/public/generated-images/<projectId>/gen/<name>.<ext>
//     → .../generated-images/<projectId>/gen/thumb/<name>.webp
// Scoped tight (generated-images bucket + a trailing /gen/ dir + no query) so
// uploads/, foreign URLs, and anything unexpected pass through untouched.
// Only the FINAL extension is swapped — genids may themselves contain dots.
const GEN_BUCKET_MARKER = "/storage/v1/object/public/generated-images/";
export function genThumbUrl(url: string): string {
  if (!url.includes(GEN_BUCKET_MARKER) || url.includes("?")) return url;
  const slash = url.lastIndexOf("/");
  const dir = url.slice(0, slash);
  const file = url.slice(slash + 1);
  if (!dir.endsWith("/gen") || !/\.[a-z0-9]+$/i.test(file)) return url;
  return `${dir}/thumb/${file.replace(/\.[a-z0-9]+$/i, ".webp")}`;
}

/**
 * Thumbnail src with the escalation ladder. Returns everything an <img>
 * needs; the caller keeps its own markup (classNames, loading, alt).
 * Resets when `fullUrl` changes (the stock lightbox swaps images in place).
 */
export function useThumbSrc(fullUrl: string): {
  src: string;
  /** Pass as key={} so a retry remounts the <img> and onError re-fires. */
  key: number;
  broken: boolean;
  onError: () => void;
} {
  const [state, setState] = useState({ url: fullUrl, attempt: 0, broken: false });
  // Canonical "adjust state when a prop changes" reset — during render, not
  // in an effect (set-state-in-effect is a lint error in this repo).
  if (state.url !== fullUrl) {
    setState({ url: fullUrl, attempt: 0, broken: false });
  }

  const thumb = genThumbUrl(fullUrl);
  // Non-rewritable URL → no thumb to try; a single failure is terminal.
  const maxAttempt = thumb === fullUrl ? 0 : 2;
  const attempt = Math.min(state.attempt, maxAttempt);
  const src =
    attempt === 0 && thumb !== fullUrl
      ? thumb
      : attempt === 1
        ? `${thumb}${thumb.includes("?") ? "&" : "?"}retry=1`
        : fullUrl;

  return {
    src,
    key: attempt,
    broken: state.broken,
    onError: () =>
      setState((s) =>
        s.attempt < maxAttempt
          ? { ...s, attempt: s.attempt + 1 }
          : { ...s, broken: true },
      ),
  };
}
