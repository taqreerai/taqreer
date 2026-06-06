// TEMPORARY verbose tracing for the Studio editor (comment / regen / mode
// flows). Added for a manual test pass after the AI-vs-user comment split +
// command-bar rework. Logs are prefixed `[editor:<scope>]` so you can filter
// the browser console (or the dev-server terminal for server scopes).
//
// Toggle OFF at runtime in the browser console:  window.__EDITOR_DEBUG__ = false
// Remove this file + its call sites once the flows are verified.
export function edbg(scope: string, msg: string, data?: unknown): void {
  const isServer = typeof window === "undefined";
  if (
    !isServer &&
    (window as Window & { __EDITOR_DEBUG__?: boolean }).__EDITOR_DEBUG__ ===
      false
  ) {
    return;
  }
  const tag = `[editor:${scope}]`;
  // eslint-disable-next-line no-console
  if (isServer) console.log(tag, msg, data ?? "");
  // eslint-disable-next-line no-console
  else console.log(`%c${tag}`, "color:#a78bfa;font-weight:700", msg, data ?? "");
}
