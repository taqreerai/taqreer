// GET /api/admin/settings/models - the live Anthropic model list for the admin
// preset picker. Admin-only. `?refresh=1` busts the 5-minute in-process cache
// (lib/anthropic/models.ts) so a brand-new model shows up immediately instead of
// on the next TTL turnover. Read-only: no config is mutated here.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api/admin-context";
import { listModels } from "@/lib/anthropic/models";

export async function GET(request: Request) {
  const ctx = await requireAdminApi();
  if ("error" in ctx) return ctx.error;
  try {
    const force =
      new URL(request.url).searchParams.get("refresh") === "1";
    const models = await listModels({ force });
    return NextResponse.json({ models });
  } catch (err) {
    // listModels already degrades to cache/[] internally; this is belt and
    // braces so the picker never 500s the modal.
    console.error("[settings/models] list failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
