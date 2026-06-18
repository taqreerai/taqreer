// Browser cookie names for UI-chrome preferences. Centralized so every server
// component that reads them (the (app) layout, the project page, the 404 view)
// shares one source of truth — a renamed cookie can't silently desync.

// Sidebar collapsed-state, read SSR-side so the rail paints in the right state
// on first frame (DashboardShell hydrates from the same value).
export const SIDEBAR_COLLAPSED_COOKIE = "tq_sidebar_collapsed";

// UI theme ("light" | "dark"). Read SSR-side in the root layout to put `light`
// on <html> at first paint (no flash); the ThemeToggle writes it on switch.
export const THEME_COOKIE = "tq_theme";

// Write a UI-preference cookie from the client (1 year, lax). Lives at module
// scope — NOT inside a component/hook — so React Compiler's immutability rule
// doesn't flag the `document.cookie` assignment in the event handlers that call
// it (the rule only governs component/hook bodies).
export function setUiCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=31536000;samesite=lax`;
}
