// Dev-only fixture for /lab/live-build: real deck HTML kept in the gitignored
// .lab/ folder, never committed or served in production.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const raw = await readFile(path.join(process.cwd(), ".lab", "live-build-fixture.json"), "utf8");
    return new NextResponse(raw, { headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "No fixture in .lab/live-build-fixture.json" }, { status: 404 });
  }
}
