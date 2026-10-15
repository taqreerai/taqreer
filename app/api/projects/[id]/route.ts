// PATCH + DELETE /api/projects/[id]
//
// PATCH: rename. Body { title: string }. Trimmed + length-capped server
// side; returns the canonical stored title so the client can replace
// its optimistic value.
//
// DELETE: hard delete. Cascades through Project FKs (Presentation →
// Versions → SlideStates → SlideVersions, Jobs, Files, Comments,
// ProjectShares — every relation is configured `onDelete: Cascade` in
// schema.prisma). Also wipes the project's thumbnail subtree from the
// `slide-previews` storage bucket so we don't leak public files for a
// project the user just trashed. No soft-delete column — projects.md
// locked this as hard delete + confirmation modal client-side.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAdminSupabaseUser } from "@/lib/api/admin-context";
import { removeProjectSourceAssets } from "@/lib/storage/source-assets";

// Same bucket the thumbnail-render Inngest function writes to.
// Path convention: ${supabaseUserId}/${projectId}/${savedVersionId}/${slideKey}.webp
// so a single `list({ prefix })` walks every saved-version subtree
// for a single project.
const THUMBNAIL_BUCKET = "slide-previews";

// 200 chars matches the existing /api/projects POST validation +
// what the dashboard tile can show without breaking the layout.
// Trimmed first; falls back to "Untitled" if the user submits all
// whitespace (matches the "" → fallback pattern in deck-generate).
const MAX_TITLE_LENGTH = 200;

type RenamePayload = {
  title?: string;
};

export async function PATCH(
  request: Request,
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

  // Strict body parsing — matches the lock / regen / favorite contract.
  const rawText = await request.text();
  if (rawText.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body required" },
      { status: 400 },
    );
  }
  let body: RenamePayload | null = null;
  try {
    body = JSON.parse(rawText) as RenamePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || typeof body.title !== "string") {
    return NextResponse.json(
      { error: "title must be a string" },
      { status: 400 },
    );
  }

  const trimmed = body.title.trim().slice(0, MAX_TITLE_LENGTH);
  // Empty after trim → reject. We don't auto-fall-back to "Untitled"
  // here because the user's intent was explicit (they typed an empty
  // string and hit Enter). The dashboard's inline-rename input
  // should mirror this with a min-length check, but server-side
  // is the contract.
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "Title cannot be empty" },
      { status: 400 },
    );
  }

  // Admins can rename any project (full ownership); everyone else is scoped to
  // their own. `updateMany` stays atomic on the resolved scope.
  const admin = await isAdminSupabaseUser(user.id);
  const scope = admin
    ? { id: projectId }
    : { id: projectId, user: { supabaseUserId: user.id } };
  const result = await prisma.project.updateMany({
    where: scope,
    data: { title: trimmed },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, title: trimmed });
}

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

  const { id: projectId } = await params;

  // Admins can delete any project (full ownership); everyone else is scoped to
  // their own. The owner filter also serves existence-hiding for non-owners.
  const admin = await isAdminSupabaseUser(user.id);
  const scope = admin
    ? { id: projectId }
    : { id: projectId, user: { supabaseUserId: user.id } };

  // Verify access BEFORE deleting anything. `findFirst` returns null on
  // wrong-owner / missing project; both surface as 404 to the client so we
  // don't leak project existence to non-owners.
  const project = await prisma.project.findFirst({
    where: scope,
    select: {
      id: true,
      user: { select: { supabaseUserId: true } },
    },
  });
  if (!project || !project.user.supabaseUserId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const supabaseUserId = project.user.supabaseUserId;

  // Storage cleanup. Best-effort: a failure here logs but doesn't
  // abort the DB delete — the alternative (DB row gone, files
  // orphaned in storage) is preferable to "tile still on dashboard
  // because storage flaked" (the user already saw the confirmation
  // modal and committed to the destructive action).
  //
  // `list` is recursive when given a prefix without a trailing
  // slash — returns objects across every saved-version subtree.
  // We page through up to 1 000 results per call; a project would
  // need 1 000 thumbnails (= 200 saves × 5-slide deck) to overflow,
  // far beyond realistic usage. If that ever happens we'd need to
  // loop with `offset`, but it isn't a 9f concern.
  try {
    const admin = createSupabaseAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const prefix = `${supabaseUserId}/${projectId}`;
    // Supabase's `list` is non-recursive — it only returns the
    // immediate children of the given prefix. The actual files
    // live nested deeper (under savedVersionId folders), so we
    // walk the tree: list the project folder → for each
    // versionId subfolder, list its files → collect full paths.
    const versionFolders = await admin.storage
      .from(THUMBNAIL_BUCKET)
      .list(prefix, { limit: 1000 });
    const filePaths: string[] = [];
    if (versionFolders.error) {
      throw versionFolders.error;
    }
    for (const folder of versionFolders.data ?? []) {
      // Each entry under `${userId}/${projectId}/` is a savedVersionId
      // folder. `folder.id === null` is Supabase's convention for
      // "this is a folder, not a leaf object" — though in practice
      // we should just try listing each entry as a prefix; non-folder
      // leaves would yield an empty list rather than an error.
      const inner = await admin.storage
        .from(THUMBNAIL_BUCKET)
        .list(`${prefix}/${folder.name}`, { limit: 1000 });
      if (inner.error) {
        console.warn(
          "[projects/delete] list inner failed",
          { projectId, folder: folder.name, error: inner.error.message },
        );
        continue;
      }
      for (const file of inner.data ?? []) {
        filePaths.push(`${prefix}/${folder.name}/${file.name}`);
      }
    }
    if (filePaths.length > 0) {
      const { error: removeError } = await admin.storage
        .from(THUMBNAIL_BUCKET)
        .remove(filePaths);
      if (removeError) {
        console.warn(
          "[projects/delete] storage remove failed",
          { projectId, count: filePaths.length, error: removeError.message },
        );
      }
    }
  } catch (err) {
    // Log + carry on — DB delete still proceeds. Orphaned thumbnails
    // are cosmetic + cheap to ignore; a half-finished delete that
    // leaves the project on the dashboard is the worse outcome.
    console.warn("[projects/delete] storage cleanup failed", {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Carried-over source assets (private bucket, Enhance phase 1). Same
  // best-effort contract as the thumbnails above.
  const assetCleanupError = await removeProjectSourceAssets(projectId);
  if (assetCleanupError) {
    console.warn("[projects/delete] source asset cleanup failed", {
      projectId,
      error: assetCleanupError,
    });
  }

  // Hard delete — cascades to Presentation (and its Versions /
  // SlideStates / SlideVersions), Jobs, Files, Comments, and
  // ProjectShares (when the share model lands in step 15).
  // `deleteMany` with the owner constraint instead of plain
  // `delete({ where: { id } })` closes a TOCTOU gap: if ownership
  // somehow flipped between the findFirst check above and this
  // write, deleting solely by id could drop a project that's
  // no longer ours. The where clause makes the destructive write
  // atomic on (id, owner) — count=0 if either changed, and we
  // 404 instead of silently destroying state.
  const deleted = await prisma.project.deleteMany({ where: scope });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
