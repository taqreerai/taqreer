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
//
// Modes (2026-10-21): "prompt" (Advanced: the user's own full prompt, the
// original behaviour), "variant" (New version: same idea, a fresh image),
// "change" (the user describes a change in their own language; Haiku folds it
// into the prompt), "restore" (Back to previous: an image already stored, free).
// The server builds the new prompt from the STORED box and returns it; the
// client writes it to data-genimage only after this succeeds. A paid re-roll
// costs IMAGE_REGEN_CREDITS, charged to the deck owner once per new prompt;
// retrying a FAILED box with its own prompt is free.

import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api/rate-limit";
import { sendInngestEventWithRetry } from "@/lib/inngest-helpers";
import { prisma } from "@/lib/prisma";
import { isPaidPlan } from "@/lib/plan";
import { resolveProjectAccess } from "@/lib/api/project-access";
import { generatedImageExists, generatedImageSource, genImageIdentityHash, publicGeneratedImageUrl } from "@/lib/images/store";
import { scanGenImages, type GenImageAspect } from "@/lib/images/slide-images";
import { chargeCredits, refundCredits } from "@/lib/credits/server";
import type { CreditGate402 } from "@/lib/api/regen-helpers";
import {
  IMAGE_REGEN_CREDITS,
  MAX_IMAGE_CHANGE_LEN,
  MAX_IMAGE_PROMPT_LEN,
  bumpVariant,
  mergeImageChange,
} from "@/lib/images/regen-prompt";

// Mirror SAFE_GENID (lib/images/slide-images): the genid flows into a storage
// path, so bound it to a filename-safe charset before it reaches the pipeline.
const GENID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ASPECTS = new Set<GenImageAspect>(["landscape", "portrait", "square"]);
const MODES = new Set(["prompt", "variant", "change", "restore"]);

type Body = { prompt?: unknown; aspect?: unknown; mode?: unknown; change?: unknown };

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
  const mode = typeof raw.mode === "string" && MODES.has(raw.mode) ? raw.mode : "prompt";
  const bodyPrompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const change = typeof raw.change === "string" ? raw.change.trim() : "";
  if ((mode === "prompt" || mode === "restore") && !bodyPrompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (bodyPrompt.length > MAX_IMAGE_PROMPT_LEN) {
    return NextResponse.json({ error: "Prompt is too long" }, { status: 400 });
  }
  if (mode === "change" && (!change || change.length > MAX_IMAGE_CHANGE_LEN)) {
    return NextResponse.json({ error: "Describe the change (300 characters at most)" }, { status: 400 });
  }
  const aspect: GenImageAspect =
    typeof raw.aspect === "string" && ASPECTS.has(raw.aspect as GenImageAspect)
      ? (raw.aspect as GenImageAspect)
      : "landscape";

  // Flood guard: bound distinct-prompt regen churn so it can't burn unbounded
  // gpt-image COGS. Keyed on the authenticated owner and placed AFTER input
  // validation, so only requests eligible to enqueue deck.image.warm burn
  // quota (a malformed request can't lock a user out of their own budget).
  const limited = rateLimited(`image-regen:${access.user.id}`, 20, 5 * 60_000);
  if (limited) return limited;

  // The LATEST version is the one the status route reads GeneratedImage rows
  // from (`presentation.versions[0]`, ordered versionNumber desc). Update the
  // same row so the status derivation lines up.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      user: { select: { role: true } },
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
  if (!project || !presentation || !latestVersionId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // The STORED box: its current prompt (the base for variant / change) and its
  // product-photo reference. The ref is derived from the stored slide HTML,
  // never from the client body (a client-supplied ref would be an SSRF vector:
  // the warm pipeline fetches this URL). A prompt edit on a product box keeps
  // producing product images; ordinary boxes scan to null and behave as before.
  let ref: string | null = null;
  let storedPrompt: string | null = null;
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
          storedPrompt = m.prompt;
          break outer;
        }
      }
    }
  }
  if ((mode === "variant" || mode === "change") && !storedPrompt) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Back to previous: only an image that is already stored (no generation, free).
  if (mode === "restore") {
    const hash = genImageIdentityHash(bodyPrompt, ref);
    if (!(await generatedImageExists(projectId, genid, hash).catch(() => false))) {
      return NextResponse.json({ error: "Previous image not found" }, { status: 404 });
    }
    const url = publicGeneratedImageUrl(projectId, genid, hash);
    // Its source (Pexels / library / AI) as stored beside it; "" if unknown.
    const size = await generatedImageSource(projectId, genid, hash);
    await prisma.generatedImage.upsert({
      where: { presentationVersionId_genid: { presentationVersionId: latestVersionId, genid } },
      update: { prompt: bodyPrompt, aspect, status: "ready", storageUrl: url, size },
      create: {
        presentationVersionId: latestVersionId,
        slideKey,
        genid,
        prompt: bodyPrompt,
        role: "hero",
        aspect,
        status: "ready",
        storageUrl: url,
        size,
      },
    });
    return NextResponse.json({ ok: true, prompt: bodyPrompt, prevPrompt: storedPrompt, url, charged: 0 });
  }

  const prompt =
    mode === "variant"
      ? bumpVariant(storedPrompt!)
      : mode === "change"
        ? await mergeImageChange(storedPrompt!, change)
        : bodyPrompt;
  const hash = genImageIdentityHash(prompt, ref);

  // Free accounts get generated images on their trial deck at 0 credits
  // (lib/images/images-gating, 2026-10-04) but no free re-rolls: on the free
  // plan this route only RETRIES a box whose image failed. Re-rolling a working
  // image needs a paid plan. Admins are exempt.
  const regenUser = access.user.prismaId
    ? await prisma.user.findUnique({
        where: { id: access.user.prismaId },
        select: { plan: true, role: true },
      })
    : null;
  const paid = !!regenUser && (regenUser.role === "admin" || isPaidPlan(regenUser.plan));
  let isRetry = false;
  if (!paid) {
    // Atomic claim (check + flip in one statement) so parallel requests can't
    // all pass while the row still reads "failed".
    const claimed = await prisma.generatedImage.updateMany({
      where: { presentationVersionId: latestVersionId, genid, status: "failed" },
      data: { status: "generating" },
    });
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "images_regen_locked" }, { status: 402 });
    }
    isRetry = true;
  } else if (mode === "prompt" && prompt === storedPrompt) {
    // A paid retry of a FAILED box with its own prompt is free too.
    const row = await prisma.generatedImage.findUnique({
      where: { presentationVersionId_genid: { presentationVersionId: latestVersionId, genid } },
      select: { status: true },
    });
    isRetry = row?.status === "failed";
    // The same prompt resolves to the same stored image: never charge for it.
    if (!isRetry) return NextResponse.json({ error: "same_prompt" }, { status: 409 });
  }

  // Charge the deck OWNER (like every AI edit), once per new prompt: the key is
  // the box + its new identity, so a double click or a retry of the same new
  // image is never charged twice.
  const chargeKey = `image-regen:${projectId}:${genid}:${hash}`;
  let charged = 0;
  if (!isRetry) {
    const res = await chargeCredits({
      userId: project.userId,
      chargeKey,
      amount: IMAGE_REGEN_CREDITS,
      metadata: { kind: "image_regen", projectId, genid, mode },
      waive: project.user.role === "admin",
    });
    if (!res.ok) {
      const balance = "balance" in res && typeof res.balance === "number" ? res.balance : 0;
      const gate: CreditGate402 = {
        error: "insufficient_credits",
        balance,
        slideCap: null,
        minFlowTier: null,
        options: {
          reducedSlides: null,
          reducedCredits: null,
          cheaperPresets: [],
          topupGap: Math.max(1, IMAGE_REGEN_CREDITS - balance),
        },
      };
      return NextResponse.json(gate, { status: 402 });
    }
    charged = res.alreadyHeld ? 0 : res.amountHeld;
  }

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
  try {
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
  } catch (err) {
    // Nothing will run: give the credits back.
    if (charged > 0) {
      await refundCredits({
        userId: project.userId,
        amount: charged,
        refundKey: `${chargeKey}:dispatch-failed`,
        reason: "Image regeneration could not start",
      }).catch(() => {});
    }
    throw err;
  }

  return NextResponse.json({ ok: true, prompt, prevPrompt: storedPrompt, charged }, { status: 202 });
}
