import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isBannedSupabaseUser } from "@/lib/api/ban-check";
import { decodeSvgBytes } from "@/lib/brand/svg-decode";
import { normalizeLogoViewBox } from "@/lib/brand/normalize-logo-svg";

const allowedBuckets = new Set(["source-files", "brand-assets"]);

// Hard ceiling on any single upload. Matches the source-files bucket's
// own fileSizeLimit and the prod nginx client_max_body_size; enforced
// here too so an oversized upload gets a clean 400 instead of a raw
// storage error or an nginx 413.
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

function safeFileName(name: string) {
  // Same sanitizer as /api/extract: no ".." runs in a storage key.
  const cleaned = name.replace(/[^\w.\-]+/g, "-").replace(/\.{2,}/g, ".");
  return /^\.?$/.test(cleaned) ? "file" : cleaned;
}

export async function POST(request: Request) {
  const limited = rateLimited(`upload:${clientIp(request)}`, 60, 5 * 60_000);
  if (limited) return limited;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (await isBannedSupabaseUser(user.id)) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json({ error: "Storage service is not configured" }, { status: 500 });
    }

    const formData = await request.formData();
    const bucket = String(formData.get("bucket") ?? "");
    const folder = String(formData.get("folder") ?? "uploads");
    const file = formData.get("file");

    if (!allowedBuckets.has(bucket)) {
      return NextResponse.json({ error: "Invalid storage bucket" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File exceeds the 100 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        },
        { status: 400 },
      );
    }

    // The raw file is stored by default; the logo branch below may swap in a
    // viewBox-normalized copy.
    let uploadBody: File | Buffer = file;
    let uploadContentType = file.type || "application/octet-stream";

    // Folder-level format gating. The brand-assets/logos path is the logo
    // upload pipeline; per the 2026-05-15 product call we only accept SVG
    // logos so we can recolor per slide for contrast (raster logos can't
    // be recolored without lossy operations). The client-side picker
    // already restricts the file dialog, but a determined caller can
    // bypass the picker — re-enforce here.
    if (bucket === "brand-assets" && folder === "logos") {
      const isSvgMime = file.type === "image/svg+xml";
      const isSvgExt = file.name.toLowerCase().endsWith(".svg");
      if (!isSvgMime && !isSvgExt) {
        return NextResponse.json(
          { error: "Logo must be an SVG file (image/svg+xml)." },
          { status: 400 }
        );
      }
      // Trim any dead margin baked into the logo's viewBox so it fills its
      // reserved box on every slide instead of rendering tiny (see
      // normalizeLogoViewBox). Best-effort: on ANY failure we fall through and
      // store the file verbatim — normalization must never fail an upload.
      try {
        const svgText = decodeSvgBytes(await file.arrayBuffer());
        const normalized = await normalizeLogoViewBox(svgText);
        if (normalized !== svgText) {
          uploadBody = Buffer.from(normalized, "utf-8");
          uploadContentType = "image/svg+xml";
        }
      } catch {
        // keep uploadBody = file
      }
    }

    const admin = createSupabaseAdminClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const path = `${user.id}/create/${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, uploadBody, {
        contentType: uploadContentType,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    return NextResponse.json({
      name: file.name,
      storageUrl: path,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error("Storage upload error:", error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
