import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // deploy.sh builds into .next-deploy so a production build can run while
  // the dev server owns .next; unset = normal .next everywhere else.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compress: true,
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
        ],
      },
    ];
  },
  // PostHog reverse proxy: posthog-js posts capture events to the same-origin
  // `/ingest/*`, which Next proxies SERVER-SIDE to PostHog EU. Direct browser ->
  // eu.i.posthog.com requests get 503'd at PostHog's edge (server-side requests
  // always 200), and this also makes analytics immune to ad-blockers. `/ingest`
  // is exempted from proxy.ts so the locale middleware leaves it untouched.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Org/project of the Sentry account (taqreerai-66 / taqreer).
  org: "taqreerai-66",
  project: "taqreer",
  // Source-map upload auth token (set SENTRY_AUTH_TOKEN to get readable
  // stack traces; undefined → upload skipped, errors still captured minified).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload a wider set of client source files for better stack traces.
  widenClientFileUpload: true,
  // NOTE: tunnelRoute is deliberately OMITTED - it would create a /monitoring
  // route that the coming-soon gate + locale middleware (proxy.ts) rewrite,
  // breaking the tunnel. Revisit (with a proxy exemption) post-launch if
  // ad-blocker drop-off matters.
  silent: !process.env.CI,
});
