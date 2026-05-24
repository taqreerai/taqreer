"use client";

// Hook that returns the route prefix the current page is mounted
// under, so the shared /create/brand + /create/summary pages can
// construct navigation paths that stay under the user's URL
// namespace.
//
// Phase 17.B introduced a parallel /enhance/* route tree that
// REUSES the /create/brand and /create/summary components without
// forking them (~3300 lines saved). The components themselves
// render identically; only their navigation paths differ:
//
//   /create/brand:    Previous → /create/content,   Next → /create/summary
//   /enhance/brand:   Previous → /enhance/content,  Next → /enhance/summary
//
// Anywhere those components call `router.push(...)` for forward /
// back nav, use \`${flowPrefix}/<step>\` instead of a hardcoded
// "/create/<step>".
//
// Returns "/create" for any path not matching /enhance — covers the
// existing create flow as a default, plus future flows that don't
// pre-fix this map (e.g. /create-from-template, which already has
// its own forked pages and doesn't touch the shared brand page).

import { usePathname } from "next/navigation";

export type FlowPrefix = "/create" | "/enhance";

export function useFlowPrefix(): FlowPrefix {
  const pathname = usePathname();
  if (pathname.startsWith("/enhance")) return "/enhance";
  return "/create";
}
