// PATCH /api/admin/settings/platform - admin edits platform-wide pricing
// knobs: imageCredits (per-generated-image surcharge) and regenBaseCredits
// (flat base per partial/slide regen run, the regen's own review bake).
// Admin-only.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import {
  updatePlatformSettings,
  ValidationError,
} from "@/lib/config/settings-mutations";

export async function PATCH(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    // NaN for absent/empty input (not 0, which would silently zero a
    // price) - updatePlatformSettings rejects NaN with a 400.
    const num = (v: unknown) => {
      const raw = String(v ?? "").trim();
      return raw === "" ? NaN : Number(raw);
    };
    await updatePlatformSettings(ctx.userId, {
      imageCredits: num(body.imageCredits),
      regenBaseCredits: num(body.regenBaseCredits),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[settings/platform] update failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
