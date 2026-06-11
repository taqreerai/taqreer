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
function resolveColor(token: string, behindToken = "--tq-card"): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return computedColor(`var(${token})`);
  ctx.fillStyle = computedColor(`var(${behindToken})`);
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = computedColor(`var(${token})`);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
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
      // Resting surface radius (blocks, tabs, dropdown panels) - the
      // 14px `surface-card` / textarea radius.
      borderRadius: "14px",
      focusBoxShadow: "none",
      focusOutline: `1px solid ${resolveColor("--tq-purple")}`,
    },
    rules: {
      // Mirror `.input-dark` exactly: pill ends, overlay-soft fill,
      // hairline border, same padding.
      ".Input": {
        backgroundColor: inputBg,
        border: `1px solid ${hairline}`,
        borderRadius: "9999px",
        padding: "12px 20px",
        boxShadow: "none",
      },
      // Selects (country) share the input recipe.
      ".Dropdown": {
        backgroundColor: inputBg,
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
