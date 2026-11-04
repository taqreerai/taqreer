// GET /api/admin/projects/[id]/source
//
// Admin only. Where a deck's original upload is, with a short-lived download
// link. Every read is logged: this opens a user's private file.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { findSourceFile, SOURCE_FILES_BUCKET, SOURCE_RETENTION_DAYS } from "@/lib/admin/source-file";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const PROJECT_ID_RE = /^[a-z0-9]{8,40}$/i;
const LINK_TTL_S = 10 * 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  if (!PROJECT_ID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });

  const source = await findSourceFile(id);
  if (!source) return NextResponse.json({ available: false, reason: "no-upload" });

  const fileName = source.path.split("/").pop() ?? "source";
  const { data, error } = await getSupabaseAdmin()
    .storage.from(SOURCE_FILES_BUCKET)
    .createSignedUrl(source.path, LINK_TTL_S, { download: fileName });
  if (error || !data?.signedUrl) {
    return NextResponse.json({
      available: false,
      reason: "purged",
      uploadedAt: source.uploadedAt,
      retentionDays: SOURCE_RETENTION_DAYS,
    });
  }
  console.info("[admin] source file opened", { projectId: id, adminId: ctx.userId });
  return NextResponse.json({
    available: true,
    url: data.signedUrl,
    fileName,
    mime: source.mime,
    uploadedAt: source.uploadedAt,
    retentionDays: SOURCE_RETENTION_DAYS,
  });
}
