// Enhance phase 1, step 2 (docs/enhance-visuals-plan.md): at generation time,
// find the original pictures of a PPTX upload, store them in the private
// `source-assets` bucket under the project, and return the small manifest the
// prompt and the server-side enforcement need (no bytes: it rides an Inngest
// step result).
//
// Every slide's pictures are stored, not only the visible ones of a free-plan
// teaser, so an unlock later can place them too (the raw upload itself is
// purged after 7 days by source-files-cleanup). PDF uploads go through
// lib/extract/pdf-visuals.ts (phase 2); a PDF has no native tables here yet.

import { tagReworkPictures, type PictureTag } from "@/lib/extract/rework-pictures";
import { extractTextPerSlide } from "@/lib/extract/text-pptx";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { chromeTables, extractPptxVisuals, classifyPptxPictures, extractTemplatePictures, type PptxFrame } from "@/lib/extract/pptx-visuals";
import { buildPptxAssets } from "@/lib/extract/pptx-asset-crops";
import { buildPdfAssets, classifyPdfPictures, extractPdfPictures, type PdfAsset } from "@/lib/extract/pdf-visuals";
import { uploadSourceAsset } from "@/lib/storage/source-assets";
import { coverPhotoCandidates } from "@/lib/deck/carried-assets";
import { analyzeAndEnhance, type PictureKind } from "@/lib/extract/photo-enhance";
import {
  makeReplacements,
  refreshPool,
  selectPhotoReplacements,
  tagPhotos,
  type RefreshCandidate,
} from "@/lib/extract/photo-refresh";
import { describeScreens, tagReplacePictures, type ReplaceRole } from "@/lib/extract/rework-pictures";
import { brandLogoCandidates, findBrandLogos, type BrandLogo } from "@/lib/extract/brand-logos";
import { createHash } from "crypto";
import type { TableSpec } from "@/lib/deck/visuals/table";
import type { ChartSpec } from "@/lib/deck/visuals/chart";

const SOURCE_FILES_BUCKET = "source-files";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";
// Upload concurrency: small files, a few at a time.
const UPLOAD_PARALLEL = 4;
// A PDF picture this much of the page, not a photo, under this many words of
// real text is the page's baked template background (see the filter below).
const TEMPLATE_BG_AREA = 0.9;
const TEMPLATE_BG_MIN_WORDS = 5;

export type CarriedPicture = {
  assetId: string;
  slideIndex: number; // presentation order, 0-based
  // "page": a page-sized artwork (PDF), shown full-bleed as the slide background.
  cls: "content" | "small" | "page" | "backdrop";
  // Where the picture sat on the source slide, as fractions of the slide: the
  // redesign keeps about the same visual weight (before 2026-10-20 every
  // picture was suggested at one fixed size, which shrank full-bleed photos).
  box?: { x: number; y: number; w: number; h: number };
  // Content pictures only: a real photo, or a graphic (diagram, scanned page,
  // screenshot) whose pixels must stay exact.
  kind?: PictureKind;
  // The stored bitmap's own pixel size: a screenshot / document is never shown
  // larger than this (it only blurs), carried-assets maxSize.
  native?: { w: number; h: number };
  // Photo refresh: this picture is a NEW photo replacing that original asset
  // (kept stored; the studio's "Restore original" puts it back).
  originalAssetId?: string;
  // Rework decks: generic clip-art / decoration the redesign may leave out or
  // replace with a generated image, and what the picture shows (so labels are
  // matched to the right picture). lib/extract/rework-pictures.ts.
  swap?: boolean;
  shows?: string;
  // Replace-all decks: an organisation's logo, kept and restyled to fit.
  logo?: boolean;
  // A brand logo from the deck's template (lib/extract/brand-logos.ts): the
  // slides it showed on (it is listed on each); slideIndex is the first.
  slides?: number[];
  // Replace-all decks: a software screenshot redrawn as a clean mock-up from
  // this brief (lib/extract/rework-pictures.ts describeScreens); the picture
  // itself is not shown.
  rebuild?: string;
  // An animated GIF, stored as the original file so it plays.
  animated?: boolean;
  aspect: number; // width / height on the original slide
  altText: string | null;
};

// A native PPTX table, carried as its EXACT cells (step 3): the model reserves
// a box, the server fills it (lib/deck/carried-assets enforceCarriedTables).
export type CarriedTable = {
  tableId: string; // "s05-t1"
  slideIndex: number;
  // A table's exact cells, or (id "s04-c1") a native chart's exact data.
  spec: TableSpec | ChartSpec;
};

export type CarriedPictures = {
  // Per-file AI images rule (owner, 2026-10-15): any CONTENT picture in the
  // file switches AI images off for the whole deck.
  hasContentImages: boolean;
  pictures: CarriedPicture[];
  // Pictures found but not storable here (EMF / WMF / undecodable): left to
  // the existing photo-slot handling until page crops land.
  skipped: number;
  // Photos cleaned up / upscaled before storing (lib/extract/photo-enhance.ts).
  enhancedPhotos?: number;
  // Opt-in photo refresh: photos tagged, pictures replaced.
  refresh?: { tagged: number; replaced: number };
  // A photo from another slide for a cover that has none (Haiku-confirmed).
  coverPhotoId?: string;
  tables: CarriedTable[];
};

export async function prepareCarriedPictures(opts: {
  projectId: string;
  sourcePath: string;
  sourceMime: string;
  // "Refresh my photos" (opt-in): see lib/extract/photo-refresh.ts.
  refresh?: { slideCount: number; paid: boolean; styleHint: string; palette: readonly string[] } | null;
  // Enhance's free layout (tidy wording or redrawn pictures): tag what each
  // picture shows and whether it may be swapped.
  rework?: boolean;
  // Tidy wording: a header table repeated on most slides is template chrome,
  // not a carried table (its information is shown once).
  dropChrome?: boolean;
  // "Replace all my photos": each picture is a logo (kept), data (kept), a
  // supporting picture (swap: rebuilt as a generated image) or dropped
  // (lib/extract/rework-pictures.ts tagReplacePictures).
  replace?: boolean;
}): Promise<CarriedPictures> {
  if (opts.sourceMime !== PPTX_MIME && opts.sourceMime !== PDF_MIME) {
    return { hasContentImages: false, pictures: [], skipped: 0, tables: [] };
  }

  const { data, error } = await getSupabaseAdmin().storage.from(SOURCE_FILES_BUCKET).download(opts.sourcePath);
  if (error || !data) throw new Error(`carried pictures: source not found at ${opts.sourcePath}`);
  const buffer = Buffer.from(await data.arrayBuffer());

  let assets: PdfAsset[];
  let wordsByPage: number[] | null = null; // PDF only: text-layer words per page
  let hasContentImages: boolean;
  let tables: CarriedTable[] = [];
  let brandLogos: BrandLogo[] = [];
  if (opts.sourceMime === PDF_MIME) {
    const visuals = await extractPdfPictures(buffer);
    wordsByPage = visuals.wordsByPage;
    const classes = classifyPdfPictures(visuals);
    assets = await buildPdfAssets(visuals, classes);
    // After the flat-image filter: a file whose only "pictures" were shadows
    // and fills has no real pictures, so it keeps AI images.
    hasContentImages = assets.some((a) => a.cls === "content" || a.cls === "page");
  } else {
    const visuals = await extractPptxVisuals(buffer);
    const classes = classifyPptxPictures(visuals);
    hasContentImages = [...classes.values()].includes("content");
    assets = await buildPptxAssets(buffer, visuals, classes);
    const template = await extractTemplatePictures(buffer).catch(() => ({ pictures: [] }));
    brandLogos = await findBrandLogos(buffer, brandLogoCandidates(visuals, classes, template));
    // Rework: lesson-info strips are template chrome; the redesign shows them once.
    tables = tablesOf(visuals, opts.dropChrome ? chromeTables(visuals) : undefined);
  }

  let storable = assets.filter((a) => a.file.kind === "image");
  // Photo vs graphic, and the free clean-up of washed-out / small photos
  // (lib/extract/photo-enhance.ts). Graphics and icons are stored untouched.
  const kinds = new Map<string, PictureKind>();
  const badness = new Map<string, number>();
  const mediaKeys = new Map<string, string>();
  let enhancedCount = 0;
  for (const a of storable) {
    if (a.file.kind !== "image" || a.cls !== "content") continue;
    // Key on the ORIGINAL bytes: the same picture on several slides is one picture.
    mediaKeys.set(a.assetId, createHash("sha1").update(a.file.bytes).digest("hex"));
    // An animated GIF is kept exactly as it is (a clean-up would flatten it).
    const file = a.file;
    if (file.contentType === "image/gif") {
      kinds.set(a.assetId, "graphic");
      continue;
    }
    const r = await analyzeAndEnhance({ ...file, contentType: file.contentType });
    if (r.cutout) {
      // Template decoration: kept as a small, droppable piece, never a content
      // photo or a picture with words (carried-assets isTextPicture).
      a.cls = "small";
      continue;
    }
    kinds.set(a.assetId, r.kind);
    badness.set(a.assetId, r.badness);
    if (r.enhanced) {
      enhancedCount++;
      a.file = { kind: "image", bytes: r.bytes, contentType: r.contentType, width: r.width, height: r.height };
    }
  }
  // "The file has pictures of its own" (which turns AI images off for the whole
  // deck, deck-generate) means real PHOTOS, or a scanned page. A header banner,
  // a diagram or a screenshot does not: one banner on the cover used to leave a
  // text-only deck with no images at all (prod 2026-10-25, cmvo1woh10002n06ds86sboio).
  // PDF template backgrounds (owner, 2026-10-27): a PDF can bake a slide's
  // whole template (corner shapes, dots, a faded watermark) into ONE full-page
  // image under the real text. Repeated on many pages it is caught as
  // "background" (pdf-visuals); on only two or three it came through as a
  // "document" and would be shown as a framed picture of an empty template.
  // A full-page picture that is not a photo, on a page with real text drawn
  // over it, is that template: not carried. A full-page PHOTO still becomes
  // the slide's photo background; scanned pages are cls "page", untouched.
  if (wordsByPage) {
    const words = wordsByPage;
    storable = storable.filter(
      (a) =>
        !(
          a.cls === "content" &&
          a.box.w * a.box.h >= TEMPLATE_BG_AREA &&
          kinds.get(a.assetId) !== "photo" &&
          (words[a.slideIndex] ?? 0) >= TEMPLATE_BG_MIN_WORDS
        ),
    );
  }
  hasContentImages =
    assets.some((a) => a.cls === "page") ||
    storable.some((a) => a.cls === "content" && kinds.get(a.assetId) === "photo");
  const backdropIds = fullSlidePhotos(storable, kinds);
  // Rework: once per distinct picture (same bytes on several slides = one),
  // small ones included (a labelled icon still needs its description).
  let tags = new Map<string, PictureTag>();
  const roles = new Map<string, ReplaceRole>(); // by mediaKey, replace-all only
  const screenBriefs = new Map<string, string>(); // by mediaKey: screenshot -> mock-up brief
  if (opts.rework || opts.replace) {
    const slideText = opts.sourceMime === PPTX_MIME ? await extractTextPerSlide(buffer).catch(() => [] as string[]) : [];
    const byKey = new Map<string, { bytes: Buffer; context?: string }>();
    for (const a of storable) {
      if (a.file.kind !== "image") continue;
      const key = mediaKeys.get(a.assetId) ?? createHash("sha1").update(a.file.bytes).digest("hex");
      mediaKeys.set(a.assetId, key);
      if (!byKey.has(key)) byKey.set(key, { bytes: a.file.bytes, context: slideText[a.slideIndex] });
    }
    const list = [...byKey].map(([mediaKey, v]) => ({ mediaKey, ...v }));
    if (opts.replace) {
      for (const [key, tag] of await tagReplacePictures(list)) {
        roles.set(key, tag.role);
        tags.set(key, { swap: tag.role === "support", shows: tag.shows });
      }
      // Screenshots are redrawn as clean mock-ups from a brief; one without a
      // brief (the call failed) stays a picture, shown crisp and framed.
      const screens = list.filter((x) => roles.get(x.mediaKey) === "screen");
      for (const [key, brief] of await describeScreens(screens)) screenBriefs.set(key, brief);
    } else {
      tags = await tagReworkPictures(list);
    }
  }
  for (let i = 0; i < storable.length; i += UPLOAD_PARALLEL) {
    await Promise.all(
      storable.slice(i, i + UPLOAD_PARALLEL).map((a) => {
        if (a.file.kind !== "image") return Promise.resolve();
        return uploadSourceAsset({
          projectId: opts.projectId,
          assetId: a.assetId,
          bytes: a.file.bytes,
          contentType: a.file.contentType,
        });
      }),
    );
  }

  // ─── Opt-in photo refresh ───
  const replaced = new Map<string, string>(); // original assetId -> new assetId
  let refreshTagged = 0;
  if (opts.refresh) {
    const visibleArea = (a: PdfAsset) =>
      Math.max(0, Math.min(1, a.box.x + a.box.w) - Math.max(0, a.box.x)) *
      Math.max(0, Math.min(1, a.box.y + a.box.h) - Math.max(0, a.box.y));
    const photos = storable.filter((a) => kinds.get(a.assetId) === "photo");
    const cands: RefreshCandidate[] = photos.map((a) => {
      const onSlide = photos.filter((b) => b.slideIndex === a.slideIndex);
      return {
        assetId: a.assetId,
        slideIndex: a.slideIndex,
        cls: backdropIds.has(a.assetId) ? "backdrop" : a.cls,
        kind: kinds.get(a.assetId),
        area: visibleArea(a),
        badness: badness.get(a.assetId) ?? 0,
        mediaKey: mediaKeys.get(a.assetId) ?? a.assetId,
        photosOnSlide: onSlide.length,
        largestOnSlide: onSlide.every((b) => visibleArea(b) <= visibleArea(a)),
      };
    });
    // Tag the best candidates once each (by picture, not by slide).
    const byKey = new Map<string, PdfAsset>();
    for (const c of refreshPool(cands)) {
      const a = storable.find((x) => x.assetId === c.assetId);
      if (a && !byKey.has(c.mediaKey)) byKey.set(c.mediaKey, a);
    }
    const tagged = await tagPhotos(
      [...byKey].map(([mediaKey, a]) => ({ mediaKey, bytes: a.file.kind === "image" ? a.file.bytes : Buffer.alloc(0) })),
    );
    refreshTagged = tagged.size;
    const tags = new Map([...tagged].map(([k, v]) => [k, v.tag] as const));
    const picks = selectPhotoReplacements(cands, tags, { slideCount: opts.refresh.slideCount, paid: opts.refresh.paid });
    const made = await makeReplacements({
      projectId: opts.projectId,
      styleHint: opts.refresh.styleHint,
      palette: opts.refresh.palette,
      picks: picks.flatMap((mediaKey) => {
        const a = byKey.get(mediaKey);
        const t = tagged.get(mediaKey);
        if (!a || !t || a.file.kind !== "image") return [];
        return [{ mediaKey, assetId: a.assetId, bytes: a.file.bytes, contentType: a.file.contentType, width: a.file.width, height: a.file.height, tag: t.tag, desc: t.desc }];
      }),
    });
    for (const a of storable) {
      const key = mediaKeys.get(a.assetId);
      const next = key ? made.get(key) : undefined;
      if (next) replaced.set(a.assetId, next);
    }
  }

  // Replace-all: a dropped picture (and a supporting full-slide photo, which
  // the redesign rebuilds as its own photo background) is not carried at all.
  // Page artworks stay: they are the slide.
  const dropped = (a: PdfAsset) => {
    if (!opts.replace || a.cls === "page") return false;
    const role = roles.get(mediaKeys.get(a.assetId) ?? "");
    return role === "drop" || (role === "support" && backdropIds.has(a.assetId));
  };
  const pictures: CarriedPicture[] = storable.filter((a) => !dropped(a)).map((a) => ({
      assetId: replaced.get(a.assetId) ?? a.assetId,
      ...(replaced.has(a.assetId) ? { originalAssetId: a.assetId } : {}),
      slideIndex: a.slideIndex,
      cls: backdropIds.has(a.assetId) ? ("backdrop" as const) : a.cls,
      ...(kinds.has(a.assetId) ? { kind: kinds.get(a.assetId) } : {}),
      // An animated picture is never swapped: a generated image cannot move.
      ...(tags.get(mediaKeys.get(a.assetId) ?? "")?.swap && !(a.file.kind === "image" && a.file.animated) ? { swap: true } : {}),
      ...(a.file.kind === "image" && a.file.animated ? { animated: true } : {}),
      ...(roles.get(mediaKeys.get(a.assetId) ?? "") === "logo" ? { logo: true } : {}),
      ...(screenBriefs.has(mediaKeys.get(a.assetId) ?? "") ? { rebuild: screenBriefs.get(mediaKeys.get(a.assetId) ?? "")! } : {}),
      ...(tags.get(mediaKeys.get(a.assetId) ?? "")?.shows ? { shows: tags.get(mediaKeys.get(a.assetId) ?? "")!.shows! } : {}),
      box: { x: round3(a.box.x), y: round3(a.box.y), w: round3(a.box.w), h: round3(a.box.h) },
      // The PICTURE's own proportions (after the slide's crop), not the shape's:
      // a stretched source shape would otherwise make object-fit: cover cut it.
      aspect: Math.round((a.file.kind === "image" ? a.file.width / a.file.height : a.aspect) * 100) / 100,
      ...(a.file.kind === "image" ? { native: { w: a.file.width, h: a.file.height } } : {}),
      altText: a.altText ? a.altText.slice(0, 200) : null,
  }));

  // ─── Template brand logos (lib/extract/brand-logos.ts) ───
  // Stored once, listed on every slide that showed them, always as a LOGO.
  for (let k = 0; k < brandLogos.length; k++) {
    const logo = brandLogos[k];
    const assetId = `brand-${k + 1}`;
    try {
      await uploadSourceAsset({ projectId: opts.projectId, assetId, bytes: logo.bytes, contentType: logo.contentType });
    } catch (err) {
      console.error("[carry] brand logo upload failed:", err);
      continue;
    }
    pictures.push({
      assetId,
      slideIndex: logo.slides[0],
      slides: logo.slides,
      cls: "small",
      logo: true,
      box: { x: round3(logo.box.x), y: round3(logo.box.y), w: round3(logo.box.w), h: round3(logo.box.h) },
      aspect: Math.round((logo.width / logo.height) * 100) / 100,
      native: { w: logo.width, h: logo.height },
      altText: null,
    });
  }

  // ─── Cover photo (lib/deck/carried-assets pickCoverPhoto) ───
  // A cover with no photo opens on the deck's strongest photo. The pixel
  // classifier calls a colourful floor plan a photo, so the largest few
  // candidates are confirmed by the Haiku tagger; drawings never qualify.
  let coverPhotoId: string | undefined;
  const coverCands = coverPhotoCandidates(pictures)
    .filter((p) => !p.originalAssetId && !p.swap)
    .slice(0, COVER_CANDIDATES);
  if (coverCands.length > 0) {
    const coverTags = await tagPhotos(
      coverCands.flatMap((p) => {
        const a = storable.find((x) => x.assetId === p.assetId);
        return a && a.file.kind === "image" ? [{ mediaKey: p.assetId, bytes: a.file.bytes }] : [];
      }),
    );
    const rank = (t: string | undefined) => (t === "subject" || t === "mood" || t === "specific" ? 0 : t === "person" ? 1 : 2);
    const usable = coverCands.filter((p) => {
      const t = coverTags.get(p.assetId)?.tag;
      return t !== undefined && t !== "diagram";
    });
    usable.sort((x, y) => rank(coverTags.get(x.assetId)?.tag) - rank(coverTags.get(y.assetId)?.tag));
    coverPhotoId = usable[0]?.assetId;
  }

  return {
    hasContentImages,
    ...(opts.refresh ? { refresh: { tagged: refreshTagged, replaced: replaced.size } } : {}),
    pictures,
    ...(coverPhotoId ? { coverPhotoId } : {}),
    skipped: assets.length - storable.length,
    enhancedPhotos: enhancedCount,
    tables,
  };
}

const COVER_CANDIDATES = 4;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// A content picture (photo or texture, not a document) that covers the slide (visible share >= 85%, see below) is that
// slide's photo background, not a picture to frame. One per slide: the largest.
export function fullSlidePhotos(assets: readonly PdfAsset[], kinds?: ReadonlyMap<string, PictureKind>): Set<string> {
  const best = new Map<number, { id: string; area: number }>();
  for (const a of assets) {
    if (a.cls !== "content") continue;
    // A scanned page is content to show whole, never a backdrop for the slide's
    // text (2026-10-20, textbook scans under the titles). A texture (graphic,
    // e.g. marble) is fine as a backdrop.
    if (kinds && kinds.get(a.assetId) === "document") continue;
    const vw = Math.max(0, Math.min(1, a.box.x + a.box.w) - Math.max(0, a.box.x));
    const vh = Math.max(0, Math.min(1, a.box.y + a.box.h) - Math.max(0, a.box.y));
    const area = vw * vh;
    // Covers the slide, or spans its full height / width and most of the other
    // side (a poster-style cover whose art bleeds off one edge).
    const hero = area >= 0.85 || (area >= 0.6 && (vh >= 0.95 || vw >= 0.95));
    if (hero && area > (best.get(a.slideIndex)?.area ?? 0)) best.set(a.slideIndex, { id: a.assetId, area });
  }
  return new Set([...best.values()].map((b) => b.id));
}

// Native tables, numbered per slide in document order.
function tablesOf(visuals: Awaited<ReturnType<typeof extractPptxVisuals>>, skip?: ReadonlySet<PptxFrame>): CarriedTable[] {
  const perSlide = new Map<number, number>();
  const perSlideCharts = new Map<number, number>();
  const out: CarriedTable[] = [];
  for (const f of visuals.frames) {
    const sl = String(f.slideIndex + 1).padStart(2, "0");
    if (f.kind === "chart" && f.chart) {
      const n = (perSlideCharts.get(f.slideIndex) ?? 0) + 1;
      perSlideCharts.set(f.slideIndex, n);
      out.push({ tableId: `s${sl}-c${n}`, slideIndex: f.slideIndex, spec: f.chart });
      continue;
    }
    if (f.kind !== "table" || !f.table || skip?.has(f)) continue;
    const n = (perSlide.get(f.slideIndex) ?? 0) + 1;
    perSlide.set(f.slideIndex, n);
    out.push({ tableId: `s${sl}-t${n}`, slideIndex: f.slideIndex, spec: f.table });
  }
  return out;
}
