"use client";

// Light/dark theme toggle — replaces the old `light_mode` placeholder in the
// TopUtilityBar. Flips the `light` class on <html> (the .light token overrides
// in globals.css do the rest) and persists the choice to the `tq_theme` cookie,
// which the root layout reads SSR-side so there's no flash on the next load.
// Theme is a CHROME concern only — the slide canvas direction/colors are
// independent (manifest-driven), same as the locale axis.

import { useSyncExternalStore } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { useDict } from "@/components/i18n/LocaleProvider";
import {
  subscribeTheme,
  getThemeIsLight,
  getThemeIsLightServer,
  setThemeLight,
} from "@/lib/theme";

export function ThemeToggle() {
  const dict = useDict();
  // Live theme from the `light` class on <html>, read hydration-safely via
  // useSyncExternalStore (server snapshot is dark; React reconciles to the real
  // DOM value on the client after hydration). No setState-in-effect.
  const light = useSyncExternalStore(subscribeTheme, getThemeIsLight, getThemeIsLightServer);
  const toggle = () => setThemeLight(!light);

  return (
    <Tooltip label={dict.topBar.theme} placement="bottom">
      <button
        type="button"
        aria-label={dict.topBar.theme}
        aria-pressed={light}
        onClick={toggle}
        className="icon-hover flex h-9 w-9 items-center justify-center rounded-lg"
      >
        {/* Icon shows the target: sun while dark (→ switch to light), moon while light. */}
        <span className="material-symbols-outlined text-[20px]">
          {light ? "dark_mode" : "light_mode"}
        </span>
      </button>
    </Tooltip>
  );
}
