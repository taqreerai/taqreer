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
import JSZip from "jszip";
import puppeteer from "puppeteer";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // Resolve project + the version we'll render. Prefer the pinned
  // savedVersionId if the user has saved (canonical snapshot); fall
  // back to currentVersionId so a user can export an unsaved
  // in-flight regen result if they want to. Both branches resolve to
  // a `PresentationVersion.slideJson` we can Zod-validate.
  const project = await prisma.project.findFirst({
    where: { id: projectId, user: { supabaseUserId: user.id } },
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
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const zip = new JSZip();
  try {
    const page = await browser.newPage();
    // Viewport STRICTLY LARGER than any single-slide clip — Chrome
    // blanks out when `page.screenshot({ clip })` exactly matches the
    // viewport. Same trick the thumbnail pipeline uses; pad by one
    // extra slide-height so a 1-slide deck still avoids the edge.
    await page.setViewport({
      width: canvasW,
      height: canvasH * (manifest.slides.length + 1),
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
      const bbox = await page.evaluate((escaped) => {
        const el = document.querySelector(`[data-slide-id="${escaped}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
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
    await browser.close().catch((err) => {
      // Browser close failure logs but doesn't leak the partial ZIP
      // — JSZip's buffer lives in process memory and gets GC'd when
      // the response finishes. We just orphan a Chromium instance
      // briefly; the OS reaper handles it on idle.
      console.error("[export/png] browser.close failed", err);
    });
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
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // No-store on this exact response so a browser sharing the
      // same /export/png URL across two projects doesn't serve a
      // stale ZIP (the URL has the project id so collision is
      // unlikely, but the export is a one-shot blob — caching
      // upstream proxies offers nothing).
      "Cache-Control": "no-store",
    },
  });
}
