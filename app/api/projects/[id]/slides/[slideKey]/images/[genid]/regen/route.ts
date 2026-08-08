// POST /api/projects/[id]/slides/[slideKey]/images/[genid]/regen
//
// Regenerate ONE AI image box in place with an edited prompt (§19). The user
// edits the box's prompt in the editor pill and confirms; this fires the
// EXISTING per-box `deck.image.warm` pipeline for that single box.
//
// Why this needs no new generation machinery: the image identity is
// (genid, hash) where hash = genImageIdentityHash(prompt, ref). Because the prompt CHANGED,
// the deterministic storage path (`${projectId}/gen/${genid}-${hash}.png`) is
// NEW — so warm generates fresh there with no dedup/existence collision and the
// bill-once contract is preserved. (Same prompt re-confirmed = the warm
// function's existence check re-broadcasts the stored URL, no re-bill.)
//
// Persistence: the box's `data-genimage` is updated client-side and committed
// as a normal slide edit; the status route then DERIVES the box's URL from
// `genImageIdentityHash(data-genimage, data-genref)`. We ALSO clear the latest
// version's
// GeneratedImage row (prompt = new prompt, status = "generating",
// storageUrl = null) so the status route's "ready row" shortcut
// (status === "ready" && storageUrl != null) doesn't keep serving the OLD
// image's URL — once cleared it falls through to the hash-derived fresh URL.

import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api/rate-limit";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { genImageIdentityHash } from "@/lib/images/store";
import { scanGenImages, type GenImageAspect } from "@/lib/images/slide-images";

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

  // Flood guard: bound distinct-prompt regen churn so it can't burn unbounded
  // gpt-image COGS. Keyed on the authenticated owner and placed AFTER input
  // validation, so only requests eligible to enqueue deck.image.warm burn
  // quota (a malformed request can't lock a user out of their own budget).
  // Same-prompt re-confirms stay bill-once via the warm existence check.
  const limited = rateLimited(`image-regen:${access.user.id}`, 20, 5 * 60_000);
  if (limited) return limited;

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
            select: { id: true, slideJson: true },
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

  // Product-photo reference: derived from the STORED slide HTML, never from
  // the client body (a client-supplied ref would be an SSRF vector - the warm
  // pipeline fetches this URL). A prompt edit on a product box keeps producing
  // product images; ordinary boxes scan to null and behave exactly as before.
  let ref: string | null = null;
  {
    const slideJson = presentation.versions[0]?.slideJson as {
      slides?: { html?: unknown }[];
    } | null;
    const slides = Array.isArray(slideJson?.slides) ? slideJson.slides : [];
    outer: for (const s of slides) {
      if (typeof s?.html !== "string") continue;
      for (const m of scanGenImages(s.html)) {
        if (m.genid === genid) {
          ref = m.ref;
          break outer;
        }
      }
    }
  }

  const hash = genImageIdentityHash(prompt, ref);

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
  // versionId scopes the on-failure row mark in deck-image-warm to the SAME
  // version row this route just flipped to "generating" (CR #179) — mid-stream
  // warms from deck-generate omit it and never mark rows.
  await sendInngestEventWithRetry({
    name: "deck.image.warm",
    data: {
      projectId,
      slideKey,
      versionId: latestVersionId,
      box: { genid, prompt, aspect, ref, hash },
      idemKey: `regen:${genid}:${hash}`,
    },
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
