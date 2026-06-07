// POST /api/projects/[id]/slides/[slideKey]/images/[genid]/regen
//
// Regenerate ONE AI image box in place with an edited prompt (§19). The user
// edits the box's prompt in the editor pill and confirms; this fires the
// EXISTING per-box `deck.image.warm` pipeline for that single box.
//
// Why this needs no new generation machinery: the image identity is
// (genid, hash) where hash = genImageHash(prompt). Because the prompt CHANGED,
// the deterministic storage path (`${projectId}/gen/${genid}-${hash}.png`) is
// NEW — so warm generates fresh there with no dedup/existence collision and the
// bill-once contract is preserved. (Same prompt re-confirmed = the warm
// function's existence check re-broadcasts the stored URL, no re-bill.)
//
// Persistence: the box's `data-genimage` is updated client-side and committed
// as a normal slide edit; the status route then DERIVES the box's URL from
// `genImageHash(data-genimage)`. We ALSO clear the latest version's
// GeneratedImage row (prompt = new prompt, status = "generating",
// storageUrl = null) so the status route's "ready row" shortcut
// (status === "ready" && storageUrl != null) doesn't keep serving the OLD
// image's URL — once cleared it falls through to the hash-derived fresh URL.

import { NextResponse } from "next/server";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { genImageHash } from "@/lib/images/store";
import type { GenImageAspect } from "@/lib/images/slide-images";

// Mirror SAFE_GENID (lib/images/slide-images): the genid flows into a storage
// path, so bound it to a filename-safe charset before it reaches the pipeline.
const GENID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ASPECTS = new Set<GenImageAspect>(["landscape", "portrait", "square"]);
// gpt-image prompts are textless scene descriptions — a generous but bounded
// cap (the original generated prompts run well under this).
const MAX_PROMPT_LEN = 1000;

type Body = { prompt?: unknown; aspect?: unknown };

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; slideKey: string; genid: string }> },
) {
  const { id: projectId, slideKey, genid } = await params;

  if (!GENID_RE.test(genid)) {
    return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  }

  // Owner/edit only — the pill hides the button for view/comment roles, the
  // route enforces it as defense-in-depth.
  const access = await resolveProjectAccess(projectId, "edit");
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let raw: Body;
  try {
    raw = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LEN) {
    return NextResponse.json({ error: "Prompt is too long" }, { status: 400 });
  }
  const aspect: GenImageAspect =
    typeof raw.aspect === "string" && ASPECTS.has(raw.aspect as GenImageAspect)
      ? (raw.aspect as GenImageAspect)
      : "landscape";

  // The LATEST version is the one the status route reads GeneratedImage rows
  // from (`presentation.versions[0]`, ordered versionNumber desc). Update the
  // same row so the status derivation lines up.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      presentation: {
        select: {
          id: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  const presentation = project?.presentation;
  const latestVersionId = presentation?.versions[0]?.id;
  if (!presentation || !latestVersionId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const hash = genImageHash(prompt);

  // Clear the stale "ready" row so the status route stops serving the previous
  // prompt's URL and falls through to the hash-derived URL for the new prompt.
  // Upsert so a box without a row yet (never reconciled) still gets one.
  // Best-effort: a failure here doesn't block the regen — the live
  // `slide.image.ready` broadcast still swaps the canvas this session.
  try {
    await prisma.generatedImage.upsert({
      where: {
        presentationVersionId_genid: {
          presentationVersionId: latestVersionId,
          genid,
        },
      },
      update: {
        prompt,
        aspect,
        status: "generating",
        storageUrl: null,
      },
      create: {
        presentationVersionId: latestVersionId,
        slideKey,
        genid,
        prompt,
        role: "hero",
        aspect,
        status: "generating",
      },
    });
  } catch (err) {
    console.warn(
      `[image-regen] GeneratedImage row update failed for ${genid}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Fire the existing per-box warm pipeline. idemKey dedups a double-click on
  // the same new prompt; the existence/idempotency layers keep it bill-once.
  await sendInngestEventWithRetry({
    name: "deck.image.warm",
    data: {
      projectId,
      slideKey,
      box: { genid, prompt, aspect, hash },
      idemKey: `regen:${genid}:${hash}`,
    },
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
