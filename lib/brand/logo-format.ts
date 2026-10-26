// Logo formats (client-safe). SVG is preferred: a monochrome SVG is recoloured
// per slide for contrast. PNG / JPG / WebP are accepted too (2026-10-26) and
// always keep their own colours, so previews never flatten them to a
// silhouette (`.logo-monochrome` would turn an opaque PNG into a white block).
// The upload route re-checks the real type from the file's bytes.

export const LOGO_ACCEPT = ".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp";

const RASTER_TYPE = /^image\/(png|jpeg|webp)$/i;
const RASTER_EXT = /\.(png|jpe?g|webp)$/i;
const SVG_EXT = /\.svg$/i;

/** True when a picked logo file is one of the accepted formats. */
export function isAcceptedLogoFile(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    SVG_EXT.test(file.name) ||
    RASTER_TYPE.test(file.type) ||
    RASTER_EXT.test(file.name)
  );
}

/** True for a raster logo, from a picked File or a stored / signed URL. */
export function isRasterLogo(src: File | string | null | undefined): boolean {
  if (!src) return false;
  if (typeof src !== "string") return RASTER_TYPE.test(src.type) || RASTER_EXT.test(src.name);
  // Signed URLs carry a query string; only the path decides.
  return RASTER_EXT.test(src.split(/[?#]/)[0]);
}
