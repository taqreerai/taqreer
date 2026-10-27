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
import { clampChars, MAX_SLIDE_TEXT_CHARS } from "@/lib/types/brief-limits";

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
 *
 * HIDDEN slides (`<p:sld show="0">`) are left out: LibreOffice does not export
 * them to the PDF, so the rendered pages, the text blocks and the carried
 * pictures must all skip them to stay aligned (2026-10-18: a 53-slide deck with
 * 33 hidden ones rendered 20 pages while the text had 53 blocks).
 */
export async function resolveSlideOrder(zip: JSZip): Promise<string[]> {
  return dropHiddenSlides(zip, await resolveAllSlides(zip));
}

async function resolveAllSlides(zip: JSZip): Promise<string[]> {
  try {
    const presEntry = zip.files["ppt/presentation.xml"];
    const relsEntry = zip.files["ppt/_rels/presentation.xml.rels"];
    if (!presEntry || !relsEntry) throw new Error("missing presentation parts");

    const presXml = await presEntry.async("string");
    const relsXml = await relsEntry.async("string");

    // One entry per <p:sldId>; its relationship id lives in an attribute named
    // `<prefix>:id`, and the prefix is whatever the writing tool declared (`r`
    // in PowerPoint, `ns0` in some python / XML-library exports), so match any
    // prefix instead of hard-coding `r:`.
    const sldTags = [...presXml.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => m[0]);
    const rIds = sldTags.map((t) => /\s(?!xmlns)[A-Za-z_][\w.-]*:id="([^"]+)"/.exec(t)?.[1]);

    // rId -> Target from the rels (attribute order isn't guaranteed,
    // so parse each Relationship element, then pull Id + Target).
    const relMap = new Map<string, string>();
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
      const el = rel[0];
      const id = el.match(/\bId="([^"]+)"/)?.[1];
      const target = el.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) relMap.set(id, target);
    }

    const paths = rIds.map((rid) => (rid ? relMap.get(rid) : undefined));

    // Only trust presentation order when EVERY <p:sldId> resolved to a slide.
    // Counting against the sldId elements themselves (not against a list that
    // already lost the ones whose id attribute was not understood) is what
    // keeps a partial read from passing as complete: a shortened list shifts
    // every following textPerSlide[i] out of sync with the rasterized slide
    // images, the exact desync this helper exists to prevent. On a partial
    // resolution, fall back to numeric filename order (the catch below),
    // which keeps all slides in order.
    if (sldTags.length > 0 && paths.every((t): t is string => Boolean(t))) {
      return paths.map(normalizeSlidePath);
    }
    throw new Error("incomplete slide order from sldIdLst");
  } catch {
    return Object.keys(zip.files).filter((n) => SLIDE_RE.test(n)).sort(
      byNumericSuffix,
    );
  }
}

async function dropHiddenSlides(zip: JSZip, paths: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const p of paths) {
    const entry = zip.files[p];
    if (entry) {
      const xml = await entry.async("string");
      const root = /<p:sld\b[^>]*>/.exec(xml)?.[0] ?? "";
      if (/\sshow\s*=\s*["']?(0|false)["']?/i.test(root)) continue;
    }
    kept.push(p);
  }
  // Every slide hidden: nothing to align against, keep them all.
  return kept.length > 0 ? kept : paths;
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
      // `<a:t\b` would also take <a:tab/> and <a:tabLst> (tab stops,
      // which LibreOffice writes on every paragraph) and leak their XML.
      /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g,
    )) {
      buf += m[1] !== undefined ? m[1] : "\n";
    }
    return decodeXmlEntities(buf);
  });
  // Collapse runs of 3+ blank lines and trim the slide's edges.
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Clamp degenerate slides (a pasted document, a giant hidden textbox) to
  // the cap the SourceEnhanceSchema enforces: without this, one oversized
  // slide would make writeSource/the schema reject the WHOLE source and
  // silently demote the enhance flow to scratch. Machine-extracted text, so
  // truncation with an ellipsis (datasheet MAX_CELL_CHARS pattern) beats a
  // hard failure.
  return text.length > MAX_SLIDE_TEXT_CHARS
    ? `${clampChars(text, MAX_SLIDE_TEXT_CHARS - 1)}…`
    : text;
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
