// Same-origin proxy for template cover thumbnails (`/tpl/<storage-path>`).
//
// Template covers live in Supabase public storage on a DIFFERENT origin, which
// cost every visitor a separate DNS+TLS handshake, a per-request Supabase cookie
// (`__cf_bm`), ~200-450 ms of storage wait, and only a 1 h cache — they were the
// slowest thing on the landing (user report). Routing them through taqreer.ai
// makes them same-origin (HTTP/2-multiplexed with the page) and, crucially,
// cacheable by OUR Cloudflare edge: this handler drops the Supabase cookie and
// stamps a 1-year immutable Cache-Control, so CF serves each cover from the edge
// (cf-cache-status HIT) after the first fill. URLs are rewritten at the source
// by edgeCoverUrl() in lib/auth/marquee-projects.ts.
//
// Locked to the public deck-preview bucket so this is not an open proxy.

const PUBLIC_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
const ALLOWED_PREFIX = "slide-previews/";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const rel = path.join("/");

  // Only proxy public deck-preview objects; reject traversal / other buckets.
  if (!rel.startsWith(ALLOWED_PREFIX) || rel.includes("..")) {
    return new Response(null, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(PUBLIC_BASE + rel);
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status || 502 });
  }

  // Forward ONLY the content type + a long immutable cache. Omitting Supabase's
  // Set-Cookie is what lets Cloudflare cache the response at the edge.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
