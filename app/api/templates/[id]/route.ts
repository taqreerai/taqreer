// DELETE /api/templates/[id]
//
// Hard-delete a template the user owns. Mirrors /api/projects/[id]
// DELETE in structure:
//   1. Owner check via Prisma (findFirst with the user.id constraint)
//      so we don't leak existence of templates owned by others.
//   2. Best-effort storage cleanup of the render artifacts the Inngest
//      job wrote to the slide-previews bucket (per-slide WebP thumbnails
//      + deck.pdf) — log + carry on if storage flakes; an orphaned file
//      is preferable to "DB row gone but tile still rendering because
//      storage 500'd".
//   3. Atomic `deleteMany({ where: { id, ownerId } })` so a TOCTOU
//      flip between findFirst and delete doesn't drop someone else's
//      row.
//
// Storage prefix: `${supabaseUserId}/templates/${templateId}/` —
// shape set by inngest/functions/template-render.ts. The file set is
// variable (one WebP per real slide + a deck.pdf), so cleanup lists the
// prefix and removes whatever it finds.
//
// No soft-delete column. Deletion is permanent; the 3-dots menu's
// confirm dialog gates the destructive action client-side.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAdminSupabaseUser } from "@/lib/api/admin-context";
import {
  revalidateTemplateSurfaces,
  templateDetailPaths,
} from "@/lib/auth/marquee-projects";

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

  // Admins can delete any template (full ownership); everyone else is scoped
  // to their own. The owner filter also hides existence from non-owners.
  const admin = await isAdminSupabaseUser(user.id);
  const scope = admin
    ? { id: templateId }
    : { id: templateId, owner: { supabaseUserId: user.id } };

  const template = await prisma.template.findFirst({
    where: scope,
    select: {
      id: true,
      isPublic: true,
      slug: true,
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

  const deleted = await prisma.template.deleteMany({ where: scope });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Deleting a PUBLIC template removes it from the public surfaces, so purge
  // them. A private template was never shown there -> skip the purge. The
  // deleted row's slug is gone from the fresh-slug query, so its detail URLs
  // must ride along explicitly or the edge keeps serving them until s-maxage.
  if (template.isPublic) {
    await revalidateTemplateSurfaces(
      template.slug ? templateDetailPaths(template.slug) : [],
    );
  }

  return NextResponse.json({ ok: true });
}
