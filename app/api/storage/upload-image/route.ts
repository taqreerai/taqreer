// Replace-image upload for the in-canvas editor pill (I2.5). Takes a raster
// image, stores it in the PUBLIC `generated-images` bucket under the caller's
// `uploads/<userId>/…` namespace, and returns a permanent public URL that gets
// written straight into the saved slide HTML (so it must outlive signed URLs).
//
// Security posture:
//   • auth-gated — anonymous callers get 401.
//   • raster-only MIME allowlist (no SVG → no inline-script / stored-XSS).
//   • byte-signature sniffing — the multipart header MIME (file.type) is
//     client-forgeable, so the REAL gate is the magic bytes; we store under the
//     detected type, not the claimed one.
//   • size cap — rejects oversized payloads.
//   • path is namespaced to the Supabase user id, so no cross-user writes.

import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { storeUploadedImage } from "@/lib/images/store";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Detect a raster image from its magic bytes; null = not a recognised raster.
// This is what actually decides the stored content type — never the client header.
function sniffImageType(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png"; // \x89PNG
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif"; // GIF8(7a|9a)
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export async function POST(request: Request) {
  const limited = rateLimited(`upload-image:${clientIp(request)}`, 60, 5 * 60_000);
  if (limited) return limited;
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
    // The real gate: verify the bytes ARE the raster they claim to be. A forged
    // `image/png` header over arbitrary bytes is rejected here, and we store
    // under the SNIFFED type so the public URL can never mislabel content.
    const sniffed = sniffImageType(bytes);
    if (!sniffed || !ALLOWED_TYPES.has(sniffed)) {
      return NextResponse.json(
        { error: "File contents are not a supported image (PNG, JPEG, WebP, or GIF)." },
        { status: 400 },
      );
    }
    const url = await storeUploadedImage({ userId: user.id, bytes, contentType: sniffed });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("upload-image error:", error);
    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
  }
}
