// The pictures a /create upload's content depends on (owner, 2026-10-29).
//
// A /create upload reaches the model as one PDF document block and its own
// pictures were never carried: prod cmvsvkk6i0008fw6d3zumkgla turned a "name
// what you see" game (a blender, a key, a car...) into the written answers, and
// dropped the King's photo for a stock picture. The upload now runs Enhance's
// picture step in its "replace all" mode (lib/extract/rework-pictures.ts
// tagReplacePictures): logos and pictures that ARE content (an activity's
// pictures, real people, places and events, charts, maps, scans) are kept;
// generic supporting pictures and decoration go (the new deck's own images
// cover those), and so do screenshots, which only Enhance rebuilds. The new
// deck does not follow the file's page order, so each picture is listed with
// the source page it came from and the model places it where that content
// lands. Any failure carries nothing (today's behaviour). Server-only.

import { prisma } from "@/lib/prisma";
import { prepareCarriedPictures, type CarriedPicture } from "@/lib/extract/carried-pictures";
import { cutPagePictures } from "@/lib/extract/page-regions";
import { carriedSlideBlock, CARRIED_LOGO_RULE, CARRIED_SCREENS_RULE } from "@/lib/deck/carried-assets";

const MAX_PICTURES = 40;

/** The kept pictures of the upload behind `anthropicFileId`; [] when none or on any failure. */
export async function carryUploadPictures(projectId: string, anthropicFileId: string): Promise<CarriedPicture[]> {
  const job = await prisma.job.findFirst({
    where: {
      type: "source-extract",
      status: "completed",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      outputJson: { path: ["anthropicFileId"], equals: anthropicFileId },
    },
    orderBy: { createdAt: "desc" },
    select: { outputJson: true },
  });
  const out = (job?.outputJson ?? {}) as { sourcePath?: unknown; sourceMime?: unknown };
  if (typeof out.sourcePath !== "string" || typeof out.sourceMime !== "string") return [];
  const carried = await prepareCarriedPictures({
    projectId,
    sourcePath: out.sourcePath,
    sourceMime: out.sourceMime,
    replace: true,
    cutPages: true,
  });
  // A flat page is cut into its pictures (lib/extract/page-regions.ts); one that
  // cannot be split is still the user's content and is shown whole. Dropping
  // these left empty picture boxes (prod 2026-11-03 cmw1alaxj01r40x6d3xjmq1cp).
  const { pictures, pagesCut, pagesRetyped, pagesKept, regions } = await cutPagePictures({
    projectId,
    pictures: carried.pictures,
    shouldCut: () => true,
  });
  if (pagesCut + pagesRetyped + pagesKept > 0) {
    console.info("[create] flat pages", { projectId, pagesCut, pagesRetyped, pagesKept, regions });
  }
  return pictures
    .map((p) => (p.cls === "page" ? { ...p, cls: "content" as const, kind: p.kind ?? ("graphic" as const), swap: false } : p))
    .filter((p) => !p.swap && !p.rebuild)
    // A full-slide photo is placed as a picture here: the new slide is not that page.
    .map((p) => (p.cls === "backdrop" ? { ...p, cls: "content" as const } : p))
    .slice(0, MAX_PICTURES);
}

const UPLOAD_PICTURES_RULE = `ORIGINAL PICTURES FROM THE UPLOAD (FIRST RULE for these pictures; overrides the photo, logo and placeholder rules for them): the uploaded file has pictures its content depends on, already extracted and listed below by the SOURCE PAGE they sit on. Put each one on the slide that presents that page's content, exactly once, as the given <img> tag with its data-asset and src attributes UNCHANGED (never write any other /api/assets URL), with an inline width and height in px matching its listed aspect. An activity or question about pictures (name, match, count, sort or describe what you see) shows THE PICTURES THEMSELVES, one per item, never their names or the answers written out in their place. A photo of a real person, place or event, a chart, map, table image or scan is shown as itself, never replaced by a generated image, an icon or a drawing. Never crop away a picture's subject or cover it with text; a picture with words on it is shown whole. A picture whose content the deck leaves out may be left out. Pictures not listed are not carried: do not recreate them.`;

/** The prompt block for the kept pictures: the rule, then each source page's pictures. "" when none. */
export function uploadPicturesBlock(projectId: string, pictures: readonly CarriedPicture[]): string {
  if (pictures.length === 0) return "";
  const pages = [...new Set(pictures.map((p) => p.slideIndex))].sort((a, b) => a - b);
  const lists = pages
    .map((i) =>
      carriedSlideBlock(
        i + 1,
        projectId,
        pictures.filter((p) => p.slideIndex === i),
        [],
      ).replace(/── SLIDE (\d+): ORIGINAL PICTURES[^─]*──/g, "── SOURCE PAGE $1: PICTURES ──"),
    )
    .join("");
  return [
    UPLOAD_PICTURES_RULE,
    ...(pictures.some((p) => p.logo) ? [CARRIED_LOGO_RULE] : []),
    ...(pictures.some((p) => p.kind === "document") ? [CARRIED_SCREENS_RULE] : []),
    "",
    lists.trim(),
    "",
  ].join("\n");
}
