// Phase 18 (Enhance overhaul) — per-slide VERBATIM text from a PPTX.
//
// The enhance pipeline feeds Claude one rendered image per slide PLUS
// the slide's exact text, so it redesigns the visual while reproducing
// the content word-for-word. Extracting the text from the PPTX XML is
// exact (no OCR, no LibreOffice→PDF→text-layer loss).
//
// ─── Why presentation order matters ───────────────────────────────
// The slide FILES (`ppt/slides/slide1.xml`, `slide2.xml`, …) are NOT
// guaranteed to be in presentation order — the order is defined by
// `ppt/presentation.xml`'s `<p:sldIdLst>` → relationship ids →
// `ppt/_rels/presentation.xml.rels`. LibreOffice renders the PDF in
// presentation order, so the text array MUST be in that same order or
// it won't line up 1:1 with the per-slide images. We resolve the real
// order and fall back to numeric filename order only if the rels can't
// be parsed.
//
// Charts / SmartArt store text in separate parts (chart/diagram XML),
// not in `slideN.xml`; those become placeholders in the redesign, so
// missing their text here is acceptable. Speaker notes live in
// `ppt/notesSlides/` and are intentionally excluded.

import JSZip from "jszip";

const SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/;

/**
 * Extract verbatim text per slide, in presentation order. Index `i`
 * corresponds to rendered page `i + 1`. Empty string for slides with
 * no text. Throws on an unreadable zip (caller treats as best-effort).
 */
export async function extractTextPerSlide(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const order = await resolveSlideOrder(zip);
  const out: string[] = [];
  for (const slidePath of order) {
    const entry = zip.files[slidePath];
    if (!entry) {
      out.push("");
      continue;
    }
    const xml = await entry.async("string");
    out.push(textFromSlideXml(xml));
  }
  return out;
}

/**
 * Resolve slide XML paths in PRESENTATION order via
 * presentation.xml + its rels. Falls back to numeric filename order.
 */
async function resolveSlideOrder(zip: JSZip): Promise<string[]> {
  try {
    const presEntry = zip.files["ppt/presentation.xml"];
    const relsEntry = zip.files["ppt/_rels/presentation.xml.rels"];
    if (!presEntry || !relsEntry) throw new Error("missing presentation parts");

    const presXml = await presEntry.async("string");
    const relsXml = await relsEntry.async("string");

    // rId order from <p:sldIdLst>/<p:sldId r:id="rIdN">.
    const rIds = [...presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(
      (m) => m[1],
    );

    // rId → Target from the rels (attribute order isn't guaranteed,
    // so parse each Relationship element, then pull Id + Target).
    const relMap = new Map<string, string>();
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
      const el = rel[0];
      const id = el.match(/\bId="([^"]+)"/)?.[1];
      const target = el.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) relMap.set(id, target);
    }

    const paths = rIds
      .map((rid) => relMap.get(rid))
      .filter((t): t is string => Boolean(t))
      .map(normalizeSlidePath);

    // Only trust presentation order when EVERY slide relation resolved.
    // `filter(Boolean)` would otherwise silently drop one unresolved rId and
    // return a shortened list — shifting every following textPerSlide[i] out
    // of sync with the rasterized slide images, the exact desync this helper
    // exists to prevent. On a partial resolution, fall back to numeric
    // filename order (the catch below), which keeps all slides in order.
    if (rIds.length > 0 && paths.length === rIds.length) return paths;
    throw new Error("incomplete slide order from sldIdLst");
  } catch {
    return Object.keys(zip.files).filter((n) => SLIDE_RE.test(n)).sort(
      byNumericSuffix,
    );
  }
}

// Relationship targets in ppt/_rels/presentation.xml.rels are relative
// to the ppt/ folder, e.g. "slides/slide1.xml" (or occasionally
// "../slides/..."). Normalize to a full zip path.
function normalizeSlidePath(target: string): string {
  let t = target.replace(/^\/+/, "");
  if (t.startsWith("ppt/")) return t;
  t = t.replace(/^(\.\.\/)+/, "");
  return `ppt/${t}`;
}

function byNumericSuffix(a: string, b: string): number {
  const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
  const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
  return numA - numB;
}

// Reconstruct a slide's text: each <a:p> is a paragraph (→ newline);
// within a paragraph, <a:t> runs are the text and <a:br/> is a line
// break. We walk both token types in document order so intra-paragraph
// breaks survive (extracting <a:t> bodies alone would drop them).
function textFromSlideXml(xml: string): string {
  const paragraphs = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  const lines = paragraphs.map((p) => {
    let buf = "";
    for (const m of p.matchAll(
      /<a:t[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g,
    )) {
      buf += m[1] !== undefined ? m[1] : "\n";
    }
    return decodeXmlEntities(buf);
  });
  // Collapse runs of 3+ blank lines and trim the slide's edges.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// PPTX <a:t> bodies are XML-escaped. Decode the standard entities +
// numeric references. `&amp;` is decoded LAST so we don't double-decode
// (e.g. "&amp;lt;" must stay "&lt;", not become "<").
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      safeFromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
