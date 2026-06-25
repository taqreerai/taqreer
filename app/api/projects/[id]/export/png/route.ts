// POST /api/projects/[id]/export/png
//
// Sync server-side PNG export. Renders the canonical (saved or
// currently-rendering) manifest to standalone HTML via the same
// JSDOM-backed builder the thumbnail pipeline uses, drives Puppeteer
// to screenshot each slide at canvas-native resolution
// (1920×1080 for 16:9, 1080×1920 for 9:16), zips the PNG buffers
// with JSZip, and streams the ZIP back as the response body.
//
// Deliberately sync — the toolbar button spins for the ~3-10s the
// render takes; no Inngest job, no storage upload, no bell
// notification. Matches the user UX call 2026-05-20.
//
// Auth: owner-only (matches the rest of /api/projects/[id]/*).
// Runtime: Node (Puppeteer requires it). 60s max — should comfortably
// cover 5-25 slides at canvas-native res; longer decks would benefit
// from the async path planned for step 15.5 + concurrency.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import JSZip from "jszip";
import {
  launchGuardedBrowser,
  closeGuardedBrowser,
  guardPageEgress,
} from "@/lib/export/puppeteer-pool";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  SlideManifestSchema,
  dimensionsForFormat,
} from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Mirrors the thumbnail-render `cssEscape` helper. Selector-safety
// for slide IDs Claude may emit with non-alphanumeric characters.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Strips characters that can't ride into a ZIP entry or a
// Content-Disposition filename across Windows + macOS + Linux. The
// project title is user-controlled (deck rename API) — never trust
// it raw in a filename.
function safeFileName(raw: string, fallback: string): string {
  const trimmed = raw
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return trimmed.length > 0 ? trimmed : fallback;
}

// Builds an RFC 6266 Content-Disposition header that survives
// non-ASCII filenames (Arabic deck titles in particular). HTTP
// headers are ByteStrings (every char ≤ 255), so a raw Arabic
// `filename="..."` throws on header construction (caught us via
// the PDF route 2026-05-21). Modern browsers prefer the UTF-8
// percent-encoded `filename*`; the ASCII fallback covers any
// ancient client that doesn't.
function contentDispositionAttachment(displayName: string): string {
  const ascii = displayName.replace(/[^\x20-\x7E]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    displayName,
  )}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimited(`export-png:${clientIp(request)}`, 30, 5 * 60_000);
  if (limited) return limited;
  const { id: projectId } = await params;
  // Phase 15.A — view access required.
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Resolve project + the version we'll render. Prefer the pinned
  // savedVersionId if the user has saved (canonical snapshot); fall
  // back to currentVersionId so a user can export an unsaved
  // in-flight regen result if they want to. Both branches resolve to
  // a `PresentationVersion.slideJson` we can Zod-validate.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      presentation: {
        include: {
          versions: {
            select: { id: true, slideJson: true },
          },
        },
      },
    },
  });
  if (!project || !project.presentation) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const presentation = project.presentation;
  const versionId =
    presentation.savedVersionId ?? presentation.currentVersionId;
  if (!versionId) {
    return NextResponse.json(
      { error: "No version available to export" },
      { status: 400 },
    );
  }
  const version = presentation.versions.find((v) => v.id === versionId);
  if (!version) {
    return NextResponse.json(
      { error: "Version row missing" },
      { status: 404 },
    );
  }
  const parsed = SlideManifestSchema.safeParse(version.slideJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Manifest failed validation" },
      { status: 500 },
    );
  }
  const manifest = parsed.data;
  if (manifest.slides.length === 0) {
    return NextResponse.json(
      { error: "Manifest has no slides" },
      { status: 400 },
    );
  }

  const { width: canvasW, height: canvasH } = dimensionsForFormat(
    manifest.format,
  );
  const html = buildHtmlDocumentServer(manifest);

  // Puppeteer + Chrome. Args identical to the thumbnail pipeline so
  // the runtime contract is single-sourced. Container deployments
  // need `--no-sandbox` + `--disable-dev-shm-usage`; bare-metal dev
  // tolerates them too.
  const browser = await launchGuardedBrowser();
  const zip = new JSZip();
  try {
    const page = await browser.newPage();
    await guardPageEgress(page);
    // Viewport sized to a SINGLE slide + 1 px pad on the height.
    // Was `canvasH * (slides+1)` — that grew linearly with deck
    // length and crossed Chromium's hard 16,384 px screenshot
    // limit on long 9:16 decks (>7 slides) and long 16:9 decks
    // (>14 slides). Beyond that limit Chrome silently returns
    // blank PNGs OR crashes the print pipeline. With a single-
    // slide viewport, each `page.screenshot({ clip })` runs
    // safely regardless of deck length — we just scroll the
    // target slide into view before each shot (see below).
    // The +1 pad keeps the viewport strictly LARGER than the
    // clip rect, dodging Chrome's clip-equals-viewport blank-
    // output edge case (the bug that prompted the original
    // padding trick on a 1-slide deck).
    await page.setViewport({
      width: canvasW,
      height: canvasH + 1,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 30_000,
    });
    // Webfonts settle on their own clock — `document.fonts.ready`
    // resolves after `networkidle0` for Google Fonts. Without this
    // the first slide renders fallback fonts.
    await page.evaluate(() => {
      const docFonts = (
        document as Document & { fonts?: { ready?: Promise<unknown> } }
      ).fonts;
      return docFonts?.ready ?? Promise.resolve();
    });

    // Sequential, not parallel — Chrome's compositor serialises page.
    // screenshot anyway, and the bbox lookup needs the page to be
    // in a settled scroll state. At 5-25 slides the linear cost is
    // 1-5s; we'd only refactor to a worker pool if decks regularly
    // exceeded 30 slides.
    for (let i = 0; i < manifest.slides.length; i++) {
      const slide = manifest.slides[i];
      // Scroll the target slide into view BEFORE measuring/shooting
      // so Chrome paints it inside the single-slide viewport.
      //
      // Coord-space gotcha (root-caused 2026-05-21 via the
      // thumbnail-render pipeline reporting "slide 1 × N" for every
      // saved deck): `getBoundingClientRect()` is VIEWPORT-relative
      // — slide N scrolled to top reads (0, 0). Puppeteer's
      // `page.screenshot({ clip })` interprets clip in DOCUMENT
      // coords (captureBeyondViewport defaults to true when a clip
      // is set), so a viewport-relative (0, 0) clip always
      // captured document (0, 0) — slide 1 — regardless of which
      // slide was scrolled to. Adding `window.scrollX/Y` converts
      // viewport rect → document rect.
      const bbox = await page.evaluate((escaped) => {
        const el = document.querySelector(`[data-slide-id="${escaped}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: "start", inline: "start" });
        const r = el.getBoundingClientRect();
        return {
          x: r.x + window.scrollX,
          y: r.y + window.scrollY,
          width: r.width,
          height: r.height,
        };
      }, cssEscape(slide.slideId));
      if (!bbox) {
        throw new Error(
          `Slide ${slide.slideId} not found in rendered document`,
        );
      }
      const png = (await page.screenshot({
        type: "png",
        clip: bbox,
      })) as Buffer;
      const entryName = `slide-${String(i + 1).padStart(2, "0")}.png`;
      zip.file(entryName, png);
    }
  } finally {
    await closeGuardedBrowser(browser);
  }

  // ArrayBuffer (not Uint8Array) so the BlobPart type narrows
  // cleanly. JSZip's uint8array output is technically
  // `Uint8Array<ArrayBufferLike>` which TS strict-mode rejects as a
  // BlobPart because ArrayBufferLike includes SharedArrayBuffer.
  // The arraybuffer output is plain ArrayBuffer — exactly what
  // BlobPart accepts.
  const zipBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const baseName = safeFileName(project.title || manifest.title, "presentation");
  const filename = `${baseName}-pngs.zip`;
  const body = new Blob([zipBuffer], { type: "application/zip" });
  // Conversion-funnel step 3/4: a successful export. distinctId = Supabase uid.
  if (access.user.id) {
    captureServerEvent(access.user.id, "deck_exported", {
      project_id: projectId,
      format: "png",
      slide_count: manifest.slides.length,
    });
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionAttachment(filename),
      // No-store on this exact response so a browser sharing the
      // same /export/png URL across two projects doesn't serve a
      // stale ZIP (the URL has the project id so collision is
      // unlikely, but the export is a one-shot blob — caching
      // upstream proxies offers nothing).
      "Cache-Control": "no-store",
    },
  });
}
