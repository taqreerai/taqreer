/*
 * Glass-preset preflight — runs before paint on every page load.
 * Reads the user's saved glass preset from localStorage and applies
 * its CSS-var values to <html> so the first paint already uses the
 * user's chosen opacity / blur / saturation. Switchable live from
 * Settings → مظهر التطبيق.
 *
 * Loaded as a static asset via <Script src="/glass-preflight.js"
 * strategy="beforeInteractive"> in app/layout.tsx. Lives outside the
 * React component tree so it bypasses React 19's "Encountered a script
 * tag while rendering React component" warning while still running
 * synchronously before first paint.
 */
try {
  var p = localStorage.getItem("taqreer_glass_preset");
  var presets = {
    off: ["0", "0px", "0.08", "100%"],
    subtle: ["0.02", "4px", "0.06", "110%"],
    normal: ["0.04", "8px", "0.09", "130%"],
    strong: ["0.07", "16px", "0.12", "160%"],
  };
  var v = presets[p] || presets.normal;
  var r = document.documentElement;
  r.style.setProperty("--glass-opacity", v[0]);
  r.style.setProperty("--glass-blur", v[1]);
  r.style.setProperty("--glass-border-opacity", v[2]);
  r.style.setProperty("--glass-saturation", v[3]);
} catch (e) {
  /* swallow: localStorage can be blocked in private mode */
}
