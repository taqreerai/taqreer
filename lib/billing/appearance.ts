"use client";

// Builds the Stripe Elements Appearance object from the LIVE design
// tokens, so the payment form follows the active theme (dark/light)
// and stays inside the locked design system: one blue accent, solid
// surfaces, hairline borders, Cairo type, pill-adjacent radii.
//
// Colors are resolved through an offscreen element because some
// tokens are authored in oklch(), which Stripe's parser does not
// accept - getComputedStyle normalizes everything to rgb().

import type { Appearance } from "@stripe/stripe-js";

// Stripe's iframe cannot read our self-hosted next/font files, so the
// form loads Cairo from Google Fonts directly.
export const CHECKOUT_FONTS = [
  {
    cssSrc:
      "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap",
  },
];

function resolveColor(token: string): string {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  // Modern browsers keep wide-gamut colors as lab()/oklch() in
  // getComputedStyle, which Stripe rejects - rasterize one canvas
  // pixel to force plain sRGB.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return computed;
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

export function checkoutAppearance(): Appearance {
  return {
    theme: "stripe",
    labels: "above",
    variables: {
      colorPrimary: resolveColor("--tq-purple"),
      colorBackground: resolveColor("--tq-card"),
      colorText: resolveColor("--tq-text-primary"),
      colorTextSecondary: resolveColor("--tq-text-muted"),
      colorDanger: "rgb(220, 38, 38)",
      fontFamily: "Cairo, sans-serif",
      borderRadius: "12px",
      focusBoxShadow: "none",
      focusOutline: `1px solid ${resolveColor("--tq-purple")}`,
    },
    rules: {
      ".Input": {
        border: `1px solid ${resolveColor("--tq-border-hairline")}`,
        boxShadow: "none",
      },
      ".Block": {
        border: `1px solid ${resolveColor("--tq-border-hairline")}`,
        boxShadow: "none",
      },
    },
  };
}
