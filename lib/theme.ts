// Client-side theme store. The UI theme lives as a `light` class on <html>
// (SSR-applied by the root layout from the tq_theme cookie). Reading it through
// useSyncExternalStore keeps the toggle hydration-safe WITHOUT a
// setState-in-effect: the server snapshot is "dark" and React reconciles to the
// real DOM value on the client after hydration. setThemeLight() is the only
// writer — it flips the class, persists the cookie, and notifies subscribers, so
// every mounted toggle (dashboard ThemeToggle + the profile-menu row) stays in
// sync. Theme is a CHROME concern only; the slide canvas is manifest-driven.

import { THEME_COOKIE, setUiCookie } from "@/lib/ui-cookies";
import { stripLocale } from "@/lib/i18n/navigation";

const listeners = new Set<() => void>();

export function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getThemeIsLight() {
  return document.documentElement.classList.contains("light");
}

// SSR has no DOM; assume the app default (light). useSyncExternalStore
// reconciles to the real value on the client (the `.light` class is already
// applied from the cookie).
export function getThemeIsLightServer() {
  return true;
}

export function setThemeLight(light: boolean) {
  document.documentElement.classList.toggle("light", light);
  setUiCookie(THEME_COOKIE, light ? "light" : "dark");
  listeners.forEach((l) => l());
}

/**
 * Re-apply the stored theme to <html>, by the same rule as the layout's
 * pre-paint CHROME_INIT: light unless the cookie says "dark", and the admin
 * panel stays dark. Needed after a LANGUAGE switch: the locale is part of the
 * root layout, so React re-renders <html> with only its own className and the
 * `light` class was dropped (prod 2026-10-29: the landing went dark on every
 * switch). ThemeClassKeeper calls this after each navigation.
 */
export function applyStoredTheme(pathname: string) {
  const segment = stripLocale(pathname).split("/").filter(Boolean)[0];
  const dark = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=dark(?:;|$)`).test(document.cookie);
  const light = segment !== "admin" && !dark;
  if (document.documentElement.classList.contains("light") === light) return;
  document.documentElement.classList.toggle("light", light);
  listeners.forEach((l) => l());
}
