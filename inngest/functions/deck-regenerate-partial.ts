import Anthropic from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { holdCredits, settleHold } from "@/lib/credits/server";
import { regenCost } from "@/lib/credits/cost";
import { prisma } from "@/lib/prisma";
import {
  SLIDE_DIMENSIONS,
  SlideManifestSchema,
  type SlideFormat,
  type SlideManifest,
} from "@/lib/schema/slide";
import { paramsForQuality } from "@/lib/anthropic/quality-params";
import { isQuality, type Quality } from "@/lib/types/quality";
import { COMPOSITION_RULES } from "@/inngest/prompts/composition-rules";
import { themeToCssVars } from "@/lib/export/theme-css-vars";
import { scopeDeckCss, unscopeDeckCss } from "@/lib/deck/scope-css";
import { recordSlidePartialRegen } from "@/lib/db/slide-versioning";
import { broadcastToProject } from "@/lib/realtime/server-broadcast";
import { fanOutNotification } from "@/lib/notifications/server";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the runtime environment");
  }
  return new Anthropic({ apiKey });
}

// Heartbeat stage taxonomy. Phase ordering decides which heartbeat
// wins when two race through the read-modify-write window on
// `slideJson.progress` — later phases beat earlier ones even when
// `currentSlide` hasn't advanced. Module-scope (not handler-scope)
// so `readProgress` + `writeHeartbeat` can share one source of truth.
type HeartbeatStage = "designing" | "validating" | "saving";
const PHASE_ORDER: Record<HeartbeatStage, number> = {
  designing: 0,
  validating: 1,
  saving: 2,
};

// Defensive narrowing for the `slideJson.progress` block read by the
// heartbeat's monotonic guard. The column is Prisma `Json`, so the
// shape we expect (`{ stage, currentSlide, ... }`) is only a
// convention. Returns undefined when nothing matches — the caller
// treats that as "no prior progress recorded yet".
type ProgressBlock = {
  stage?: HeartbeatStage;
  currentSlide?: number;
  estimatedTotal?: number;
};
function readProgressBlock(slideJson: unknown): ProgressBlock | undefined {
  if (!slideJson || typeof slideJson !== "object") return undefined;
  const progress = (slideJson as { progress?: unknown }).progress;
  if (!progress || typeof progress !== "object") return undefined;
  const p = progress as Record<string, unknown>;
  return {
    stage:
      p.stage === "designing" || p.stage === "validating" || p.stage === "saving"
        ? p.stage
        : undefined,
    currentSlide: typeof p.currentSlide === "number" ? p.currentSlide : undefined,
    estimatedTotal:
      typeof p.estimatedTotal === "number" ? p.estimatedTotal : undefined,
  };
}

// Mid-stream progress heartbeat. Reads the current `slideJson.progress`,
// drops the write if it would regress (out-of-order race-loss), else
// writes the new stage/currentSlide. Per project convention there's
// no try/catch here — the call sites use `Promise.allSettled` (for
// parallel batches) or `.catch(noop)` (for the two await points) so
// a heartbeat blip can't fail the regen.
async function writeHeartbeat(
  versionId: string,
  totalTargets: number,
  currentSlide: number,
  stage: HeartbeatStage,
): Promise<void> {
  const current = await prisma.presentationVersion.findUnique({
    where: { id: versionId },
    select: { slideJson: true },
  });
  const existing =
    (current?.slideJson as Record<string, unknown> | null) ?? {};
  const existingProgress = readProgressBlock(existing);
  const existingPhaseOrder =
    PHASE_ORDER[existingProgress?.stage ?? "designing"];
  const newPhaseOrder = PHASE_ORDER[stage];
  const sameOrLaterPhase = newPhaseOrder >= existingPhaseOrder;
  const advancesSlide =
    currentSlide >= (existingProgress?.currentSlide ?? 0);
  if (!sameOrLaterPhase || (!advancesSlide && newPhaseOrder === existingPhaseOrder)) {
    // Out-of-order or backwards regression — drop silently. The next
    // in-order heartbeat will catch the poller up.
    return;
  }
  await prisma.presentationVersion.update({
    where: { id: versionId },
    data: {
      slideJson: {
        ...existing,
        status: "regenerating",
        progress: {
          stage,
          currentSlide,
          estimatedTotal: totalTargets,
        },
      } as never,
    },
  });
}

// Per-step token usage shape. Stays as a discrete type instead of
// inline object literals so the reducer + the EMPTY constant share
// one source of truth.
type RegenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};
const EMPTY_USAGE: RegenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};
function sumUsage(a: RegenUsage, b: RegenUsage): RegenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

// Pick the regen mode for a single slide. A slide carrying user
// comments lands in `apply-comments` (strict preservation); a
// commentless slide in a batch lands in `redesign` (variation
// required). The user-message builder + the system-prompt picker
// in the handler must agree on this — this helper is the single
// source of truth they both call.
function pickRegenMode(
  comments: ReadonlyArray<{ slideId: string }>,
  slideId: string,
): RegenMode {
  return comments.some((c) => c.slideId === slideId)
    ? "apply-comments"
    : "redesign";
}

// Logger shape we accept. Matches Inngest's `logger.warn` surface
// without coupling to the full LoggerInstance type — keeps the
// helpers callable from tests that don't have Inngest in scope.
type WarnLogger = { warn: (msg: string, meta?: Record<string, unknown>) => void };

// Run a fire-and-forget broadcast / notification across a slide
// batch. The promise is intentionally NOT awaited at the call site;
// failures get logged but never reach the surrounding step. Replaces
// three near-identical inline loops (started broadcast, finished
// broadcast, notification fan-out) plus the onFailure swallow shape.
function fireAndForgetForSlides(
  slideIds: ReadonlyArray<string>,
  label: string,
  logger: WarnLogger,
  fn: (slideId: string) => Promise<unknown>,
): void {
  for (const slideId of slideIds) {
    fn(slideId).catch((err) => {
      logger.warn(`${label} failed`, {
        slideId,
        error: String(err),
      });
    });
  }
}

// Narrow the onFailure event's nested original-event payload to the
// fields we read. Keeps the orchestration block in the failure
// handler readable; mirrors the discriminated-union cleanup landed
// in `deck-generate.ts` (commit c9042ec).
function readOriginalEvent(eventData: unknown): Partial<RegenPartialEvent> {
  if (!eventData || typeof eventData !== "object") return {};
  const inner = (eventData as { event?: { data?: unknown } }).event?.data;
  if (!inner || typeof inner !== "object") return {};
  return inner as Partial<RegenPartialEvent>;
}

// Focused system prompt for single-slide regen. Two modes, branched on
// whether the user supplied comments:
//
//   • apply-comments — strict preservation. The user pinned specific
//     elements with bounding-box comments; we change ONLY what they
//     called out and keep everything else verbatim. Same vocab, same
//     coordinates. Minimal-diff is the explicit goal.
//
//   • redesign — variation REQUIRED. The toolbar's "أعد تصميم الشريحة"
//     pill posts an empty comments array and means "redesign this
//     slide in a better way". Without the branch, the apply-comments
//     preservation rules + "don't drift to a different vocabulary"
//     line literally instruct Claude to keep everything the same — so
//     it does. Bug 2026-05-24: actor reported "regenerated with exactly
//     the same design". Redesign mode swaps those rules for an explicit
//     "make it visually different" brief.
//
// We DON'T re-emit the full design rule set from deck-generate.ts —
// Claude already knows them from training. Instead we drill in on the
// things that go wrong in partial mode: producing only HTML (not JSON),
// matching the surrounding deck's chrome, and (apply-comments mode)
// minimal-diff behaviour. Canvas dims are format-aware so 9:16 decks
// regen at 1080×1920 instead of being silently downgraded to 16:9.
type RegenMode = "apply-comments" | "redesign";

function buildPartialSystemPrompt(
  format: SlideFormat,
  mode: RegenMode,
): string {
  const { width, height } = SLIDE_DIMENSIONS[format];

  const intentBlock =
    mode === "apply-comments"
      ? `USER COMMENTS — apply faithfully, minimally
- Each comment carries a slide-space bounding box (x, y, w, h in 0..${width}, 0..${height}) pointing at the element the user wants changed. Use the box to disambiguate which element they meant.
- Apply only what the comment asks. If the comment says "make this headline bigger", scale 1.2-1.5×, not 3×. If it says "change colour", change just the colour. Aim for minimal diff from the existing slide.
- **PRESERVATION RULE — strict.** If the comment doesn't mention placement, the element's position and surrounding layout MUST stay identical. If it doesn't mention size, dimensions stay identical (except the specific text run referenced, if any). If it doesn't mention removal, nothing is removed. Every element the comment didn't reference is kept verbatim — same tag, same coordinates, same children. A colour-only comment changes ONLY the colour token.
- If the comment is ambiguous, prefer the conservative interpretation.
- If multiple comments conflict, the later one wins (comments are listed in submission order).`
      : `REDESIGN BRIEF — variation REQUIRED
- The user has NOT pinned specific changes; they hit "redesign this slide" wanting a fresh visual approach. Your task is to produce a slide that delivers the SAME information but in a visually DIFFERENT composition. Outputting the same HTML (or a cosmetic tweak of it) is a failure mode.
- **Keep all CONTENT verbatim**: every headline, sub-headline, body paragraph, list item, label, statistic, caption, footer line. Same words, same meaning, same emphasis. Translation / paraphrasing is forbidden.
- **Vary the FORM**: composition, layout, visual rhythm, hierarchy, alignment, negative-space distribution, decorative-graphic vocabulary, icon choices, accent shapes. Pick a noticeably different layout strategy than the current slide — if the current is a centred hero, try a split-axis composition; if it's a card grid, try a flowing column with a strong featured item; if it's text-heavy left + graphic right, try inverted or stacked.
- **Theme stays locked** — same palette tokens, same font families, same brand mark, same chrome (pagination, footer). Variation is in composition, NOT in colour or type system.
- Pick ONE strong design idea and commit to it. Don't hedge by producing a mild remix that reads the same at thumbnail scale — the user will see this side-by-side with the previous version in History and should immediately recognise that the layout changed.`;

  const designAnchorBlock =
    mode === "apply-comments"
      ? `DESIGN RULES — keep what already works
- The active slide's existing HTML is your strongest style anchor. Match its font sizing scale, line-heights, padding rhythm, decorative SVG style. Don't drift to a different design vocabulary just because you're regenerating.`
      : `DESIGN RULES — anchor on the DECK, not the slide
- Read the sibling slides for the deck's vocabulary (font scale, line-height rhythm, padding system, decorative-SVG idiom). Stay within that family.
- The CURRENT slide's HTML is a CONTENT reference (read it to find the headline, body, lists). It is NOT a layout anchor — you are explicitly replacing its layout.`;

  return `You are regenerating ONE slide of an existing presentation. The rest of the deck is fixed — chrome (header row, footer row, brand mark, pagination), theme (palette, fonts, background), and slide-level margins stay locked.

OUTPUT — STRICT
- Return ONLY the new HTML for the active slide. No JSON. No markdown fences. No prose. No explanation.
- Start with the slide root element (typically a single \`<div style="position:relative; width:${width}px; height:${height}px; ...">…</div>\`). Inline \`<style>\` tags are allowed inside the slide HTML.
- Do NOT include <!DOCTYPE>, <html>, <head>, <body>. Slide body content only.

CANVAS — same as the rest of the deck
- ${width}×${height} fixed canvas (${format}). The slide root sets width:${width}px / height:${height}px.
- Set \`dir="rtl"\` or \`dir="ltr"\` on the slide root to match the deck's direction (the brief tells you which).
- Use the SAME slide-level margin (inset) as the sibling slides — read it off the SIBLING SLIDE EXCERPTS in the user message and replicate.

CHROME — match siblings exactly
- The deck's chrome is the visual signature that ties slides together: brand mark position, breadcrumb / kicker, pagination ("01 / 12"), footer text. Read the SIBLING SLIDE EXCERPTS, identify the chrome pattern, and reproduce it on this slide IN THE SAME POSITION AND STYLE.
- Pagination must say "(this slide's number) / (total slides)". Use the slide's role to decide whether chrome belongs (cover and closing slides often omit pagination / brand mark — check siblings to see what the deck does).

THEME — locked
- Use the same theme tokens (\`var(--primary)\`, \`var(--accent)\`, \`var(--brand-bg)\`, etc.) as the rest of the deck. Do not introduce new fonts or hex colours not present in the theme.

${intentBlock}

STATIC DELIVERABLE
- No animation, no transition, no \`:hover\`, no JavaScript. Same as the rest of the deck.

${COMPOSITION_RULES}

${designAnchorBlock}
- Decorative graphics stay inline <svg>. Icons stay inline <svg> (not icon fonts).
- **Icons: use Lucide** (https://lucide.dev/icons) — inline \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\` with the path data from lucide.dev. Material icons (https://fonts.google.com/icons) are an acceptable fallback. NEVER icon fonts.
- Webfont URLs must be on \`fonts.googleapis.com\` / \`fonts.gstatic.com\`.

DECORATIVE GRAPHICS — keep them relevant
- **Every graphic must mean something.** Don't add generic blobs, random circles, or vague decorative shapes that don't connect to the slide's idea. If you can't name what the shape represents in one phrase, cut it.
- Icons must match the concept on the card: a card about users gets a \`users\` icon, a security card gets a \`shield\` icon. Don't pick a random Lucide glyph because the card looks empty — pick one that names the idea.

Return ONLY the new slide HTML now.`;
}

// Trim a sibling slide's HTML to roughly the chrome-bearing prefix + suffix.
// Chrome typically lives in the first 600-800 chars (slide root style,
// header row, kicker) and the last 400-600 chars (footer, pagination, brand
// mark) — the body is what we want to drop. Returns a single string with an
// elision marker so Claude can see the truncation happened.
function sliceForChrome(html: string): string {
  if (html.length <= 1600) return html;
  const head = html.slice(0, 800);
  const tail = html.slice(-600);
  return `${head}\n  /* ... slide body elided (${html.length - 1400} chars) ... */\n${tail}`;
}

type Bounds = { x: number; y: number; w: number; h: number };
type CommentInput = {
  slideId: string;
  content: string;
  boundsJson: Bounds | null;
};

function buildPartialUserMessage(
  manifest: SlideManifest,
  targetSlideId: string,
  comments: CommentInput[],
): string {
  const slide = manifest.slides.find((s) => s.slideId === targetSlideId);
  if (!slide) throw new Error(`Slide ${targetSlideId} not in manifest`);

  const siblings = manifest.slides
    .filter((s) => s.slideId !== targetSlideId)
    .map((s) => {
      const number = manifest.slides.findIndex((m) => m.slideId === s.slideId) + 1;
      return `--- Slide ${number} (${s.role ?? "content"}, id: ${s.slideId}) ---\n${sliceForChrome(s.html)}`;
    })
    .join("\n\n");

  const activeNumber =
    manifest.slides.findIndex((s) => s.slideId === targetSlideId) + 1;
  const totalSlides = manifest.slides.length;

  const slideComments = comments.filter((c) => c.slideId === targetSlideId);
  // Mode is decided HERE (not at the call site) because the call site
  // can't know whether a particular slide in the batch actually has
  // comments — the function may be regenerating N slides where only
  // some carry comments and the rest are pure redesigns. Per-slide
  // branching reads more naturally from the message itself. `pickRegenMode`
  // is the shared helper the orchestrator uses to pick its matching
  // system prompt — keeps the two branches locked in step.
  const mode = pickRegenMode(comments, targetSlideId);

  const intentSection =
    mode === "apply-comments"
      ? [
          `USER COMMENTS ON THIS SLIDE:`,
          slideComments
            .map((c, idx) => {
              const box = c.boundsJson
                ? `Region (slide-space): x=${Math.round(c.boundsJson.x)} y=${Math.round(c.boundsJson.y)} w=${Math.round(c.boundsJson.w)} h=${Math.round(c.boundsJson.h)}`
                : "Whole-slide comment";
              return `  ${idx + 1}. ${box}\n     "${c.content.replace(/"/g, '\\"')}"`;
            })
            .join("\n"),
        ].join("\n")
      : [
          `REDESIGN REQUEST — no specific comments`,
          `The user wants a fresh visual approach. Keep every piece of content`,
          `(headlines, body text, lists, labels, captions) verbatim — change the`,
          `LAYOUT and composition. The current HTML below is your CONTENT source,`,
          `NOT a layout anchor. Pick a distinctly different composition strategy`,
          `than the current slide; a result that reads the same at thumbnail scale`,
          `is a failure.`,
        ].join("\n");

  // Label for the current-HTML block shifts to match the mode — calling
  // it the "regen target" in redesign mode would lure the model into
  // anchoring on it. "Content reference" makes the role explicit.
  const htmlLabel =
    mode === "apply-comments"
      ? `CURRENT ACTIVE SLIDE HTML (regenerate this one):`
      : `CURRENT ACTIVE SLIDE HTML — content reference only (do NOT replicate its layout):`;

  return [
    `PARTIAL REGEN — ACTIVE SLIDE`,
    ``,
    `Active slide number: ${activeNumber} of ${totalSlides}`,
    `Active slide ID: ${targetSlideId}`,
    `Active slide role: ${slide.role ?? "content"}`,
    `Deck direction: ${manifest.direction}`,
    `Deck language: ${manifest.language}`,
    ``,
    intentSection,
    ``,
    `THEME (locked, do not change) — these are the deck's CSS custom properties; reuse them, never hardcode new colours/fonts:`,
    Object.entries(themeToCssVars(manifest.theme))
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n"),
    ``,
    htmlLabel,
    slide.html,
    ``,
    `SIBLING SLIDE EXCERPTS — read to match chrome / margins / pagination. DO NOT modify any sibling.`,
    siblings,
    ``,
    `Return ONLY the new HTML for the active slide. No JSON, no fences, no prose.`,
  ].join("\n");
}

// Strip code fences or surrounding prose Claude might emit despite the
// instruction. Keep the slide HTML; everything else is noise.
function extractSlideHtml(raw: string): string {
  let text = raw.trim();
  // Strip ```html ... ``` or ``` ... ``` fences.
  const fenceMatch = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

type RegenPartialEvent = {
  projectId: string;
  presentationId: string;
  versionId: string;
  sourceVersionId: string;
  targetSlideIds: string[];
  comments: CommentInput[];
  // Quality preset from the original generation. Plumbed through so a
  // partial regen matches the model + thinking the user picked for the
  // deck — without it every regen used Opus + adaptive + effort:high
  // regardless of the user's fast/medium/quality choice.
  // Optional for backwards compat with in-flight events that predate
  // this field — falls back to "medium" via paramsForQuality's default.
  quality?: Quality | null;
  // Telemetry Job row id allocated by the regen-partial route. Receives
  // the per-regen token-usage breakdown when the function completes.
  // Optional for backwards compat with in-flight pre-telemetry events.
  jobId?: string | null;
  // Prisma User row id of the viewer who clicked Regen. Plumbed into
  // the Phase 16.D `slide.regen.{started,finished}` broadcasts so
  // each receiving client can skip its own self-echo (the actor's
  // tab already drives the dim overlay via local `applying` state;
  // the broadcast is the courtesy signal for OTHER collaborators).
  // Optional for backwards compat with in-flight pre-16.D events.
  actorPrismaUserId?: string | null;
};

export const deckRegeneratePartial = inngest.createFunction(
  {
    id: "deck-regenerate-partial",
    name: "Regenerate Selected Slides with Comments",
    retries: 2,
    triggers: [{ event: "deck.regenerate.partial.requested" }],
    // Terminal failure path — runs once after every retry is exhausted.
    // Marks the queued target version `failed` so the UI's status poller
    // stops spinning and the user can surface the error. Project status
    // is left alone (the previous version is still visible).
    onFailure: async ({ event, error }) => {
      const original = readOriginalEvent(event.data);
      if (!original.versionId) return;
      const { prisma } = await import("@/lib/prisma");
      await prisma.presentationVersion
        .update({
          where: { id: original.versionId },
          data: { status: "failed" },
        })
        .catch((e) => {
          // Last-ditch — the version row may have been deleted; nothing
          // further to do beyond logging the failure (the surrounding
          // Inngest run already records the original error).
          console.error("partial-regen onFailure: status write failed", e, error);
        });
      // Failed regens charge nothing - release the credit hold (keyed
      // the same way the hold step keys it; idempotent / not_found-safe).
      try {
        const { settleHold: release } = await import("@/lib/credits/server");
        await release({
          jobKey: `regen:${original.versionId}`,
          chargeAmount: 0,
          metadata: { status: "failed" },
        });
      } catch (e) {
        console.error("partial-regen onFailure: credit release failed", e);
      }
    },
  },
  async ({ event, step, logger }) => {
    const data = event.data as RegenPartialEvent;
    const {
      projectId,
      versionId,
      sourceVersionId,
      targetSlideIds,
      comments,
    } = data;
    const actorPrismaUserId = data.actorPrismaUserId ?? null;

    // Phase 16.D revised — `slide.regen.started` broadcast IS re-emitted
    // for partial regens (per user request 2026-05-24). The earlier
    // concern was that the started-overlay competed for peers' attention
    // for the full 1-3 min regen window; the user accepts that trade-off
    // because the live spinner is the most legible signal that "someone
    // on the team is changing this slide right now — don't start your
    // own edit yet".
    //
    // ⚠️ MUST be wrapped in `step.run` for memoization. Inngest's
    // executor re-runs the function code from the top after every step
    // checkpoint — anything sitting in the prelude fires once per
    // round. With ~N step.runs after this point (per-slide Claude
    // calls, heartbeat writes, version save), the started broadcast
    // would emit N times → N duplicate spinner overlays. The user
    // reported 2 dup'd started rows during PR #33 testing; step.run
    // dedupes on the step name so the callback runs exactly once
    // across the whole execution.
    //
    // Inside the step we keep the fire-and-forget pattern (don't
    // await broadcastToProject): the step returns the moment the
    // synchronous loop finishes, the unsettled promises continue
    // running in the background, and we avoid the
    // `admin.removeChannel` deadlock that previously hung functions
    // for 5+ min when broadcasts WERE awaited inside step.run.
    //
    // NOTE: bell notifications are NOT fanned out for the started
    // event (dropped 2026-05-27). `*.started` is a transient live-UI
    // signal — by the time the recipient opens the bell, the regen
    // has already finished and the started row is just noise that
    // doubles the badge count. The terminal `slide.regen.finished`
    // notification (fired further down on completion) tells the full
    // story on its own. Project-channel broadcasts above stay so
    // spinner overlays + collaborator banners still fire live.
    await step.run("broadcast-slide-regen-started", () => {
      fireAndForgetForSlides(
        targetSlideIds,
        "broadcast slide.regen.started",
        logger,
        (slideId) =>
          broadcastToProject(projectId, "slide.regen.started", {
            slideId,
            actorPrismaUserId,
          }),
      );
    });

    // Resolve the original deck's quality preset → Claude call params.
    // Falls back to "medium" (the paramsForQuality default) for older
    // in-flight events that predate the `quality` field.
    const eventQuality: Quality | null = isQuality(data.quality)
      ? data.quality
      : null;

    // ─── Credit pre-authorization (billing plan Phase A) ───────────
    // Regen costs perSlide × N (no base). Hold before any Claude call;
    // settle in full after the save, release in onFailure. Keyed by
    // the target version id - one regen run per version row, stable
    // across Inngest retries.
    const regenChargeKey = `regen:${versionId}`;
    const regenAmount = regenCost(
      eventQuality ?? "opus-balanced",
      targetSlideIds.length,
    );
    const regenHold = await step.run("credit-hold", async () => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { userId: true },
      });
      if (!project) {
        return { ok: false as const, reason: "missing_project" as const };
      }
      return holdCredits({
        userId: project.userId,
        jobKey: regenChargeKey,
        amount: regenAmount,
        metadata: {
          kind: "deck.regenerate.partial",
          preset: eventQuality ?? "opus-balanced",
          slides: targetSlideIds.length,
          estimateShown: regenAmount,
        },
      });
    });
    if (!regenHold.ok) {
      throw new NonRetriableError(
        `credit hold refused: ${"reason" in regenHold ? regenHold.reason : "unknown"}`,
      );
    }
    const callParams = paramsForQuality(eventQuality);
    logger.info("partial_regen_quality_preset", {
      quality: eventQuality ?? "medium (default)",
      model: callParams.model,
      thinking: callParams.thinking.type,
      effort: callParams.outputConfig?.effort ?? "n/a",
    });

    // Heartbeat writer — bumps `slideJson.progress.currentSlide` as each
    // per-slide Claude call completes. DeckView's apply-poller treats
    // 60s without progress as a "stuck" signal and surfaces a cancel
    // warning. Without a heartbeat the partial-regen function never
    // updates `currentSlide` (it was previously a Promise.all that wrote
    // nothing mid-run), so the poller false-fired on every regen that
    // ran longer than 60s — even though the worker was healthy.
    //
    // Read-modify-write so we don't clobber the `slides` field the route
    // copied in at version creation (DeckView keeps the previous slides
    // visible while regen runs; wiping them would blank the canvas).
    // Race-safe enough: heartbeats fire post-step.run sequentially in
    // the closure, and Prisma updates are atomic at the DB level so
    // worst case the later write wins with consistent content.
    // Best-effort; failures don't block the regen.
    const totalTargets = targetSlideIds.length;
    // Bound the module-scope `writeHeartbeat` to this run's versionId
    // + target count so the call sites stay short. MONOTONIC PROGRESS
    // GUARD (CR-flagged 2026-05-21) lives inside writeHeartbeat — the
    // per-slide heartbeats below fire concurrently from `Promise.all`
    // and each does its own read-then-write on `slideJson.progress`;
    // the guard drops any write that would regress the stored
    // progress, except when crossing into a later phase (designing →
    // validating → saving).
    const heartbeat = (currentSlide: number, stage: HeartbeatStage) =>
      writeHeartbeat(versionId, totalTargets, currentSlide, stage);

    // Initial pulse — even before any slide closes, tell the poller
    // the run is alive and what shape it'll have. `.catch(noop)` so
    // a heartbeat blip can't fail the regen (the empty try/catch
    // around the body was dropped in the 2026-05-27 simplifier pass;
    // `Promise.allSettled` drains the parallel batch below, and the
    // two direct awaits swallow rejections at the call site).
    await heartbeat(0, "designing").catch(() => {
      /* heartbeat blip — next pulse catches up */
    });

    // Load the source manifest in a step so a retry doesn't re-read the DB
    // unnecessarily. Source = the previous version's manifest; new version
    // starts as a copy and we splice the regenerated slides in.
    const source = await step.run("load-source-manifest", async () => {
      const version = await prisma.presentationVersion.findUnique({
        where: { id: sourceVersionId },
        select: { slideJson: true },
      });
      if (!version) throw new Error(`Source version ${sourceVersionId} not found`);
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `Source manifest invalid: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
        );
      }
      return parsed.data;
    });

    // Resolve the deck format ONCE per job so every per-slide call uses
    // the same dimensions — Claude needs the right canvas size in the
    // system prompt or vertical decks regen at 16:9.
    const sourceFormat: SlideFormat = source.format ?? "16:9";
    // Pre-build BOTH system prompts once so per-slide steps just pick
    // by mode. Two ephemeral caches max (one per mode) instead of a
    // fresh compile per slide. The mode is decided per-slide inside
    // the step (a slide with comments → apply-comments; a slide
    // without → redesign), so a mixed batch transparently picks the
    // right prompt per call.
    const applyCommentsSystemPrompt = buildPartialSystemPrompt(
      sourceFormat,
      "apply-comments",
    );
    const redesignSystemPrompt = buildPartialSystemPrompt(
      sourceFormat,
      "redesign",
    );

    // Fan out per-slide Claude calls. Each runs as its own Inngest step so
    // a single slide's failure produces a partial result we can surface to
    // the user, and step results are cached on retry. Calls run in parallel;
    // a closure-shared counter writes a heartbeat each time one completes so
    // the apply-poller sees forward motion.
    let completedSlides = 0;
    // Collect in-flight heartbeat writes so we can settle them before
    // the validating heartbeat fires. Without this the fire-and-forget
    // `void heartbeat(...)` could outlive its tick and race with the
    // final `validating` write — the later write wins by Prisma's
    // atomic-update semantics but the order is non-deterministic, and
    // CR rightly flagged the read-modify-write window as a real race
    // on `slideJson.progress`.
    const heartbeatWrites: Promise<void>[] = [];
    const regenResults = await Promise.all(
      targetSlideIds.map((slideId) =>
        step.run(`regen-slide-${slideId}`, async () => {
          const client = getClient();
          const userMessage = buildPartialUserMessage(source, slideId, comments);
          // Mode mirrors what buildPartialUserMessage picks internally:
          // a slide with comments → apply-comments (strict preservation);
          // a slide without → redesign (variation required). Keeps the
          // system prompt in sync with the user-message branch.
          // Single source of truth shared with `buildPartialUserMessage`.
          const systemPromptText =
            pickRegenMode(comments, slideId) === "apply-comments"
              ? applyCommentsSystemPrompt
              : redesignSystemPrompt;
          // Use the original deck's quality preset — paramsForQuality
          // gives us model + thinking + effort matching what generated
          // the deck originally (fast / medium / quality / extreme).
          const message = await client.messages.create({
            model: callParams.model,
            max_tokens: 16000,
            thinking: callParams.thinking,
            system: [
              {
                type: "text",
                text: systemPromptText,
                cache_control: { type: "ephemeral" },
              },
            ],
            ...(callParams.outputConfig
              ? { output_config: callParams.outputConfig }
              : {}),
            messages: [{ role: "user", content: userMessage }],
          });
          logger.info("partial_regen_usage", {
            slideId,
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
            cache_read: message.usage.cache_read_input_tokens,
            cache_write: message.usage.cache_creation_input_tokens,
          });
          const textBlock = message.content.find((b) => b.type === "text");
          if (!textBlock || textBlock.type !== "text") {
            throw new Error(`No text block in Claude response for slide ${slideId}`);
          }
          const rawHtml = extractSlideHtml(textBlock.text);
          if (!rawHtml) {
            throw new Error(`Empty HTML returned for slide ${slideId}`);
          }
          // FIX A — re-scope the model's <style> through the canonical scoper.
          // Generation scopes Claude's CSS via scopeDeckCss (emitting BOTH the
          // root-compound `.tq-canvas.x` AND the descendant `.tq-canvas .x`
          // form); the partial regen instead trusted the model to hand-prefix,
          // and it sometimes emitted only the compound form for a NESTED class
          // (`.tq-canvas.uc .uc-ic`) — a selector that matches no element, so
          // the rule is dead and the icons fall to the browser-default ~300px
          // (huge, list broken). unscope → scope rebuilds both forms. Idempotent
          // on already-correct CSS. Applies to every per-slide regen + redesign,
          // every project (the single chokepoint both routes dispatch into).
          const html = rawHtml.replace(
            /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
            (_m, css: string) =>
              `<style>${scopeDeckCss(unscopeDeckCss(css))}</style>`,
          );
          completedSlides += 1;
          // Push the heartbeat promise into the queue (NOT fire-and-
          // forget). We don't await here — that would serialise the
          // per-slide Claude calls. Instead we settle the entire
          // queue once the Promise.all resolves, BEFORE the final
          // validating-stage heartbeat.
          //
          // ⚠️ Heartbeat failures are swallowed by the
          // `Promise.allSettled(heartbeatWrites)` below — NOT inside
          // `writeHeartbeat` itself (the helper has no try/catch as
          // of the 2026-05-27 simplifier pass). If you add a FOURTH
          // call site that awaits `heartbeat(...)` directly, wrap
          // it in `.catch(() => {})` or push into a queue that's
          // later drained by `Promise.allSettled` — otherwise a
          // single failed Prisma write will fail the whole regen.
          heartbeatWrites.push(heartbeat(completedSlides, "designing"));
          return {
            slideId,
            html,
            // Return usage from the step so it survives Inngest's
            // step-result cache on retry — closure-mutated counters
            // would reset across replays.
            usage: {
              inputTokens: message.usage.input_tokens ?? 0,
              outputTokens: message.usage.output_tokens ?? 0,
              cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
              cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
            },
          };
        }),
      ),
    );
    // Drain in-flight heartbeat writes so the next heartbeat lands on
    // top of the latest state, not racing with one still in flight.
    await Promise.allSettled(heartbeatWrites);
    await heartbeat(totalTargets, "validating").catch(() => {
      /* heartbeat blip — non-fatal */
    });

    // Splice the regenerated slides into a fresh copy of the source manifest
    // and persist. We rebuild the manifest object from scratch (vs. mutating
    // the loaded one) so the .slideJson column carries a clean payload — no
    // transient `progress` field left over from the source.
    await step.run("save-new-version", async () => {
      const slides = source.slides.map((s) => {
        const update = regenResults.find((r) => r.slideId === s.slideId);
        if (!update) return s;
        return { ...s, html: update.html };
      });
      const candidate: SlideManifest = {
        version: source.version,
        presentationId: source.presentationId,
        title: source.title,
        language: source.language,
        direction: source.direction,
        // Inherit the source manifest's format (16:9 / 9:16). Without
        // this, the rebuilt manifest has `format: undefined` and every
        // downstream consumer (lightbox, renderer, export) falls back
        // to the 16:9 default — visibly resetting a 9:16 deck back to
        // landscape after a partial regen.
        format: source.format,
        theme: source.theme,
        slides,
      };
      // Validate Claude output before persisting — per inngest/** coding
      // guideline, never write model output to DB without Zod-checking
      // it first. Catches malformed splices (e.g. empty html after
      // sanitisation) before the manifest reaches downstream consumers.
      const parsed = SlideManifestSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(
          `Regenerated manifest failed schema validation: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
        );
      }
      const newManifest = parsed.data;

      // Atomic promotion — write the version, flip the currentVersionId
      // pointer, and mark the project completed in a single transaction.
      // Previously the pointer + project status updates were
      // .catch(() => undefined) best-effort, which could leave
      // PresentationVersion.status="completed" but
      // Presentation.currentVersionId still pointing at the old version.
      // If the transaction throws, Inngest retries the step; if all
      // retries exhaust, `onFailure` (above) marks the target version
      // `failed` as a terminal status.
      await prisma.$transaction([
        prisma.presentationVersion.update({
          where: { id: versionId },
          data: {
            slideJson: newManifest as never,
            status: "completed",
          },
        }),
        prisma.presentation.update({
          where: { id: data.presentationId },
          data: { currentVersionId: versionId },
        }),
        prisma.project.update({
          where: { id: projectId },
          data: { status: "completed" },
        }),
      ]);

      // Regen saved - capture the full held amount (per-slide × N, the
      // exact number quoted at hold time). Idempotent per chargeKey.
      await settleHold({
        jobKey: regenChargeKey,
        chargeAmount: regenAmount,
        metadata: { status: "succeeded", slides: targetSlideIds.length },
      });

      // Per-slide history bookkeeping. One new SlideVersion row per
      // regenerated slide (source="partial_regen"), SlideState
      // pointer bumped, oldest pruned if >10. Lazy-creates state
      // for legacy projects that pre-date the versioning migration.
      // Same step as the transaction above so a retry replays both
      // sides together — Inngest only memoises whole-step success.
      const regenSlides = newManifest.slides.filter((s) =>
        targetSlideIds.includes(s.slideId),
      );
      // Group the dispatched comments by their target slideId so
      // each slide's SlideState caches ONLY its own comments. A
      // clean regen (this whole array is empty) leaves the map
      // empty for every targeted slide — recordSlidePartialRegen
      // then clears each SlideState.cachedComments to SQL NULL.
      // Group dispatched comments by target slideId so each slide's
      // SlideState caches ONLY its own. A clean regen (empty input)
      // leaves the map empty for every targeted slide; the recorder
      // then clears `SlideState.cachedComments` to SQL NULL.
      const commentsBySlide = new Map<string, CommentInput[]>();
      for (const c of comments) {
        const arr = commentsBySlide.get(c.slideId);
        if (arr) arr.push(c);
        else commentsBySlide.set(c.slideId, [c]);
      }
      await recordSlidePartialRegen(
        prisma,
        data.presentationId,
        regenSlides,
        "partial_regen",
        commentsBySlide,
      );
    });

    // Telemetry — sum per-slide usage across the run and write to the
    // Job allocated by the regen route. Pre-billing pass: observability
    // only. Best-effort; failures don't fail the regen since the
    // user-visible work (the new version) is already committed above.
    if (data.jobId) {
      const totals = regenResults
        .map((r) => r.usage)
        .reduce(sumUsage, EMPTY_USAGE);
      await prisma.job
        .update({
          where: { id: data.jobId },
          data: {
            status: "succeeded",
            model: callParams.model,
            quality: eventQuality ?? "medium",
            attempts: regenResults.length,
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            cacheReadTokens: totals.cacheReadTokens,
            cacheCreationTokens: totals.cacheCreationTokens,
          },
        })
        .catch((err) => {
          logger.warn("partial_regen_job_update_failed", {
            jobId: data.jobId,
            error: String(err),
          });
        });
    }

    // Phase 16.D — `slide.regen.finished` broadcasts, fire-and-forget
    // for the same reason as the started broadcast above. The Inngest
    // step that just saved the new version is what other clients
    // care about; the broadcast is just the "go re-fetch now" nudge.
    // If the function returns before the broadcast completes (Vercel
    // freeze, etc.) observers will still pick up the new slides on
    // their next poll / refresh — the regen state was persisted
    // before we got here.
    fireAndForgetForSlides(
      targetSlideIds,
      "broadcast slide.regen.finished",
      logger,
      (slideId) =>
        broadcastToProject(projectId, "slide.regen.finished", {
          slideId,
          actorPrismaUserId,
        }),
    );

    // Phase 16.E — bell notification per regen'd slide. The fan-out
    // helper's 10-minute group window merges N sequential slide
    // regens by the same actor into one bell row, so a partial regen
    // that touched 4 slides produces ONE row ("X redesigned 4 slides")
    // rather than spamming the bell. Fire-and-forget per the same
    // rationale as the broadcasts above.
    fireAndForgetForSlides(
      targetSlideIds,
      "notification slide.regen.finished fanOut",
      logger,
      (slideId) =>
        fanOutNotification({
          type: "slide.regen.finished",
          projectId,
          actorPrismaUserId,
          payload: { slideKey: slideId },
        }),
    );

    return { success: true, regenerated: regenResults.length };
  },
);
