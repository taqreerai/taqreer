"use client";

// Light/dark theme toggle — replaces the old `light_mode` placeholder in the
// TopUtilityBar. Flips the `light` class on <html> (the .light token overrides
// in globals.css do the rest) and persists the choice to the `tq_theme` cookie,
// which the root layout reads SSR-side so there's no flash on the next load.
// Theme is a CHROME concern only — the slide canvas direction/colors are
// independent (manifest-driven), same as the locale axis.

import { useEffect, useState } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { useDict } from "@/components/i18n/LocaleProvider";
import { THEME_COOKIE } from "@/lib/ui-cookies";

export function ThemeToggle() {
  const dict = useDict();
  // Resolve from the DOM on mount — SSR already set `.light` from the cookie, so
  // this just syncs the button's icon to the live state (avoids a hydration
  // mismatch from guessing the theme on the server render of this component).
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.cookie = `${THEME_COOKIE}=${next ? "light" : "dark"};path=/;max-age=31536000;samesite=lax`;
  };

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
