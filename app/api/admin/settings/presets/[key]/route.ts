// PATCH/DELETE /api/admin/settings/presets/[key] - admin edits or removes a
// preset. Admin-only. DELETE is blocked when it would leave any tier with no
// active preset (settings-mutations.ts guards the invariant).

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import {
  updatePreset,
  deletePreset,
  parsePresetInput,
  ValidationError,
} from "@/lib/config/settings-mutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  const { key } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await updatePreset(ctx.userId, key, parsePresetInput(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/presets] update failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  const { key } = await params;
  try {
    await deletePreset(ctx.userId, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/presets] delete failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
