// DELETE /api/templates/[id]
//
// Hard-delete a template the user owns. Mirrors /api/projects/[id]
// DELETE in structure:
//   1. Owner check via Prisma (findFirst with the user.id constraint)
//      so we don't leak existence of templates owned by others.
//   2. Best-effort storage cleanup of the 4 showcase PNGs the
//      Inngest job wrote to the slide-previews bucket — log + carry
//      on if storage flakes; an orphaned PNG is preferable to "DB
//      row gone but tile still rendering because storage 500'd".
//   3. Atomic `deleteMany({ where: { id, ownerId } })` so a TOCTOU
//      flip between findFirst and delete doesn't drop someone else's
//      row.
//
// Storage prefix: `${supabaseUserId}/templates/${templateId}/` —
// shape set by inngest/functions/template-showcase-render.ts.
// Templates have a fixed 4-file footprint (no per-version subtree
// like projects), so cleanup is a single list + remove.
//
// No soft-delete column. Deletion is permanent; the 3-dots menu's
// confirm dialog gates the destructive action client-side.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

const TEMPLATE_BUCKET = "slide-previews";

export async function DELETE(
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

  const { id: templateId } = await params;

  const template = await prisma.template.findFirst({
    where: {
      id: templateId,
      owner: { supabaseUserId: user.id },
    },
    select: {
      id: true,
      owner: { select: { supabaseUserId: true } },
    },
  });
  if (!template || !template.owner.supabaseUserId) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const supabaseUserId = template.owner.supabaseUserId;

  // Storage cleanup — best-effort. See /api/projects/[id] DELETE for
  // the rationale. Templates' path is flat (no per-version subtree),
  // so a single list + remove suffices.
  try {
    const admin = createSupabaseAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const prefix = `${supabaseUserId}/templates/${templateId}`;
    const listResult = await admin.storage
      .from(TEMPLATE_BUCKET)
      .list(prefix, { limit: 1000 });
    if (listResult.error) throw listResult.error;
    const filePaths = (listResult.data ?? []).map(
      (f) => `${prefix}/${f.name}`,
    );
    if (filePaths.length > 0) {
      const { error: removeError } = await admin.storage
        .from(TEMPLATE_BUCKET)
        .remove(filePaths);
      if (removeError) {
        console.warn(
          "[templates/delete] storage remove failed",
          { templateId, count: filePaths.length, error: removeError.message },
        );
      }
    }
  } catch (err) {
    console.warn("[templates/delete] storage cleanup failed", {
      templateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const deleted = await prisma.template.deleteMany({
    where: {
      id: templateId,
      owner: { supabaseUserId: user.id },
    },
  });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
