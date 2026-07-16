// GET /api/stock-images/download?id=<generatedImageId>
//
// Public download proxy for one image in the /free-stock-images gallery.
// The image's `storageUrl` is already a permanent PUBLIC Supabase URL,
// but the download goes through here to FORCE A SAVE: a cross-origin
// public link opens inline in the browser; streaming it same-origin with
// `Content-Disposition: attachment` makes the click save a file.
//
// No ownership gate (this is a public library, by user direction). The
// lookup uses the SAME saved-version scope as the gallery loader, so only
// images that are actually browsable can be downloaded — a random
// GeneratedImage id (superseded version, unsaved deck) resolves to 404.
//
// Not an SSRF surface: the fetched URL comes from our own DB (written by
// the deck-images pipeline to the public bucket), and we still pin it to
// the Supabase host before fetching.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Node runtime — streams the upstream image body through.
export const runtime = "nodejs";
export const maxDuration = 30;

// Pin the proxied fetch to our own Supabase ORIGIN (scheme + host + port,
// not just the hostname — so a different scheme/port can't slip through).
// `storageUrl` is always written to the public bucket, so any other origin
// is corrupt data.
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin || null;
  } catch {
    return null;
  }
})();

const FETCH_TIMEOUT_MS = 20_000;

// A short, safe file base from the image prompt (first few words), so the
// saved file is recognizable. Falls back to a generic brand name.
function fileBaseFromPrompt(prompt: string): string {
  const cleaned = (prompt || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return cleaned || "taqreer-stock-image";
}

// Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8
// `filename*` so Arabic prompts survive intact.
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Saved-version scope (same JOIN as the gallery loader) so only
  // browsable images are downloadable. Raw SQL because the scope compares
  // a column to a related column, which the Prisma query builder can't.
  const rows = await prisma.$queryRaw<{ url: string; prompt: string }[]>`
    SELECT gi."storageUrl" AS url, gi.prompt
    FROM "GeneratedImage" gi
    JOIN "Presentation" pr
      ON pr."savedVersionId" = gi."presentationVersionId"
    WHERE gi.id = ${id}
      AND gi.status = 'ready'
      AND gi."storageUrl" IS NOT NULL
    LIMIT 1
  `;
  const image = rows[0];
  if (!image?.url) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(image.url);
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  if (!SUPABASE_ORIGIN || upstreamUrl.origin !== SUPABASE_ORIGIN) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Timeout bounds connection + headers only, NOT the body stream (we
  // return upstream.body to the client; a whole-fetch timeout could abort
  // it mid-stream and truncate a large image). Cleared once fetch resolves.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      // Refuse redirects — a 3xx could otherwise carry the fetch off the
      // validated Supabase origin.
      redirect: "error",
    });
  } catch {
    return NextResponse.json({ error: "Could not fetch image" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch image" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const fileName = `${fileBaseFromPrompt(image.prompt)}.${ext}`;

  // Stream the upstream body straight through — no full-image buffer. The
  // bytes for a given id never change, so it's safe to cache hard at the edge.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(fileName),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
