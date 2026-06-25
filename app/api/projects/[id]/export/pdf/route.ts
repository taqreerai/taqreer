// POST /api/projects/[id]/export/pdf
//
// Sync server-side PDF export. Renders the canonical (saved or
// currently-rendering) manifest to standalone HTML via the same
// JSDOM-backed builder the thumbnail + PNG pipelines use — this
// call passes `{ printPageBreaks: true }` so the builder emits
// `@page` + per-slide `page-break-after`, and Puppeteer's
// `page.pdf()` paginates one slide per page at the exact canvas
// dimensions (1920×1080 landscape for 16:9, 1080×1920 portrait
// for 9:16).
//
// Deliberately sync — the toolbar button spins for the ~3-10s the
// render takes; no Inngest job, no storage upload, no notification
// dependency. Matches the PNG export UX (chunk D).
//
// Auth: owner-only (matches the rest of /api/projects/[id]/*).
// Runtime: Node (Puppeteer requires it). 60s max — should comfortably
// cover 5-25 slides; longer decks would benefit from the async path
// planned for step 15.7 + concurrency.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
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

// Strips characters that can't ride into a Content-Disposition
// filename across Windows + macOS + Linux. The project title is
// user-controlled (deck rename API) — never trust it raw.
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
// headers must be ByteStrings (every char ≤ 255), so the raw
// `filename="..."` parameter can't carry the user's title verbatim.
// The dual-parameter shape gives modern browsers a UTF-8 percent-
// encoded `filename*` while preserving an ASCII fallback for ancient
// clients that don't understand the encoded variant. Same fix the
// PNG export route now uses.
function contentDispositionAttachment(displayName: string): string {
  // ASCII fallback: replace any non-ASCII rune with "_". Browsers
  // that ignore filename* (rare today) get this as the download name.
  const ascii = displayName.replace(/[^\x20-\x7E]+/g, "_");
  // RFC 6266 says: literal quoted-string for `filename`, RFC 5987
  // ext-value for `filename*` (UTF-8, percent-encoded). The
  // ascii fallback ALSO needs its quotes / backslashes escaped if
  // they ever sneak through — safeFileName already strips quotes
  // upstream so a simple direct interpolation is safe.
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    displayName,
  )}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimited(`export-pdf:${clientIp(request)}`, 30, 5 * 60_000);
  if (limited) return limited;
  const { id: projectId } = await params;
  // Phase 15.A — view access required (exports allowed for every
  // role that can see the deck per product direction). Trade-off
  // CR flagged: this synchronous Puppeteer route holds a request
  // open for up to 60s, so a malicious authenticated user with
  // view-only access could spam exports. Mitigations are layered
  // outside this route: (a) the `(app)` layout requires auth so
  // truly public DoS isn't possible — only signed-in invitees can
  // reach here; (b) the `useExportActions` hook has a per-projectId
  // shared `busy` lock that prevents the same user from firing
  // parallel exports from the UI; (c) Vercel's per-function timeout
  // hard-caps cost per request. If abuse surfaces in practice we'll
  // queue this behind Inngest + per-user rate limit; for now the
  // simpler synchronous path stays.
  const access = await resolveProjectAccess(projectId, "view");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Resolve project + version. Same fallback logic as the PNG route:
  // prefer the user's pinned `savedVersionId`, fall back to
  // `currentVersionId` for an unsaved in-flight regen.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      presentation: {
        include: {
          versions: { select: { id: true, slideJson: true } },
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
  // `printPageBreaks: true` is the key difference vs. the PNG route.
  // The builder emits `@page { size: <canvasW>px <canvasH>px;
  // margin: 0 }` + `.hx-slide { page-break-after: always }` so
  // `page.pdf()` produces a multi-page PDF, one slide per page at
  // the exact canvas dimensions. No per-slide loop here — Puppeteer
  // does the pagination from the CSS.
  const html = buildHtmlDocumentServer(manifest, { printPageBreaks: true });

  const browser = await launchGuardedBrowser();
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await guardPageEgress(page);
    // Viewport size matches a single slide so element layout
    // settles before pagination kicks in. The actual PDF page size
    // is driven by `page.pdf({ width, height })` below; viewport
    // here only governs in-DOM rendering, not pagination.
    await page.setViewport({
      width: canvasW,
      height: canvasH,
      deviceScaleFactor: 1,
    });
    // `networkidle2` instead of `networkidle0` — Google Fonts ride
    // multiple long-lived HTTP/2 streams and sometimes never get to
    // zero connections. `idle2` (≤2 connections) settles reliably
    // while still ensuring the bulk of the network is done. The
    // explicit `document.fonts.ready` await below is the actual
    // font-loaded gate.
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle2"],
      timeout: 30_000,
    });
    // Wait for webfonts to settle. `networkidle2` resolves before
    // `document.fonts.ready` for late-loaded fonts; without this
    // the first page renders fallback typography (Arabic deck
    // would Cairo → system Tahoma).
    await page.evaluate(() => {
      const docFonts = (
        document as Document & { fonts?: { ready?: Promise<unknown> } }
      ).fonts;
      return docFonts?.ready ?? Promise.resolve();
    });
    // Belt-and-braces: ensure the layout has settled at least one
    // animation frame after fonts are ready. Some Chrome builds
    // queue layout work post-font-load that page.pdf would
    // otherwise capture mid-relayout.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    // Page dimensions in INCHES instead of px — `page.pdf()` quirks
    // with px units on portrait dimensions (the 9:16 case
    // ended up returning 0-byte PDFs on first attempt, user-flagged
    // 2026-05-21). Inches are PDF-native (PDF page coordinates are
    // measured in points = 1/72in), so converting up-front avoids
    // any Chrome-side unit-conversion edge cases. 1 CSS px = 1/96in.
    const pxToIn = (px: number): string => `${px / 96}in`;
    // Puppeteer >= 22 returns `Uint8Array<ArrayBufferLike>` from
    // `page.pdf()`. Cast through Buffer to keep the downstream
    // Blob construction type-clean.
    const raw = await page.pdf({
      width: pxToIn(canvasW),
      height: pxToIn(canvasH),
      // Preserve slide background colours — Puppeteer's print path
      // strips them by default (matches Chrome's print preview).
      printBackground: true,
      // No header / footer chrome.
      displayHeaderFooter: false,
      // Margin zero so slides reach the page edge.
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    pdfBuffer = Buffer.from(raw);
  } catch (err) {
    // Bubble the real error to the client so we're not staring at
    // a generic 500. The toolbar's toast filter surfaces this
    // message verbatim. Server log keeps the full stack for trace.
    console.error("[export/pdf] render failed", {
      projectId,
      versionId,
      format: manifest.format,
      slides: manifest.slides.length,
      canvasW,
      canvasH,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await closeGuardedBrowser(browser);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `PDF render failed: ${err.message}`
            : "PDF render failed",
      },
      { status: 500 },
    );
  }
  await closeGuardedBrowser(browser);

  const baseName = safeFileName(project.title || manifest.title, "presentation");
  const filename = `${baseName}.pdf`;
  // Wrap in Blob for an unambiguous BodyInit (same TS-strict reason
  // the PNG route does it).
  const body = new Blob([new Uint8Array(pdfBuffer)], {
    type: "application/pdf",
  });
  // Conversion-funnel step 3/4: a successful export. distinctId = Supabase uid.
  if (access.user.id) {
    captureServerEvent(access.user.id, "deck_exported", {
      project_id: projectId,
      format: "pdf",
      slide_count: manifest.slides.length,
    });
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(filename),
      // One-shot blob; no value to cache.
      "Cache-Control": "no-store",
    },
  });
}
