"use client";

// §24: <body> (not <html>) is the page scroll container so the scrollbar lands
// on the left in RTL (Blink pins the ROOT scrollbar to the right regardless of
// `dir`). Next's scroll-to-top on navigation drives `window` / the root
// scroller, which no longer scrolls — so the body keeps its previous offset on
// client navigation. This resets it, restoring the expected "new route opens at
// the top" behavior. Skipped when the target URL has a hash (anchor nav).

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    // Effects only run client-side, so `window`/`document` are always defined.
    if (window.location.hash) return;
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }, [pathname]);
  return null;
}
