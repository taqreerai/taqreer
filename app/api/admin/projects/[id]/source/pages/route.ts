// GET /api/admin/projects/[id]/source/pages
//
// Admin only. The original upload rendered page by page for the compare page.
// Rendered on request and never stored, so nothing outlives the upload's own
// 7 day retention. Every read is logged.

import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdminApi } from "@/lib/api/admin-context";
import { findSourceFile } from "@/lib/admin/source-file";
import { sourceToSlideImages } from "@/lib/extract/source-to-slide-images";

const PROJECT_ID_RE = /^[a-z0-9]{8,40}$/i;
const MAX_PAGES = 60;
const PAGE_WIDTH = 1280;
const PARALLEL = 4;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  if (!PROJECT_ID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });

  const source = await findSourceFile(id);
  if (!source) return NextResponse.json({ error: "No upload for this deck" }, { status: 404 });

  let pngs: Buffer[];
  try {
    pngs = await sourceToSlideImages(source.path, source.mime);
  } catch (err) {
    console.warn("[admin] source pages failed", { projectId: id, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Could not render this file. It may have been purged, use the download link." }, { status: 422 });
  }
  console.info("[admin] source pages opened", { projectId: id, adminId: ctx.userId, pages: pngs.length });

  const shown = pngs.slice(0, MAX_PAGES);
  const pages: string[] = new Array(shown.length);
  for (let i = 0; i < shown.length; i += PARALLEL) {
    await Promise.all(
      shown.slice(i, i + PARALLEL).map(async (png, k) => {
        const webp = await sharp(png).resize(PAGE_WIDTH, undefined, { withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        pages[i + k] = `data:image/webp;base64,${webp.toString("base64")}`;
      }),
    );
  }
  return NextResponse.json({ pages, total: pngs.length }, { headers: { "Cache-Control": "no-store" } });
}
