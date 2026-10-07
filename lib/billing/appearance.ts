"use client";

// Builds the Stripe Elements Appearance object from the LIVE design
// tokens, so the payment form follows the active theme (dark/light)
// and stays inside the locked design system: one blue accent, solid
// surfaces, hairline borders, Cairo type, pill inputs.
//
// Colors are resolved through an offscreen element because some
// tokens are authored in oklch(), which Stripe's parser does not
// accept - getComputedStyle normalizes everything to rgb(). Tokens
// with alpha (overlay/hairline) are COMPOSITED over the card surface
// first: Stripe only takes opaque colors, and rasterizing an rgba
// against a transparent canvas would skew the channel values.

import type { Appearance } from "@stripe/stripe-js";

// Stripe's iframe cannot read our self-hosted next/font files, so the
// form loads Cairo from Google Fonts directly.
export const CHECKOUT_FONTS = [
  {
    cssSrc:
      "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap",
  },
];

function computedColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = value;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

// Resolve `token` to a plain opaque sRGB string. When the token has
// alpha, it is composited over `behindToken` (default: the card
// surface the form sits on) so the result matches what the eye sees.
//
// NEVER throws (2026-10-07): the canvas read-back is blocked or randomised by
// browser privacy features and extensions (canvas fingerprint protection), and
// this runs inside an effect the moment the checkout opens, where a throw
// replaced the whole page with the global error screen. Any failure, or a
// blanked read-back, falls back to a fixed colour for the active theme.
const FALLBACK_COLORS: Record<string, { dark: string; light: string }> = {
  "--tq-border-hairline": { dark: "rgb(52, 52, 56)", light: "rgb(222, 222, 226)" },
  "--tq-overlay-soft": { dark: "rgb(36, 36, 40)", light: "rgb(244, 244, 246)" },
  "--tq-purple": { dark: "rgb(0, 87, 255)", light: "rgb(0, 87, 255)" },
  "--tq-card": { dark: "rgb(24, 24, 27)", light: "rgb(255, 255, 255)" },
  "--tq-text-primary": { dark: "rgb(255, 255, 255)", light: "rgb(10, 10, 10)" },
  "--tq-text-muted": { dark: "rgb(161, 161, 170)", light: "rgb(100, 100, 108)" },
};

function fallbackColor(token: string): string {
  const light = document.documentElement.classList.contains("light");
  const pair = FALLBACK_COLORS[token];
  return pair ? (light ? pair.light : pair.dark) : light ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)";
}

function resolveColor(token: string, behindToken = "--tq-card"): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallbackColor(token);
    ctx.fillStyle = computedColor(`var(${behindToken})`);
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = computedColor(`var(${token})`);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    // Fingerprint protection can return a blank (fully transparent) canvas.
    if (a === 0) return fallbackColor(token);
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallbackColor(token);
  }
}

export function checkoutAppearance(): Appearance {
  const hairline = resolveColor("--tq-border-hairline");
  // Same fill as `.input-dark` (overlay-soft over the card).
  const inputBg = resolveColor("--tq-overlay-soft");
  return {
    theme: "stripe",
    labels: "above",
    variables: {
      colorPrimary: resolveColor("--tq-purple"),
      colorBackground: resolveColor("--tq-card"),
      colorText: resolveColor("--tq-text-primary"),
      colorTextSecondary: resolveColor("--tq-text-muted"),
      colorTextPlaceholder: resolveColor("--tq-text-muted"),
      colorDanger: "rgb(220, 38, 38)",
      fontFamily: "Cairo, sans-serif",
      // Breathing room between rows (user direction 2026-06-12).
      spacingGridRow: "20px",
      // Resting surface radius (blocks, tabs, dropdown panels) - the
      // 14px `surface-card` / textarea radius.
      borderRadius: "14px",
      focusBoxShadow: "none",
      focusOutline: `1px solid ${resolveColor("--tq-purple")}`,
    },
    rules: {
      // Same label-to-field gap as our own form fields (`mb-2`).
      ".Label": {
        marginBottom: "8px",
      },
      // Mirror `.input-dark` exactly: pill ends, overlay-soft fill,
      // hairline border, same padding.
      ".Input": {
        backgroundColor: inputBg,
        border: `1px solid ${hairline}`,
        borderRadius: "9999px",
        padding: "12px 20px",
        boxShadow: "none",
      },
      ".Block": {
        border: `1px solid ${hairline}`,
        boxShadow: "none",
      },
      ".Tab": {
        border: `1px solid ${hairline}`,
        boxShadow: "none",
      },
    },
  };
}
