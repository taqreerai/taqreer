// GET /api/library/images/[id]
//
// Re-download proxy for one AI-generated image in the /library grid.
// The image's `storageUrl` is a permanent PUBLIC Supabase URL, but the
// download goes through here for two reasons:
//   1. OWNERSHIP GATE — only the image's owner can pull it. The public
//      URL is the display path; this route is the access boundary the
//      library's download action relies on.
//   2. FORCE A DOWNLOAD — a cross-origin public link opens inline in
//      the browser; streaming it same-origin with
//      `Content-Disposition: attachment` makes the click save a file
//      with a friendly, project-named filename.
//
// Not an SSRF surface: the fetched URL comes from our own DB (written
// by the deck-images pipeline to the public bucket), and we still pin
// it to the Supabase host before fetching.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

// Node runtime — streams the upstream image body through; the proxied
// fetch can take a moment for a large PNG.
export const runtime = "nodejs";
export const maxDuration = 30;

// Pin the proxied fetch to our own Supabase host. `storageUrl` is
// always written to the public bucket, so any other host is corrupt
// data, not something we should fetch.
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || null;
  } catch {
    return null;
  }
})();

const FETCH_TIMEOUT_MS = 20_000;

// Content-Disposition with both an ASCII fallback and an RFC 5987
// UTF-8 `filename*` so Arabic project titles survive intact.
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // UI locale → the fallback download title when a project has no title.
  const localeRaw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const dict = await getDictionary(isLocale(localeRaw) ? localeRaw : "ar");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership + readiness gate in ONE query: the image must be ready,
  // have a storage URL, and roll up (version → presentation → project)
  // to a project this user owns.
  const image = await prisma.generatedImage.findFirst({
    where: {
      id,
      status: "ready",
      storageUrl: { not: null },
      version: { presentation: { project: { userId: dbUser.id } } },
    },
    select: {
      storageUrl: true,
      role: true,
      version: {
        select: {
          presentation: {
            select: { project: { select: { title: true } } },
          },
        },
      },
    },
  });
  if (!image?.storageUrl) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(image.storageUrl);
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  if (!SUPABASE_HOST || upstreamUrl.hostname !== SUPABASE_HOST) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Bound the timeout to connection + headers only, NOT the body
  // stream: we return `upstream.body` to the client below, and an
  // `AbortSignal.timeout` covering the whole fetch can abort the body
  // mid-stream (undici), truncating a large image. Clear the timer
  // once `fetch` resolves so it can't fire while streaming.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { signal: controller.signal });
  } catch {
    return NextResponse.json(
      { error: "Could not fetch image" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Could not fetch image" },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg")
    ? "jpg"
    : contentType.includes("webp")
      ? "webp"
      : "png";
  const projectTitle =
    image.version.presentation.project.title?.trim() ||
    dict.defaults.fallbackTitle;
  const fileName = `${projectTitle} - ${image.role}.${ext}`;

  // Stream the upstream body straight through — no full-image buffer.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(fileName),
      // Per-user file; don't let a shared/CDN cache hold it.
      "Cache-Control": "private, no-store",
    },
  });
}

// DELETE /api/library/images/[id] - remove ONE image from the library
// (multi-select delete, 2026-06-12). Deletes the GeneratedImage ROW
// only: decks embed the image by its public storage URL, so the
// storage object stays (deleting it would break every deck that
// references it). Storage garbage-collection with a reference check is
// a follow-up. Same ownership gate as GET.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { count } = await prisma.generatedImage.deleteMany({
    where: {
      id,
      version: { presentation: { project: { userId: dbUser.id } } },
    },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
