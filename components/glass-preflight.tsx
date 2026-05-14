"use client";

import { useLayoutEffect } from "react";

/**
 * Applies the user's saved glass preset to <html>'s CSS vars on hydration.
 *
 * Replaces the previous inline-<script> preflight in app/layout.tsx. The
 * earlier pattern (raw <script>, then <Script>, then <Script src>) tripped
 * React 19's "Encountered a script tag while rendering React component"
 * warning — the warning fires on ANY <script> element in the component
 * tree regardless of how it's authored.
 *
 * useLayoutEffect runs synchronously before the browser's next paint after
 * hydration. Trade-off: server-rendered initial HTML uses globals.css's
 * defaults (which match the "normal" preset exactly), so users on default
 * or no saved preset see no FOUC. Users on off / subtle / strong see ~50–
 * 100 ms of "normal" before their saved preset applies — acceptable for
 * a Settings-customisable cosmetic toggle.
 */
const PRESETS: Record<string, [string, string, string, string]> = {
  off: ["0", "0px", "0.08", "100%"],
  subtle: ["0.02", "4px", "0.06", "110%"],
  normal: ["0.04", "8px", "0.09", "130%"],
  strong: ["0.07", "16px", "0.12", "160%"],
};

export function GlassPreflight() {
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem("taqreer_glass_preset");
      const v = (saved && PRESETS[saved]) || PRESETS.normal;
      const r = document.documentElement;
      r.style.setProperty("--glass-opacity", v[0]);
      r.style.setProperty("--glass-blur", v[1]);
      r.style.setProperty("--glass-border-opacity", v[2]);
      r.style.setProperty("--glass-saturation", v[3]);
    } catch {
      // swallow — localStorage can be blocked (private browsing etc.)
    }
  }, []);
  return null;
}
