// The external origin to base server-side redirects (and emailed links) on.
//
// In a ROUTE HANDLER on prod the app runs `next start -p 3100` behind nginx +
// Cloudflare, so `request.url` is the INTERNAL `http://localhost:3100`. Using it
// as a redirect base (`new URL(path, request.url)`) sends the browser to an
// unreachable localhost (the email-confirm "nothing showing" bug). Middleware
// (proxy.ts) is unaffected - there the URL is already the external one.
//
// Resolution order:
//   1. NEXT_PUBLIC_SITE_URL when set (explicit, injection-proof).
//   2. The forwarded Host + proto - nginx sets `Host $host` (taqreer.ai) and
//      `X-Forwarded-Proto $scheme`, so these carry the real external origin even
//      when request.url does not.
//   3. The request origin - correct for local dev (no proxy).
export function siteOrigin(request: Request): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const reqUrl = new URL(request.url);
  const host = request.headers.get("host") ?? reqUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    reqUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
