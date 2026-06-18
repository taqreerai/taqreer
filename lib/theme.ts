// Client-side theme store. The UI theme lives as a `light` class on <html>
// (SSR-applied by the root layout from the tq_theme cookie). Reading it through
// useSyncExternalStore keeps the toggle hydration-safe WITHOUT a
// setState-in-effect: the server snapshot is "dark" and React reconciles to the
// real DOM value on the client after hydration. setThemeLight() is the only
// writer — it flips the class, persists the cookie, and notifies subscribers, so
// every mounted toggle (dashboard ThemeToggle + the profile-menu row) stays in
// sync. Theme is a CHROME concern only; the slide canvas is manifest-driven.

import { THEME_COOKIE, setUiCookie } from "@/lib/ui-cookies";

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

// SSR has no DOM; default to dark. useSyncExternalStore reconciles to the real
// value on the client (the `.light` class is already applied from the cookie).
export function getThemeIsLightServer() {
  return false;
}

export function setThemeLight(light: boolean) {
  document.documentElement.classList.toggle("light", light);
  setUiCookie(THEME_COOKIE, light ? "light" : "dark");
  listeners.forEach((l) => l());
}
