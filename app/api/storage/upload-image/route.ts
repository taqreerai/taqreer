// Replace-image upload for the in-canvas editor pill (I2.5). Takes a raster
// image, stores it in the PUBLIC `generated-images` bucket under the caller's
// `uploads/<userId>/…` namespace, and returns a permanent public URL that gets
// written straight into the saved slide HTML (so it must outlive signed URLs).
//
// Security posture:
//   • auth-gated — anonymous callers get 401.
//   • raster-only MIME allowlist (no SVG → no inline-script / stored-XSS).
//   • size cap — rejects oversized payloads.
//   • path is namespaced to the Supabase user id, so no cross-user writes.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeUploadedImage } from "@/lib/images/store";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported image type — use PNG, JPEG, WebP, or GIF." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large (max 10 MB)." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const url = await storeUploadedImage({ userId: user.id, bytes, contentType: file.type });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("upload-image error:", error);
    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
  }
}
