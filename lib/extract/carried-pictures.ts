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
import { replaceCoveredPictures } from "@/lib/extract/pdf-overlays";
import { uploadSourceAsset } from "@/lib/storage/source-assets";
import { coverPhotoCandidates } from "@/lib/deck/carried-assets";
import { analyzeAndEnhance, detailProfile, type PictureKind } from "@/lib/extract/photo-enhance";
import {
  makeReplacements,
  refreshPool,
  selectPhotoReplacements,
  tagPhotos,
  type RefreshCandidate,
} from "@/lib/extract/photo-refresh";
import { describeScreens, tagReplacePictures, type ReplaceRole } from "@/lib/extract/rework-pictures";
import { brandLogoCandidates, findBrandLogos, type BrandLogo } from "@/lib/extract/brand-logos";
import { findHdPictures, type HdCandidate } from "@/lib/extract/hd-pictures";
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
// ...and only when it is mostly empty (under this share of detailed tiles) or
// the same picture recurs on another page (fingerprints this many bits apart
// or fewer, of 256). A full-page ARTWORK, a portfolio page of drawings and
// renders with live text over it, is carried (prod 2026-10-30,
// cmvu3aiip001q9m6d1zzvrnda: 24 of 27 artwork pages, 25% to 95% busy, unique,
// were dropped and the redesign asked for AI images of them instead).
const TEMPLATE_BG_MAX_BUSY = 0.2;
const TEMPLATE_BG_REPEAT_BITS = 6;

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
  // A mostly white flat page, kept only for lib/extract/page-regions.ts.
  scan?: boolean;
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
  // Every confirmed cover photo, best first: a free preview builds only the
  // first pages and must not borrow a photo from a page it does not show.
  coverPhotoIds?: string[];
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
  // The caller will cut flat pages (lib/extract/page-regions.ts): mostly white
  // ones are kept for it too, since line drawings on white look like a scan.
  cutPages?: boolean;
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
    assets = await buildPdfAssets(visuals, classes, { whiteScans: opts.cutPages });
    // What the page really shows when something covers a picture. Never fails
    // the deck: the bitmap stays.
    await replaceCoveredPictures(assets, buffer).catch((err) => console.warn("[carry] visible pictures failed:", err));
    // After the flat-image filter: a file whose only "pictures" were shadows
    // and fills has no real pictures, so it keeps AI images.
    hasContentImages = assets.some((a) => a.cls === "content" || (a.cls === "page" && !a.scan));
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
  // Only a mostly empty or repeated one is a template (TEMPLATE_BG_MAX_BUSY).
  if (wordsByPage) {
    const words = wordsByPage;
    const fullPage = storable.filter(
      (a) =>
        a.cls === "content" &&
        a.box.w * a.box.h >= TEMPLATE_BG_AREA &&
        kinds.get(a.assetId) !== "photo" &&
        (words[a.slideIndex] ?? 0) >= TEMPLATE_BG_MIN_WORDS,
    );
    const profiles = new Map<string, { busyShare: number; fingerprint: string }>();
    for (const a of fullPage) {
      if (a.file.kind !== "image") continue;
      // Unmeasurable: kept (the user's picture is never dropped on a guess).
      const p = await detailProfile(a.file.bytes).catch(() => null);
      if (p) profiles.set(a.assetId, p);
    }
    const bitsApart = (x: string, y: string) => {
      let d = 0;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
      return d;
    };
    const template = new Set(
      fullPage
        .filter((a) => {
          const p = profiles.get(a.assetId);
          if (!p) return false;
          if (p.busyShare < TEMPLATE_BG_MAX_BUSY) return true;
          return fullPage.some((b) => {
            const q = profiles.get(b.assetId);
            return b.slideIndex !== a.slideIndex && !!q && bitsApart(p.fingerprint, q.fingerprint) <= TEMPLATE_BG_REPEAT_BITS;
          });
        })
        .map((a) => a.assetId),
    );
    storable = storable.filter((a) => !template.has(a.assetId));
  }
  hasContentImages =
    assets.some((a) => a.cls === "page" && !a.scan) ||
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
      if (a.file.kind !== "image" || a.scan) continue;
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

  // ─── Sharper copies of flags and famous places (lib/extract/hd-pictures.ts) ───
  // Only carried, unswapped pictures shown wider than their own pixels.
  const hd = new Map<string, { assetId: string; width: number; height: number }>(); // mediaKey ->
  {
    const seen = new Set<string>();
    const cands: HdCandidate[] = [];
    for (const a of storable) {
      const key = mediaKeys.get(a.assetId);
      if (!key || seen.has(key) || a.file.kind !== "image" || a.file.animated || a.scan || replaced.has(a.assetId)) continue;
      const role = roles.get(key);
      if (role === "drop" || role === "support" || role === "logo" || role === "screen" || tags.get(key)?.swap) continue;
      if (a.file.width >= Math.min(1, a.box.w) * 1920) continue;
      seen.add(key);
      cands.push({ mediaKey: key, bytes: a.file.bytes, aspect: a.file.width / a.file.height });
    }
    for (const [key, pic] of await findHdPictures(cands)) {
      const assetId = `hd-${key.slice(0, 12)}`;
      try {
        await uploadSourceAsset({ projectId: opts.projectId, assetId, bytes: pic.bytes, contentType: pic.contentType });
        hd.set(key, { assetId, width: pic.width, height: pic.height });
      } catch (err) {
        console.error("[carry] hd picture upload failed:", err);
      }
    }
    for (const a of storable) {
      const up = hd.get(mediaKeys.get(a.assetId) ?? "");
      if (up && !replaced.has(a.assetId)) replaced.set(a.assetId, up.assetId);
    }
  }

  // At most one generated replacement per slide (owner, 2026-10-28): a collage
  // slide of 4 web pictures becomes one strong new picture, not 4 generations.
  // The largest supporting picture on each slide is the one replaced.
  const extraSupports = new Set<string>();
  if (opts.replace) {
    const bySlide = new Map<number, PdfAsset[]>();
    for (const a of storable) {
      if (roles.get(mediaKeys.get(a.assetId) ?? "") !== "support" || backdropIds.has(a.assetId)) continue;
      (bySlide.get(a.slideIndex) ?? bySlide.set(a.slideIndex, []).get(a.slideIndex)!).push(a);
    }
    for (const list of bySlide.values()) {
      list.sort((x, y) => y.box.w * y.box.h - x.box.w * x.box.h);
      for (const a of list.slice(1)) extraSupports.add(a.assetId);
    }
  }
  // Replace-all: a dropped picture (and a supporting full-slide photo, which
  // the redesign rebuilds as its own photo background) is not carried at all.
  // Page artworks stay: they are the slide.
  const dropped = (a: PdfAsset) => {
    if (!opts.replace || a.cls === "page") return false;
    const role = roles.get(mediaKeys.get(a.assetId) ?? "");
    return role === "drop" || (role === "support" && backdropIds.has(a.assetId)) || extraSupports.has(a.assetId);
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
      ...(a.scan ? { scan: true } : {}),
      ...(roles.get(mediaKeys.get(a.assetId) ?? "") === "logo" ? { logo: true } : {}),
      ...(screenBriefs.has(mediaKeys.get(a.assetId) ?? "") ? { rebuild: screenBriefs.get(mediaKeys.get(a.assetId) ?? "")! } : {}),
      ...(tags.get(mediaKeys.get(a.assetId) ?? "")?.shows ? { shows: tags.get(mediaKeys.get(a.assetId) ?? "")!.shows! } : {}),
      box: { x: round3(a.box.x), y: round3(a.box.y), w: round3(a.box.w), h: round3(a.box.h) },
      // The PICTURE's own proportions (after the slide's crop), not the shape's:
      // a stretched source shape would otherwise make object-fit: cover cut it.
      ...(() => {
        // A sharper copy brings its own proportions and size.
        const up = hd.get(mediaKeys.get(a.assetId) ?? "");
        if (up) return { aspect: Math.round((up.width / up.height) * 100) / 100, native: { w: up.width, h: up.height } };
        return {
          aspect: Math.round((a.file.kind === "image" ? a.file.width / a.file.height : a.aspect) * 100) / 100,
          ...(a.file.kind === "image" ? { native: { w: a.file.width, h: a.file.height } } : {}),
        };
      })(),
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
  let coverPhotoIds: string[] = [];
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
    coverPhotoIds = usable.map((p) => p.assetId);
    coverPhotoId = coverPhotoIds[0];
  }

  return {
    hasContentImages,
    ...(opts.refresh ? { refresh: { tagged: refreshTagged, replaced: replaced.size } } : {}),
    pictures,
    ...(coverPhotoId ? { coverPhotoId, coverPhotoIds } : {}),
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
    // Covers (nearly) the whole slide. A photo that bleeds off one edge but
    // leaves room for the text beside it is the slide's main picture, not its
    // background (prod 2026-10-28 cmvspt4r200nkak6dw8rfbwmy: a full-height
    // photo 70% wide became a backdrop, the model wrote a colour ground and
    // the photo vanished).
    const hero = vw >= 0.9 && vh >= 0.9;
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
