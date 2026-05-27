// POST /api/datasheet/parse — synchronous spreadsheet → Markdown.
//
// /datasheet's content card uploads xlsx/xls/csv here and the route
// returns the parsed Markdown payload in a single response. Unlike
// /api/extract (which fires an Inngest job + has the client poll),
// this route runs the parse inline because:
//   • SheetJS is CPU-light — 5 MB xlsx parses in <300 ms on a Vercel
//     edge node
//   • There's no LibreOffice / Anthropic-upload roundtrip — no I/O
//     wait that would benefit from durable retries
//   • The output isn't a file_id we need to store; it's a string
//     that goes straight into the deck-generate prompt
// Inngest would just add latency + a polling UI for no upside.
//
// ─── Why parse server-side instead of in the browser ──────────────
// Putting `xlsx` in the client bundle adds ~500 KB minified to every
// page that imports it, even tree-shaken (the package is mostly one
// big file). Keeping it on the server keeps the /datasheet page
// lean and lets us share the limits / sanitizer with future flows.
//
// ─── Trust + size limits ──────────────────────────────────────────
// Auth-gated (same `getUser()` round-trip every other route uses) so
// only logged-in users can hit the parser. 25 MB cap (smaller than
// /api/extract's 100 MB because xlsx in-memory is heavier than PDF
// bytes — a 25 MB xlsx can easily produce a 200 MB DOM tree once
// SheetJS hydrates it). Allowlist enforced via MIME + extension
// fallback (same pattern /api/extract uses).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseDatasheet } from "@/lib/extract/datasheet";

// Smaller than /api/extract's 100 MB — see note at top of file.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// xlsx/xls/csv canonical MIME types. Some browsers (Safari, drag/
// drop from Finder) ship empty `file.type`, so we ALSO fall back
// to the filename extension before rejecting.
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

// No outer try/catch wrapping the orchestration — Next.js already
// converts unhandled promise rejections to 500 with the failing
// request's frame intact in dev. The only domain-specific failure
// mode (SheetJS choking on a malformed/protected file) gets its
// own narrow catch around `parseDatasheet` so we can surface an
// Arabic-localized 400 instead of a generic 500. Project convention:
// no try/catch around orchestration logic — let unexpected throws
// surface so genuine bugs aren't masked as "Failed to parse" 500s.
export async function POST(request: Request) {
  // ─── Auth ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Parse multipart body ────────────────────────────────────────
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `الملف يتجاوز الحد الأقصى 25 ميجابايت (${(file.size / 1024 / 1024).toFixed(1)} م.ب).`,
      },
      { status: 400 },
    );
  }

  // ─── Resolve canonical MIME ──────────────────────────────────────
  // Same allowlist-with-extension-fallback pattern /api/extract uses
  // — see comments there for the rationale (Safari + drag/drop often
  // ship empty `file.type`).
  let resolvedMime = file.type;
  if (!ALLOWED_MIME.has(file.type)) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx")) {
      resolvedMime =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (lower.endsWith(".xls")) {
      resolvedMime = "application/vnd.ms-excel";
    } else if (lower.endsWith(".csv")) {
      resolvedMime = "text/csv";
    } else {
      return NextResponse.json(
        { error: "صيغة غير مدعومة. ارفع ملف .xlsx أو .xls أو .csv." },
        { status: 400 },
      );
    }
  }

  // ─── Parse ───────────────────────────────────────────────────────
  // parseDatasheet is synchronous + pure — no I/O. The narrow try
  // catches SheetJS exceptions (malformed file, password-protected,
  // legacy xls that requires the binary loader) and surfaces them
  // as a 400 with a clear Arabic message instead of a 500.
  const buffer = Buffer.from(await file.arrayBuffer());
  let result;
  try {
    result = parseDatasheet({
      buffer,
      mime: resolvedMime,
      fileName: file.name,
    });
  } catch (err) {
    console.error("[datasheet] parse failed:", err);
    return NextResponse.json(
      { error: "تعذر قراءة الملف. تأكد من أنه ليس محمياً بكلمة مرور." },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}
