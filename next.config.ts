import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // deploy.sh builds into .next-deploy so a production build can run while
  // the dev server owns .next; unset = normal .next everywhere else.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compress: true,
  // Drop the `X-Powered-By: Next.js` header (fingerprinting / SEO audit flag).
  poweredByHeader: false,
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
  // The datasheet flow's SEO spoke /report-design was renamed to
  // /social-media-posts (the flow became social). 301 (statusCode, NOT
  // permanent:true which emits 308) so the old indexed URL passes its authority
  // to the new one. Redirects run BEFORE the proxy.ts locale gate, so the
  // locale-prefixed canonicals (/ar/report-design, /en/report-design) 301 in one
  // hop; the bare path 301s then the proxy adds the locale, same as any bare URL.
  async redirects() {
    return [
      {
        source: "/:lang(ar|en)/report-design",
        destination: "/:lang/social-media-posts",
        statusCode: 301,
      },
      {
        source: "/report-design",
        destination: "/social-media-posts",
        statusCode: 301,
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
