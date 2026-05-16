import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedBuckets = new Set(["source-files", "brand-assets"]);

function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "-");
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    }

    const admin = createSupabaseAdminClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const path = `${user.id}/create/${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
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
