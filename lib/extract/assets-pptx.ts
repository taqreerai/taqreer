// Phase 17.A — Embedded image extraction from PPTX files.
//
// PPTX is a zip of XML + media files. The interesting bits:
//
//   ppt/slides/slide{N}.xml
//     Each slide. Contains `<a:blip r:embed="rIdM"/>` elements where
//     rIdM is a relationship reference into the per-slide rels file.
//   ppt/slides/_rels/slide{N}.xml.rels
//     Maps `rIdM` → `../media/imageN.{ext}` (the actual file path
//     relative to the slide file).
//   ppt/media/imageN.{ext}
//     The raw image bytes. Formats: png, jpg, jpeg, gif, svg, emf,
//     wmf. We filter to web-safe formats only (emf/wmf are Windows
//     vector metafiles that browsers don't render).
//
// Output: one entry per unique image, with the set of slide indices
// where it appeared. The dispatcher uploads each to Supabase under
// `project-assets/{projectId}/` and constructs an ExtractedAsset for
// the SourceMeta blob. Same image referenced by multiple slides
// becomes a single asset record (picks the first slide as
// `originalSlide`); the multi-slide debug info is preserved in this
// module's return shape in case downstream UI ever wants it.
//
// ─── Why not use regex on the XML ─────────────────────────────────
// PPTX namespaces are stable in practice (`a:` for drawingml, `r:`
// for relationships) but a regex over the literal `r:embed="..."`
// pattern would silently miss any deck authored by a tool that uses
// different namespace prefixes (rare but possible) and would also
// pick up `r:embed` attributes inside `<p:cNvPr>` decorative blocks.
// The DOM parse via @xmldom/xmldom (already a dep from the HTML-
// pivot work) is the right call.

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

// ─── Public API ────────────────────────────────────────────────────

export type ExtractedPptxAsset = {
  /** Original filename from `ppt/media/`, e.g. "image3.png" */
  fileName: string;
  /** MIME type derived from the extension */
  contentType: string;
  /** Raw bytes — caller uploads to Supabase */
  bytes: Buffer;
  /**
   * 1-based slide indices where this image was referenced. Sorted
   * ascending. Length >= 1 for every returned entry.
   */
  slideIndices: number[];
  /**
   * IDs of PowerPoint shape-groups (`<p:grpSp>`) the image is
   * grouped inside. Each ID is shaped `"slide{N}-group{M}"` where N
   * is the 1-based slide number and M is the 1-based group index
   * within that slide (document order of the OUTERMOST grpSp
   * containing the blip — handles nested groups by collapsing to
   * the top-most).
   *
   * Multiple images sharing the same groupId form a composite
   * element (e.g. a logo made of mark + wordmark). Claude's
   * directive treats them as one unit — keep positioned + scaled
   * together. Empty array when the image isn't inside any group.
   */
  groupIds: string[];
};

/**
 * Walk a PPTX zip, return one entry per unique embedded image with
 * the set of slide indices that referenced it. EMF/WMF and unknown
 * extensions are filtered out — browsers can't render them and the
 * generated HTML would just produce broken <img> tags.
 *
 * Throws if the file isn't a valid zip or doesn't contain a PPTX
 * presentation structure. The caller (API route) is responsible for
 * catching + surfacing a user-friendly "this file isn't a PPTX"
 * error message.
 */
export async function extractAssetsFromPptx(
  pptxBuffer: Buffer,
): Promise<ExtractedPptxAsset[]> {
  const zip = await JSZip.loadAsync(pptxBuffer);

  // Step 1: enumerate `ppt/slides/slide*.xml` entries to learn the
  // slide count + iteration order. PPTX numbers slides 1..N; we
  // walk in numeric order so `slideIndices` ends up sorted by
  // construction.
  const slidePaths = collectSlidePaths(zip);
  if (slidePaths.length === 0) {
    throw new Error(
      "Not a valid PPTX — no slides found under ppt/slides/. " +
        "(File may be corrupted or saved in an older PowerPoint format.)",
    );
  }

  // Step 2: build the assetMap: image-path-in-zip → accumulated
  // metadata (slide indices + group IDs that referenced it).
  type AssetMeta = {
    slideIndices: Set<number>;
    groupIds: Set<string>;
  };
  const assetMap = new Map<string, AssetMeta>();

  for (const slidePath of slidePaths) {
    const slideIndex = slideIndexFromPath(slidePath);
    const slideRelsPath = slidePath
      .replace(/\/slides\//, "/slides/_rels/")
      .replace(/\.xml$/, ".xml.rels");

    const slideRelsFile = zip.file(slideRelsPath);
    if (!slideRelsFile) continue; // no relationships → no embedded images

    const relsXml = await slideRelsFile.async("string");
    const relsMap = parseRelationships(relsXml);

    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const slideXml = await slideFile.async("string");
    const refs = parseEmbeddedRefs(slideXml, slideIndex);

    for (const { rId, groupId } of refs) {
      const target = relsMap.get(rId);
      if (!target) continue;
      // Targets are typically "../media/imageN.ext" relative to the
      // slide file. Resolve to absolute zip path.
      const absolutePath = resolveZipPath(slidePath, target);
      if (!absolutePath.startsWith("ppt/media/")) continue; // safety
      let meta = assetMap.get(absolutePath);
      if (!meta) {
        meta = { slideIndices: new Set(), groupIds: new Set() };
        assetMap.set(absolutePath, meta);
      }
      meta.slideIndices.add(slideIndex);
      if (groupId) meta.groupIds.add(groupId);
    }
  }

  // Step 3: read each image's bytes, drop unsupported formats,
  // build the return list.
  const out: ExtractedPptxAsset[] = [];
  for (const [path, meta] of assetMap) {
    const fileName = path.split("/").pop() ?? path;
    const contentType = mimeForFile(fileName);
    if (!contentType) continue; // unsupported (emf/wmf/unknown)
    const file = zip.file(path);
    if (!file) continue;
    const bytes = Buffer.from(await file.async("uint8array"));
    out.push({
      fileName,
      contentType,
      bytes,
      slideIndices: [...meta.slideIndices].sort((a, b) => a - b),
      groupIds: [...meta.groupIds].sort(),
    });
  }
  return out;
}

// ─── Internals ─────────────────────────────────────────────────────

/**
 * Slides in PPTX live at `ppt/slides/slideN.xml` (N is 1-based).
 * Returns those entries in numeric order — NOT the order JSZip
 * happens to iterate, which is undefined.
 */
function collectSlidePaths(zip: JSZip): string[] {
  const slidePaths: string[] = [];
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(relativePath)) {
      slidePaths.push(relativePath);
    }
  });
  // Sort by the numeric N, not lexicographically (slide10 would
  // come before slide2 under string sort).
  slidePaths.sort((a, b) => slideIndexFromPath(a) - slideIndexFromPath(b));
  return slidePaths;
}

function slideIndexFromPath(slidePath: string): number {
  const match = slidePath.match(/slide(\d+)\.xml$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Parse a slide's `_rels/slideN.xml.rels` file into a Map of
 *   rId → target-path-relative-to-slide.
 *
 * The XML shape:
 *   <Relationships xmlns="http://schemas.openxmlformats.org/...">
 *     <Relationship Id="rId1" Type=".../image" Target="../media/image1.png"/>
 *     ...
 *
 * We don't filter by Type — the caller does its own filter when it
 * fails to find an embedded reference, and including non-image rels
 * here is harmless (they just never get looked up).
 */
function parseRelationships(relsXml: string): Map<string, string> {
  const doc = new DOMParser().parseFromString(relsXml, "text/xml");
  const out = new Map<string, string>();
  // No namespace prefix on `Relationship` in the rels XML — it's
  // the default namespace. getElementsByTagName matches by local
  // name when no prefix is given.
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i += 1) {
    const rel = rels.item(i);
    if (!rel) continue;
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) out.set(id, target);
  }
  return out;
}

/**
 * Walk a slide's main XML, return all `r:embed` attribute values
 * on `<a:blip>` elements PLUS the ID of the outermost `<p:grpSp>`
 * (PowerPoint shape group) the blip lives inside, if any.
 *
 * Picture references in DrawingML always look like:
 *   <p:pic>
 *     <p:blipFill>
 *       <a:blip r:embed="rId1"/>
 *       ...
 *     </p:blipFill>
 *   </p:pic>
 *
 * When the user groups items in PowerPoint (Ctrl+G), shapes get
 * wrapped:
 *   <p:grpSp>
 *     <p:nvGrpSpPr>…</p:nvGrpSpPr>
 *     <p:pic>...<a:blip r:embed="rIdA"/>...</p:pic>
 *     <p:pic>...<a:blip r:embed="rIdB"/>...</p:pic>
 *   </p:grpSp>
 *
 * Multiple blips inside the same grpSp share a groupId so the
 * downstream consumer (deck-generate's directive) can tell Claude
 * "these URLs are one composite element — keep them together."
 *
 * Nested groups collapse to the OUTERMOST: a grpSp inside a grpSp
 * still resolves to its top-most ancestor's ID. The user's mental
 * model is "I selected and grouped these things"; nested-group
 * details aren't useful for re-composition.
 *
 * We collect by walking all `a:blip` tags rather than `p:pic` →
 * `p:blipFill` → `a:blip`, because the same `a:blip` shape can
 * appear inside `a:bgPr` (background fills) or `a:tcPr` (table cell
 * fills) too — those are valid images we want to reuse.
 */
function parseEmbeddedRefs(
  slideXml: string,
  slideIndex: number,
): Array<{ rId: string; groupId: string | null }> {
  const doc = new DOMParser().parseFromString(slideXml, "text/xml");
  // `a:blip` is the prefix-qualified tag name. xmldom matches by
  // raw tag name including the prefix.
  const blips = doc.getElementsByTagName("a:blip");
  // Map of grpSp Element → assigned groupId. Filled lazily as we
  // encounter blips; ensures every blip inside the same outermost
  // grpSp gets the SAME ID even though we discover them via
  // separate ancestor walks.
  type Node = Element & { parentNode: Node | null; nodeName: string };
  const groupIdMap = new Map<Node, string>();
  let nextGroupNum = 0;

  const out: Array<{ rId: string; groupId: string | null }> = [];
  for (let i = 0; i < blips.length; i += 1) {
    const blip = blips.item(i);
    if (!blip) continue;

    // PREFER SVG OVER RASTER FALLBACK.
    // PowerPoint stores embedded SVG with a PNG fallback nested
    // inside the `<a:blip>`:
    //   <a:blip r:embed="rId-PNG">
    //     <a:extLst>
    //       <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
    //         <asvg:svgBlip r:embed="rId-SVG"/>
    //       </a:ext>
    //     </a:extLst>
    //   </a:blip>
    // The raster is the rendering fallback for legacy viewers;
    // the SVG is the canonical, high-resolution version. We
    // extract ONLY the SVG when both are present — Claude gets
    // the crisp vector, the deck doesn't carry a duplicate PNG.
    // When no SVG is present (regular raster image), we fall
    // back to the raster rId.
    let embed: string | null = null;
    const svgBlips = blip.getElementsByTagName("asvg:svgBlip");
    if (svgBlips.length > 0) {
      const svgBlip = svgBlips.item(0);
      embed = svgBlip?.getAttribute("r:embed") ?? null;
    }
    if (!embed) {
      // xmldom doesn't have proper namespace lookup APIs for
      // attributes, but getAttribute with the prefixed name works
      // as long as the document uses the standard prefix (which
      // OOXML mandates in practice — `r:` is canonical).
      embed = blip.getAttribute("r:embed");
    }
    if (!embed) continue;

    // Walk up the parent chain. Track the OUTERMOST p:grpSp we see;
    // that's the canonical group for this blip.
    let outermostGrp: Node | null = null;
    let ancestor = (blip.parentNode ?? null) as Node | null;
    while (ancestor) {
      if (ancestor.nodeName === "p:grpSp") outermostGrp = ancestor;
      ancestor = ancestor.parentNode ?? null;
    }

    let groupId: string | null = null;
    if (outermostGrp) {
      let assigned = groupIdMap.get(outermostGrp);
      if (!assigned) {
        nextGroupNum += 1;
        assigned = `slide${slideIndex}-group${nextGroupNum}`;
        groupIdMap.set(outermostGrp, assigned);
      }
      groupId = assigned;
    }

    out.push({ rId: embed, groupId });
  }
  return out;
}

/**
 * Resolve a `Target` attribute (which is a path relative to the
 * containing rels file) into an absolute zip path.
 *
 * Inputs we expect:
 *   sourcePath = "ppt/slides/slide3.xml"
 *   target     = "../media/image1.png"   → "ppt/media/image1.png"
 *
 * Less common but valid:
 *   target     = "media/image1.png"      → "ppt/slides/media/image1.png"
 *     (PPTX produced by some tools puts media under slides/)
 */
function resolveZipPath(sourcePath: string, target: string): string {
  const sourceDir = sourcePath.split("/").slice(0, -1);
  const targetParts = target.split("/");
  // Resolve `..` and `.` components manually — we can't use
  // node:path here because zip paths always use `/` regardless of
  // platform.
  const stack = [...sourceDir];
  for (const part of targetParts) {
    if (part === "..") stack.pop();
    else if (part === "." || part === "") continue;
    else stack.push(part);
  }
  return stack.join("/");
}

/**
 * MIME type from filename extension. Returns null for formats we
 * can't render in a browser (EMF, WMF, unknown) — caller filters
 * those out so the generated HTML never references a broken asset.
 */
function mimeForFile(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return null; // emf, wmf, unknown
  }
}
