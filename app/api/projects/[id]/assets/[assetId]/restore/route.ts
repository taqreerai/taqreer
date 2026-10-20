// POST /api/projects/[id]/assets/[assetId]/restore
//
// Studio "Enhance with AI" on a carried original photo (Enhance flow, private
// source-assets bucket). Owner rule 2026-10-15: an original picture is never
// swapped, only enhanced keeping its subject, so the model receives the photo
// itself (lib/images/gpt-image restorePhoto) and may only repair it. The result
// is stored as a NEW asset of the same project; the studio points the <img> at
// it and keeps the original for "Restore original". Nothing is overwritten.
//
// Edit access, paid plans (or admin) only, rate-limited, photos only (diagrams
// and scanned pages must keep their exact pixels).

import { NextResponse } from "next/server";
import sharp from "sharp";
import { rateLimited } from "@/lib/api/rate-limit";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { prisma } from "@/lib/prisma";
import { isPaidPlan } from "@/lib/plan";
import { restorePhoto } from "@/lib/images/gpt-image";
import { pictureKind } from "@/lib/extract/photo-enhance";
import {
  isValidSourceAssetRef,
  readSourceAsset,
  uploadSourceAsset,
} from "@/lib/storage/source-assets";

export const runtime = "nodejs";
// The image model takes 20 to 60 s; nginx allows 300 s.
export const maxDuration = 180;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await params;
  if (!isValidSourceAssetRef(projectId, assetId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const user = access.user.prismaId
    ? await prisma.user.findUnique({ where: { id: access.user.prismaId }, select: { plan: true, role: true } })
    : null;
  if (!user || (user.role !== "admin" && !isPaidPlan(user.plan))) {
    return NextResponse.json({ error: "photo_enhance_locked" }, { status: 402 });
  }

  const limited = rateLimited(`photo-restore:${access.user.id}`, 10, 10 * 60_000);
  if (limited) return limited;

  const src = await readSourceAsset(projectId, assetId);
  if (!src || src.bytes.byteLength === 0 || src.bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if ((await pictureKind(src.bytes)) !== "photo") {
    return NextResponse.json({ error: "not_a_photo" }, { status: 422 });
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(src.bytes).metadata();
  } catch {
    return NextResponse.json({ error: "not_a_photo" }, { status: 422 });
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return NextResponse.json({ error: "not_a_photo" }, { status: 422 });

  try {
    // The model accepts PNG / JPEG / WebP; send a PNG of the photo as stored.
    const input = await sharp(src.bytes).rotate().png().toBuffer();
    const out = await restorePhoto({ bytes: input, contentType: "image/png", aspect: w / h });
    // Back to the photo's own proportions (the model works at fixed sizes),
    // long edge at least 1200 (small originals come back larger) and at most
    // 2400, like the carried crops.
    const long = Math.min(2400, Math.max(1200, w, h));
    const tw = Math.max(1, Math.round(w >= h ? long : (long * w) / h));
    const th = Math.max(1, Math.round((tw * h) / w));
    const jpeg = await sharp(Buffer.from(out.b64, "base64"))
      .resize(tw, th, { fit: "cover", position: "centre" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    const base = assetId.replace(/-ai[a-z0-9]{1,12}$/, "");
    const newId = `${base}-ai${Date.now().toString(36)}`.slice(0, 64);
    await uploadSourceAsset({ projectId, assetId: newId, bytes: jpeg, contentType: "image/jpeg" });
    console.info("[photo-restore]", { projectId, assetId, newId, size: out.size });
    return NextResponse.json({ assetId: newId, src: `/api/assets/${projectId}/${newId}` });
  } catch (err) {
    console.error("[photo-restore] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "restore_failed" }, { status: 502 });
  }
}
