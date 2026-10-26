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
const MAX_RASTER_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

// Raster logos (2026-10-26): accepted next to SVG, identified by their
// leading bytes rather than the client-supplied type or name. They skip the
// per-slide recolour and are placed as a true-colour <img> (the same marker
// path a multicolour SVG takes in deck-generate).
function rasterLogoType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

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
      return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }
    if (await isBannedSupabaseUser(user.id)) {
      return NextResponse.json({ error: "Account suspended", code: "suspended" }, { status: 403 });
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
          code: "file_too_large",
        },
        { status: 400 },
      );
    }

    // The raw file is stored by default; the logo branch below may swap in a
    // viewBox-normalized copy.
    let uploadBody: File | Buffer = file;
    let uploadContentType = file.type || "application/octet-stream";

    // Folder-level format gating for the brand-assets/logos path. SVG stays
    // the preferred format (a mono SVG is recoloured per slide for contrast);
    // PNG / JPG / WebP are accepted too since 2026-10-26 and placed as-is.
    // The client picker restricts the dialog, but a caller can bypass it, so
    // the type is re-checked here from the file's own bytes.
    if (bucket === "brand-assets" && folder === "logos") {
      const isSvgMime = file.type === "image/svg+xml";
      const isSvgExt = file.name.toLowerCase().endsWith(".svg");
      if (!isSvgMime && !isSvgExt) {
        const raster = rasterLogoType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        if (!raster) {
          return NextResponse.json(
            { error: "Logo must be an SVG, PNG, JPG or WebP image.", code: "logo_type" },
            { status: 400 },
          );
        }
        if (file.size > MAX_RASTER_LOGO_BYTES) {
          return NextResponse.json(
            { error: "Logo exceeds the 5 MB limit.", code: "logo_too_large" },
            { status: 400 },
          );
        }
        uploadContentType = raster;
      } else {
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
      return NextResponse.json({ error: uploadError.message, code: "upload_failed" }, { status: 500 });
    }

    return NextResponse.json({
      name: file.name,
      storageUrl: path,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error("Storage upload error:", error);
    return NextResponse.json({ error: "Failed to upload file", code: "upload_failed" }, { status: 500 });
  }
}
