import { MetadataRoute } from "next";

// robots.txt = crawl rules. Everything is allowed by default; we only fence off
// the auth-gated / private surfaces so Google spends its crawl budget on the
// public marketing pages, not on routes that just bounce anonymous crawlers to
// /login.
//
// Patterns are locale-prefix-aware: real URLs are /ar/... or /en/..., so a bare
// "/project/" never matches. "/*/project/" matches /ar/project/ and /en/project/.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        // Studio (private, per-deck).
        "/*/project/",
        // Account / billing surfaces (auth-gated, no SEO value).
        "/*/dashboard",
        "/*/settings",
        "/*/billing",
        "/*/invoices",
        "/*/checkout",
        "/*/usage",
        "/*/plans",
        // Admin + banned.
        "/*/admin",
        "/*/banned",
        // Auth entry points (no SEO value, dilute crawl budget).
        "/*/login",
        "/*/signup",
      ],
    },
    sitemap: "https://taqreer.ai/sitemap.xml",
  };
}
