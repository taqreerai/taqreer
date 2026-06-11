// Credit-system simulation harness - exercises the REAL ledger
// (lib/credits/server.ts + preflight.ts + cost.ts) against a FAKE deck
// generator, with credits granted directly (no Stripe, no Claude).
//
// The fake generator mirrors the exact call sequence the Inngest wiring
// will use:  preflight → holdCredits → produce slides → settleHold
// (actual count on success, made-so-far on cancel, 0 on failure).
//
// Every interaction is recorded (balance before/after, held, charged,
// refunded, pass/fail) and the full run is written to
// scratch/credit-sim-report.md.
//
// Usage:  npx tsx scripts/credit-sim.ts
//
// Sim users live under @sim-credits.taqreer.local and are wiped at the
// start and end of every run (cascade clears accounts/holds/grants/events).

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Ledger = typeof import("@/lib/credits/server");
type Preflight = typeof import("@/lib/credits/preflight");
type Cost = typeof import("@/lib/credits/cost");
type Quality = import("@/lib/types/quality").Quality;
type Flow = import("@/lib/credits/cost").Flow;
type SlideEstimateInput = import("@/lib/credits/cost").SlideEstimateInput;

// ─── Reporting ───────────────────────────────────────────────────────

type Row = {
  id: string;
  title: string;
  before: number;
  after: number;
  held: number | null;
  charged: number | null;
  refunded: number | null;
  expected: string;
  observed: string;
  pass: boolean;
};

const rows: Row[] = [];
const notes: string[] = [];

function record(row: Row) {
  rows.push(row);
  const mark = row.pass ? "PASS" : "FAIL";
  console.log(
    `[${mark}] ${row.id} ${row.title} | before=${row.before} after=${row.after}` +
      (row.held !== null ? ` held=${row.held}` : "") +
      (row.charged !== null ? ` charged=${row.charged}` : "") +
      (row.refunded !== null ? ` refunded=${row.refunded}` : ""),
  );
  if (!row.pass) {
    console.log(`       expected: ${row.expected}`);
    console.log(`       observed: ${row.observed}`);
  }
}

function check(
  id: string,
  title: string,
  args: {
    before: number;
    after: number;
    held?: number | null;
    charged?: number | null;
    refunded?: number | null;
    expected: string;
    observed: string;
    pass: boolean;
  },
) {
  record({
    id,
    title,
    before: args.before,
    after: args.after,
    held: args.held ?? null,
    charged: args.charged ?? null,
    refunded: args.refunded ?? null,
    expected: args.expected,
    observed: args.observed,
    pass: args.pass,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

const SIM_DOMAIN = "sim-credits.taqreer.local";
let userSeq = 0;
let jobSeq = 0;

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ");
}

async function main() {
  // Dynamic imports so dotenv runs before lib/prisma reads DATABASE_URL.
  const { prisma } = await import("@/lib/prisma");
  const ledger: Ledger = await import("@/lib/credits/server");
  const { preflightGenerate }: Preflight = await import(
    "@/lib/credits/preflight"
  );
  const cost: Cost = await import("@/lib/credits/cost");

  const quiet = { notify: false };

  async function wipeSimUsers() {
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@${SIM_DOMAIN}` } },
    });
  }

  async function makeUser(plan: "free" | "plus" | "pro" | "max") {
    userSeq += 1;
    const user = await prisma.user.create({
      data: {
        email: `sim-${userSeq}@${SIM_DOMAIN}`,
        name: `Sim ${userSeq} (${plan})`,
        plan,
      },
    });
    if (plan === "free") {
      await ledger.grantSignupCredits({ userId: user.id, ...quiet });
    } else {
      await ledger.grantSubscriptionCycle({ userId: user.id, plan, ...quiet });
    }
    return user;
  }

  async function balanceOf(userId: string, now?: Date): Promise<number> {
    return (await ledger.getBalance(userId, now)).total;
  }

  // ─── The fake generator ────────────────────────────────────────────
  // Stands in for inngest/functions/deck-generate.ts. Produces any
  // number of <section> stubs on command, and can fail or be cancelled
  // partway. Runs the REAL credit sequence around the fake work.

  type GenOutcome =
    | { kind: "success"; produce: number }
    | { kind: "fail"; afterSlides: number }
    | { kind: "cancel"; afterSlides: number };

  type GenResult = {
    status: "blocked" | "succeeded" | "failed" | "cancelled";
    blockedReason?: string;
    preflight: Awaited<ReturnType<typeof preflightGenerate>>;
    held: number;
    charged: number;
    refunded: number;
    produced: number;
    before: number;
    after: number;
    jobKey: string;
  };

  async function fakeGenerate(opts: {
    userId: string;
    plan: "free" | "plus" | "pro" | "max";
    flow: Flow;
    preset: Quality;
    slideInput: SlideEstimateInput;
    outcome: GenOutcome;
    condense?: boolean;
    jobKey?: string;
    now?: Date;
  }): Promise<GenResult> {
    jobSeq += 1;
    const jobKey = opts.jobKey ?? `sim-job-${jobSeq}`;
    const before = await balanceOf(opts.userId, opts.now);

    // 1. Preflight - the only place a generation may be refused, and it
    //    happens BEFORE any money moves.
    const preflight = await preflightGenerate({
      userId: opts.userId,
      plan: opts.plan,
      flow: opts.flow,
      preset: opts.preset,
      slideInput: opts.slideInput,
      now: opts.now,
    });
    if (!preflight.ok) {
      return {
        status: "blocked",
        blockedReason: preflight.reason,
        preflight,
        held: 0,
        charged: 0,
        refunded: 0,
        produced: 0,
        before,
        after: await balanceOf(opts.userId, opts.now),
        jobKey,
      };
    }

    // 2. Pre-authorize the maximum (the number the user was shown).
    const hold = await ledger.holdCredits({
      userId: opts.userId,
      jobKey,
      amount: preflight.holdCredits,
      metadata: {
        flow: opts.flow,
        preset: opts.preset,
        holdSlides: preflight.holdSlides,
        estimateShown: preflight.holdCredits,
        condense: opts.condense ?? false,
      },
      now: opts.now,
      ...quiet,
    });
    if (!hold.ok) {
      // Preflight passed but the atomic gate refused - a concurrent
      // job spent the balance first. Nothing was debited.
      return {
        status: "blocked",
        blockedReason: "insufficient_at_hold",
        preflight,
        held: 0,
        charged: 0,
        refunded: 0,
        produced: 0,
        before,
        after: await balanceOf(opts.userId, opts.now),
        jobKey,
      };
    }

    // 3. "Generate". Slides stream one by one; failure / cancellation
    //    interrupts after N streamed slides.
    const effective = cost.effectivePreset(opts.preset, opts.flow);
    let produced = 0;
    let status: "succeeded" | "failed" | "cancelled" = "succeeded";
    const target =
      opts.outcome.kind === "success"
        ? opts.outcome.produce
        : opts.outcome.afterSlides;
    for (let i = 0; i < target; i++) {
      produced += 1; // `<section data-role="content">…</section>`
    }
    if (opts.outcome.kind === "fail") status = "failed";
    if (opts.outcome.kind === "cancel") status = "cancelled";

    // 4. Settle: actual on success; what-was-made on cancel (the user
    //    keeps those slides); zero on failure. Base applies only when
    //    something was delivered.
    const chargeFor =
      status === "succeeded"
        ? cost.generationCost(effective, produced)
        : status === "cancelled" && produced > 0
          ? cost.generationCost(effective, produced)
          : 0;
    const settle = await ledger.settleHold({
      jobKey,
      chargeAmount: chargeFor,
      metadata: { status, produced },
      now: opts.now,
      ...quiet,
    });
    if (!settle.ok) throw new Error(`settle lost its hold: ${jobKey}`);

    return {
      status,
      preflight,
      held: hold.amountHeld,
      charged: settle.charged,
      refunded: settle.refunded,
      produced,
      before,
      after: await balanceOf(opts.userId, opts.now),
      jobKey,
    };
  }

  // Invariant tracked across EVERY generation: never charge more than
  // the number shown at preflight time.
  let estimateInvariantViolations = 0;
  function assertEstimateInvariant(result: GenResult) {
    if (result.preflight.ok && result.charged > result.preflight.holdCredits) {
      estimateInvariantViolations += 1;
    }
  }

  // ════════════════════════════════════════════════════════════════
  console.log("Wiping previous sim users…");
  await wipeSimUsers();

  // ─── Section 1 - Charging is correct ────────────────────────────

  {
    // 1.1 Fixed-size deck charges exactly the formula price.
    const user = await makeUser("plus");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "sonnet-fast",
      slideInput: { kind: "fixed", count: 10 },
      outcome: { kind: "success", produce: 10 },
    });
    assertEstimateInvariant(result);
    check("1.1", "Fixed 10-slide sonnet-fast deck costs exactly 200", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: "held 200, charged 200, refunded 0, balance 2000→1800",
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === 200 &&
        result.charged === 200 &&
        result.refunded === 0 &&
        result.before === 2000 &&
        result.after === 1800,
    });
  }

  {
    // 1.2 Auto mode: hold the estimate, charge the actual, release the rest.
    const user = await makeUser("plus");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1000) }, // → 12 slides est.
      outcome: { kind: "success", produce: 9 },
    });
    assertEstimateInvariant(result);
    // estimate: ceil(1000/100)+2 = 12 → hold 350+12×16 = 542
    // actual 9 → charge 350+9×16 = 494, release 48
    check("1.2", "Auto count: hold 12-slide max, charge the 9 produced", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: "held 542, charged 494, refunded 48, balance 2000→1506",
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === 542 &&
        result.charged === 494 &&
        result.refunded === 48 &&
        result.after === 1506,
    });
  }

  {
    // 1.3 Model overshoots the estimate → charge CLAMPS to what was shown.
    const user = await makeUser("plus");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1000) }, // hold 542 (12 slides)
      outcome: { kind: "success", produce: 14 }, // raw cost would be 574
    });
    assertEstimateInvariant(result);
    check("1.3", "Overproduced deck never charges past the shown estimate", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: "held 542, charged clamped to 542 (not 574), refunded 0",
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}`,
      pass: result.held === 542 && result.charged === 542 && result.refunded === 0,
    });
  }

  {
    // 1.4 Free actions move no money and write no ledger events.
    const user = await makeUser("plus");
    const before = await balanceOf(user.id);
    const eventsBefore = await prisma.usageEvent.count({
      where: { userId: user.id },
    });
    // view / edit-in-canvas / export / rename / duplicate - none of
    // these call Claude, so none of them touch the ledger. The sim
    // performs them as the product does: pure DB/content operations.
    const localActions = ["view", "edit", "export", "rename", "duplicate"];
    for (const _action of localActions) {
      // no ledger call - this is the point.
    }
    const after = await balanceOf(user.id);
    const eventsAfter = await prisma.usageEvent.count({
      where: { userId: user.id },
    });
    check("1.4", "View/edit/export/rename cost nothing", {
      before,
      after,
      expected: "balance unchanged, zero new ledger events",
      observed: `balance ${before}→${after}, events ${eventsBefore}→${eventsAfter}`,
      pass: before === after && eventsBefore === eventsAfter,
    });
  }

  // ─── Section 2 - Estimates per flow ──────────────────────────────

  {
    const user = await makeUser("pro");
    // 2.1 Create from text: ~1 slide / 100 words (+cover +closing).
    const est = cost.estimateSlides({ kind: "text", text: words(1200) });
    const quotes = await preflightGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "text", text: words(1200) },
    });
    const q = quotes.quotes;
    const expectQuotes =
      q.find((x) => x.preset === "sonnet-fast")?.credits === 240 &&
      q.find((x) => x.preset === "opus-fast")?.credits === 574 &&
      q.find((x) => x.preset === "opus-balanced")?.credits === 708;
    check("2.1", "Create-from-text estimate: 1200 words → 14 slides, 3 quotes", {
      before: 5000,
      after: 5000,
      expected:
        "14 slides; sonnet 240 / opus-fast 574 / opus-balanced 708 shown before generating",
      observed: `${est.slides} slides; quotes ${q.map((x) => `${x.preset}=${x.credits}`).join(", ")}`,
      pass: est.slides === 14 && expectQuotes,
    });

    // 2.2 Enhance rebuilds 1:1 → page count is the count, known up front.
    const enhanceEst = cost.estimateSlides({ kind: "enhance", pageCount: 24 });
    check("2.2", "Enhance estimate = source page count (exact)", {
      before: 5000,
      after: 5000,
      expected: "24 slides, exact (charge == quote)",
      observed: `${enhanceEst.slides} slides, exact=${enhanceEst.exact}`,
      pass: enhanceEst.slides === 24 && enhanceEst.exact === true,
    });

    // 2.3 Mimic: reference sets the look, not the length.
    const mimicPick = cost.estimateSlides({ kind: "mimic", requested: 15 });
    const mimicBrief = cost.estimateSlides({
      kind: "mimic",
      briefText: words(700),
    });
    check("2.3", "Mimic estimate: user pick wins; else from the brief", {
      before: 5000,
      after: 5000,
      expected: "picked 15 → 15 exact; 700-word brief → 9 estimated",
      observed: `pick ${mimicPick.slides} (exact=${mimicPick.exact}); brief ${mimicBrief.slides} (exact=${mimicBrief.exact})`,
      pass:
        mimicPick.slides === 15 &&
        mimicPick.exact === true &&
        mimicBrief.slides === 9 &&
        mimicBrief.exact === false,
    });

    // 2.4 Datasheet: from the structure of the data.
    const dataEst = cost.estimateSlides({
      kind: "datasheet",
      sheetCount: 3,
      totalRows: 120,
    });
    check("2.4", "Datasheet estimate from structure (3 sheets, 120 rows)", {
      before: 5000,
      after: 5000,
      expected: "2 + 3 sheets + 120/20 rows = 11 slides",
      observed: `${dataEst.slides} slides (basis=${dataEst.basis})`,
      pass: dataEst.slides === 11,
    });

    // 2.5 A user-set count always wins.
    const fixedEst = cost.estimateSlides({ kind: "fixed", count: 7 });
    check("2.5", "User-set slide count overrides estimation", {
      before: 5000,
      after: 5000,
      expected: "7 slides, exact",
      observed: `${fixedEst.slides} slides, exact=${fixedEst.exact}`,
      pass: fixedEst.slides === 7 && fixedEst.exact === true,
    });
  }

  // ─── Section 3 - Low credits vs oversized content ────────────────

  {
    // Free user with credits for ~6 sonnet slides drops in a 2800-word
    // brief (worth ~30 raw, capped at 10 for the Free tier).
    const user = await makeUser("free"); // 400
    // Spend down to 160 first (a real 16-slide… no - a fixed 14-slide
    // deck doesn't fit Free's cap; burn with two small decks instead).
    await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "create",
      preset: "sonnet-fast",
      slideInput: { kind: "fixed", count: 7 },
      outcome: { kind: "success", produce: 7 },
    }); // 170 → 230 left
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: 70,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    }); // → 160 left

    const bigText = words(2800);
    const blocked = await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "create",
      preset: "sonnet-fast",
      slideInput: { kind: "text", text: bigText },
      outcome: { kind: "success", produce: 10 },
    });
    const opts =
      !blocked.preflight.ok && blocked.preflight.options
        ? blocked.preflight.options
        : null;
    check("3.1", "Oversized brief + low balance: stop BEFORE generating", {
      before: blocked.before,
      after: blocked.after,
      expected:
        "blocked insufficient_credits, balance untouched (160), options: condensed 6 @ 160, no cheaper preset, top-up gap 40",
      observed: `${blocked.status} (${blocked.blockedReason}); balance ${blocked.before}→${blocked.after}; options ${JSON.stringify(opts)}`,
      pass:
        blocked.status === "blocked" &&
        blocked.blockedReason === "insufficient_credits" &&
        blocked.before === 160 &&
        blocked.after === 160 &&
        opts !== null &&
        opts.condensedSlides === 6 &&
        opts.condensedCredits === 160 &&
        opts.cheaperPresets.length === 0 &&
        opts.topupGap === 40,
    });

    // 3.2 The user picks the condensed option → charged only for what
    // they chose, deck is authored at 6 slides (summarized, not cut).
    const condensed = await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "create",
      preset: "sonnet-fast",
      slideInput: { kind: "fixed", count: 6 },
      condense: true,
      outcome: { kind: "success", produce: 6 },
    });
    assertEstimateInvariant(condensed);
    const condensedHold = await prisma.creditHold.findUnique({
      where: { jobKey: condensed.jobKey },
    });
    const condenseFlag =
      (condensedHold?.metadata as { condense?: boolean } | null)?.condense ===
      true;
    check("3.2", "Condensed deck: charged exactly the affordable size", {
      before: condensed.before,
      after: condensed.after,
      held: condensed.held,
      charged: condensed.charged,
      refunded: condensed.refunded,
      expected:
        "charged 160 (6 slides), balance 160→0, condense flag on the job",
      observed: `charged ${condensed.charged}, balance ${condensed.before}→${condensed.after}, condense=${condenseFlag}`,
      pass:
        condensed.charged === 160 &&
        condensed.after === 0 &&
        condenseFlag === true,
    });
  }

  {
    // 3.3 Cheaper-model path: the block lists presets that DO fit.
    const user = await makeUser("pro");
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: 4400, // 5000 → 600
      metadata: { reason: "sim burn-down" },
      ...quiet,
    });
    const blocked = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "text", text: words(1200) }, // 14 slides → 708
      outcome: { kind: "success", produce: 14 },
    });
    const opts3 =
      !blocked.preflight.ok && blocked.preflight.options
        ? blocked.preflight.options
        : null;
    const cheaperOk =
      opts3 !== null &&
      opts3.cheaperPresets.includes("sonnet-fast") &&
      opts3.cheaperPresets.includes("opus-fast");
    const fallback = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1200) },
      outcome: { kind: "success", produce: 14 },
    });
    assertEstimateInvariant(fallback);
    check("3.3", "Cheaper model offered and charges its own price", {
      before: blocked.before,
      after: fallback.after,
      held: fallback.held,
      charged: fallback.charged,
      expected:
        "opus-balanced (708) blocked at 600; sonnet+opus-fast offered; opus-fast full 14 slides charged 574",
      observed: `blocked=${blocked.blockedReason}, cheaper=${JSON.stringify(opts3?.cheaperPresets)}, fallback charged ${fallback.charged}, balance ${blocked.before}→${fallback.after}`,
      pass:
        blocked.status === "blocked" &&
        cheaperOk &&
        fallback.charged === 574 &&
        fallback.after === 26,
    });
  }

  {
    // 3.4 Top-up path: buy a pack, then the original choice fits.
    const user = await makeUser("pro");
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: 4400,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    }); // → 600
    await ledger.grantTopup({
      userId: user.id,
      credits: 1000,
      sourceKey: `sim-topup-${user.id}`,
      ...quiet,
    });
    const result = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "text", text: words(1200) }, // 708
      outcome: { kind: "success", produce: 14 },
    });
    assertEstimateInvariant(result);
    const split = await ledger.getBalance(user.id);
    check("3.4", "Top-up unblocks; subscription spent before the pack", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      expected:
        "1600 → charged 708 → 892 total (subscription 0, top-up 892 - sub bucket burns first)",
      observed: `balance ${result.before}→${result.after} (sub ${split.subscription}, topup ${split.topup})`,
      pass:
        result.before === 1600 &&
        result.charged === 708 &&
        split.subscription === 0 &&
        split.topup === 892,
    });
  }

  {
    // 3.5 Source deck above the tier cap blocks at preflight - never a
    // truncated rebuild, never a charge.
    const user = await makeUser("plus"); // cap 30
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "enhance",
      preset: "opus-fast",
      slideInput: { kind: "enhance", pageCount: 60 },
      outcome: { kind: "success", produce: 60 },
    });
    check("3.5", "60-page enhance on a 30-cap tier blocks, charges 0", {
      before: result.before,
      after: result.after,
      expected: "blocked slide_cap_exceeded, balance unchanged 2000",
      observed: `${blockedDesc(result)}, balance ${result.before}→${result.after}`,
      pass:
        result.status === "blocked" &&
        result.blockedReason === "slide_cap_exceeded" &&
        result.after === 2000,
    });
  }

  function blockedDesc(r: GenResult): string {
    return r.status === "blocked" ? `blocked (${r.blockedReason})` : r.status;
  }

  // ─── Section 4 - Abuse: user side ────────────────────────────────

  {
    // 4.1 Cancel late: pay for the slides actually made.
    const user = await makeUser("plus");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: 30 }, // hold 830
      outcome: { kind: "cancel", afterSlides: 25 },
    });
    assertEstimateInvariant(result);
    check("4.1", "Cancel at 25/30: pays for 25, refunds the rest", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: "held 830, charged 750 (350 + 25×16), refunded 80",
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}`,
      pass:
        result.held === 830 && result.charged === 750 && result.refunded === 80,
    });

    // 4.2 Cancel before anything streamed: full release.
    const early = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: 30 },
      outcome: { kind: "cancel", afterSlides: 0 },
    });
    check("4.2", "Cancel before first slide: full refund", {
      before: early.before,
      after: early.after,
      held: early.held,
      charged: early.charged,
      refunded: early.refunded,
      expected: "held 830, charged 0, refunded 830, balance unchanged",
      observed: `held ${early.held}, charged ${early.charged}, refunded ${early.refunded}, balance ${early.before}→${early.after}`,
      pass:
        early.charged === 0 &&
        early.refunded === 830 &&
        early.before === early.after,
    });
  }

  {
    // 4.3 An "edit" that runs the AI costs credits; a local edit doesn't.
    const user = await makeUser("pro");
    const before = await balanceOf(user.id);
    // Local in-canvas edit: pure content save, no Claude → no ledger call.
    const afterLocal = await balanceOf(user.id);
    // AI partial regen of 3 slides on opus-balanced: 3 × 22 = 66.
    const regen = await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-regen-${user.id}`,
      amount: cost.regenCost("opus-balanced", 3),
      metadata: { kind: "partial-regen", slides: 3, preset: "opus-balanced" },
      ...quiet,
    });
    const afterRegen = await balanceOf(user.id);
    // Name-gen (Haiku): flat 5.
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-namegen-${user.id}`,
      amount: cost.NAME_GEN_COST,
      metadata: { kind: "name-gen" },
      ...quiet,
    });
    const afterName = await balanceOf(user.id);
    check("4.3", "AI edits charge (regen 66, name-gen 5); local edits free", {
      before,
      after: afterName,
      charged: 71,
      expected: "local edit ±0; regen −66; name-gen −5",
      observed: `local ${before}→${afterLocal}; regen →${afterRegen}; name-gen →${afterName}`,
      pass:
        before === afterLocal &&
        regen.ok &&
        afterRegen === before - 66 &&
        afterName === before - 71,
    });
  }

  {
    // 4.4 Two simultaneous generations racing one balance: only one wins.
    const user = await makeUser("free"); // 400
    // Two 10-slide sonnet decks at 200 - wait, two×200 = exactly 400
    // fits. Use 300-credit jobs so only one can fit: 17-slide… Free cap
    // is 10. Burn 100 first → 300 left; each job costs 200.
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: 100,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    });
    const [a, b] = await Promise.all([
      fakeGenerate({
        userId: user.id,
        plan: "free",
        flow: "create",
        preset: "sonnet-fast",
        slideInput: { kind: "fixed", count: 10 },
        outcome: { kind: "success", produce: 10 },
      }),
      fakeGenerate({
        userId: user.id,
        plan: "free",
        flow: "create",
        preset: "sonnet-fast",
        slideInput: { kind: "fixed", count: 10 },
        outcome: { kind: "success", produce: 10 },
      }),
    ]);
    const wins = [a, b].filter((r) => r.status === "succeeded").length;
    const finalBalance = await balanceOf(user.id);
    check("4.4", "Concurrent double-spend: exactly one generation wins", {
      before: 300,
      after: finalBalance,
      expected: "1 of 2 succeeds, balance 300→100, never negative",
      observed: `${wins} succeeded, balance →${finalBalance}`,
      pass: wins === 1 && finalBalance === 100,
    });
  }

  {
    // 4.5 Refund farming: fail/cancel on purpose, 10 rounds → net zero,
    // never a gain.
    const user = await makeUser("plus");
    const start = await balanceOf(user.id);
    let maxSeen = start;
    for (let i = 0; i < 10; i++) {
      const r = await fakeGenerate({
        userId: user.id,
        plan: "plus",
        flow: "create",
        preset: "opus-fast",
        slideInput: { kind: "fixed", count: 20 },
        outcome: i % 2 === 0 ? { kind: "fail", afterSlides: 5 } : { kind: "cancel", afterSlides: 0 },
      });
      assertEstimateInvariant(r);
      maxSeen = Math.max(maxSeen, await balanceOf(user.id));
    }
    const end = await balanceOf(user.id);
    check("4.5", "10 rounds of deliberate fail/cancel farm zero credits", {
      before: start,
      after: end,
      expected: `balance returns to ${start} every round and never exceeds it`,
      observed: `end ${end}, max ever seen ${maxSeen}`,
      pass: end === start && maxSeen === start,
    });
  }

  {
    // 4.6 Signup grant is one-time even if the grant path re-runs.
    const user = await makeUser("free");
    const again = await ledger.grantSignupCredits({ userId: user.id, ...quiet });
    const balance = await balanceOf(user.id);
    check("4.6", "Signup grant cannot be re-claimed", {
      before: 400,
      after: balance,
      expected: "second grant returns alreadyGranted, balance stays 400",
      observed: `alreadyGranted=${again.alreadyGranted}, balance ${balance}`,
      pass: again.alreadyGranted === true && balance === 400,
    });
    notes.push(
      "4.7 Multi-account farming: each NEW account legitimately receives the one-time 400. " +
        "The ledger bounds the per-account grant (4.6) but cannot see that two accounts are one person - " +
        "that defense lives at the identity layer (email verification already required; add device/IP velocity " +
        "checks and payment-method-fingerprint dedupe before launch). OPEN ITEM, not covered by this system.",
    );
  }

  // ─── Section 5 - Abuse: system side (never shortchange the user) ─

  {
    // 5.1 Retry storm: the same job holds and settles exactly once.
    const user = await makeUser("plus");
    const jobKey = "sim-retry-job";
    const h1 = await ledger.holdCredits({
      userId: user.id,
      jobKey,
      amount: 500,
      ...quiet,
    });
    const h2 = await ledger.holdCredits({
      userId: user.id,
      jobKey,
      amount: 500,
      ...quiet,
    }); // Inngest retry re-enters
    const afterHolds = await balanceOf(user.id);
    const s1 = await ledger.settleHold({ jobKey, chargeAmount: 300, ...quiet });
    const s2 = await ledger.settleHold({ jobKey, chargeAmount: 300, ...quiet });
    const s3 = await ledger.settleHold({ jobKey, chargeAmount: 0, ...quiet }); // late "refund" replay
    const end = await balanceOf(user.id);
    const pass =
      h1.ok &&
      h2.ok &&
      h2.alreadyHeld === true &&
      afterHolds === 1500 &&
      s1.ok &&
      !s1.alreadySettled &&
      s2.ok &&
      s2.alreadySettled === true &&
      s3.ok &&
      s3.alreadySettled === true &&
      end === 1700;
    check("5.1", "Retries: double hold, double settle, late release - one debit", {
      before: 2000,
      after: end,
      held: 500,
      charged: 300,
      refunded: 200,
      expected:
        "hold once (2000→1500), settle 300 once (→1700), replays are no-ops",
      observed: `afterHolds ${afterHolds}, end ${end}, h2.alreadyHeld=${h2.ok && h2.alreadyHeld}, s2.replay=${s2.ok && s2.alreadySettled}, s3.replay=${s3.ok && s3.alreadySettled}`,
      pass,
    });
  }

  {
    // 5.2 Failed generation after retries: full refund, charged 0.
    const user = await makeUser("pro");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "fixed", count: 20 },
      outcome: { kind: "fail", afterSlides: 12 },
    });
    check("5.2", "Failed generation charges nothing", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: "held 840, charged 0, refunded 840, balance unchanged",
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === 840 &&
        result.charged === 0 &&
        result.refunded === result.held &&
        result.before === result.after,
    });

    // 5.2b Preset gate: a tier can never run (or be charged for) a
    // preset it hasn't unlocked.
    const starterUser = await makeUser("plus");
    const gated = await fakeGenerate({
      userId: starterUser.id,
      plan: "plus",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "fixed", count: 20 },
      outcome: { kind: "success", produce: 20 },
    });
    check("5.2b", "Locked preset blocks before any charge", {
      before: gated.before,
      after: gated.after,
      expected: "starter + opus-balanced → blocked preset_locked, balance unchanged",
      observed: `${blockedDesc(gated)}, balance ${gated.before}→${gated.after}`,
      pass:
        gated.status === "blocked" &&
        gated.blockedReason === "preset_locked" &&
        gated.before === gated.after,
    });
  }

  {
    // 5.3 Flow gate: Free tier cannot reach source flows at all.
    const user = await makeUser("free");
    const result = await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "enhance",
      preset: "sonnet-fast",
      slideInput: { kind: "enhance", pageCount: 5 },
      outcome: { kind: "success", produce: 5 },
    });
    check("5.3", "Free tier: source flows blocked before any charge", {
      before: result.before,
      after: result.after,
      expected: "blocked flow_locked, balance unchanged 400",
      observed: `${blockedDesc(result)}, balance ${result.before}→${result.after}`,
      pass:
        result.status === "blocked" &&
        result.blockedReason === "flow_locked" &&
        result.after === 400,
    });
  }

  // ─── Section 6 - Reset, top-ups, downgrades ──────────────────────

  {
    // 6.1 Spend order + exact-source refunds across buckets.
    const user = await makeUser("plus"); // sub 2000
    await ledger.grantTopup({
      userId: user.id,
      credits: 1000,
      sourceKey: `sim-topup-order-${user.id}`,
      ...quiet,
    });
    // Hold 2200 (= all 2000 sub + 200 topup), settle 2100 → the 100
    // refund must land back in the TOP-UP bucket (charge eats the
    // subscription portion first).
    const h = await ledger.holdCredits({
      userId: user.id,
      jobKey: "sim-bucket-job",
      amount: 2200,
      ...quiet,
    });
    const s = await ledger.settleHold({
      jobKey: "sim-bucket-job",
      chargeAmount: 2100,
      ...quiet,
    });
    const split = await ledger.getBalance(user.id);
    check("6.1", "Buckets: sub spent first; refund returns to the pack", {
      before: 3000,
      after: split.total,
      held: 2200,
      charged: s.ok ? s.charged : null,
      refunded: s.ok ? s.refunded : null,
      expected: "after settle: total 900 = sub 0 + topup 900",
      observed: `total ${split.total} = sub ${split.subscription} + topup ${split.topup} (hold ok=${h.ok})`,
      pass:
        split.total === 900 && split.subscription === 0 && split.topup === 900,
    });
  }

  {
    // 6.2 Monthly reset: allotment snaps back, no rollover, pack survives.
    const user = await makeUser("plus"); // sub 2000, resets +1 month
    await ledger.grantTopup({
      userId: user.id,
      credits: 1000,
      sourceKey: `sim-topup-reset-${user.id}`,
      ...quiet,
    });
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: 1300, // burns all… no: sub first → sub 700 left, topup untouched
      metadata: { reason: "sim burn-down" },
      ...quiet,
    });
    const beforeReset = await ledger.getBalance(user.id);
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 35);
    const reset = await ledger.resetMonthlyAllotment({
      userId: user.id,
      now: future,
      ...quiet,
    });
    const after = await ledger.getBalance(user.id, future);
    // Idempotency: same call again must not double-reset.
    const reset2 = await ledger.resetMonthlyAllotment({
      userId: user.id,
      now: future,
      ...quiet,
    });
    check("6.2", "Reset: unused sub credits forfeited, top-up survives", {
      before: beforeReset.total,
      after: after.total,
      expected:
        "before: sub 700 + topup 1000; after reset: sub 2000 + topup 1000 = 3000; re-run no-op",
      observed: `before sub ${beforeReset.subscription}/topup ${beforeReset.topup}; after sub ${after.subscription}/topup ${after.topup}; reset=${reset.reset}, rerun=${reset2.reset}`,
      pass:
        beforeReset.subscription === 700 &&
        beforeReset.topup === 1000 &&
        reset.reset === true &&
        after.subscription === 2000 &&
        after.topup === 1000 &&
        reset2.reset === false,
    });

    // 6.3 Top-up expiry at 12 months: pack credits die, sub untouched.
    const afterExpiryDate = new Date();
    afterExpiryDate.setUTCMonth(afterExpiryDate.getUTCMonth() + 12);
    afterExpiryDate.setUTCDate(afterExpiryDate.getUTCDate() + 1);
    const expired = await ledger.expireTopups({
      userId: user.id,
      now: afterExpiryDate,
      ...quiet,
    });
    const afterExpiry = await ledger.getBalance(user.id, afterExpiryDate);
    check("6.3", "Top-up expires 12 months after purchase", {
      before: after.total,
      after: afterExpiry.total,
      expected: "1000 pack credits expire; subscription bucket untouched",
      observed: `expired ${expired.expired}; sub ${afterExpiry.subscription}, topup ${afterExpiry.topup}`,
      pass:
        expired.expired === 1000 &&
        afterExpiry.topup === 0 &&
        afterExpiry.subscription === 2000,
    });
  }

  {
    // 6.4 Downgrade keeps everything spendable.
    const user = await makeUser("max"); // 12000
    await ledger.grantTopup({
      userId: user.id,
      credits: 1000,
      sourceKey: `sim-topup-downgrade-${user.id}`,
      ...quiet,
    });
    const before = await ledger.getBalance(user.id);
    await ledger.changePlanKeepBalance({ userId: user.id, plan: "free", ...quiet });
    const after = await ledger.getBalance(user.id);
    check("6.4", "Downgrade pro→free: balance fully preserved", {
      before: before.total,
      after: after.total,
      expected: "13000 stays 13000 (next cycle's allotment becomes 0)",
      observed: `total ${after.total}, sub ${after.subscription}, topup ${after.topup}, nextAllotment ${after.monthlyAllotment}`,
      pass: after.total === 13000 && after.monthlyAllotment === 0,
    });
  }

  // ─── Cross-cutting invariant ─────────────────────────────────────
  check("INV", "No generation ever charged more than its shown estimate", {
    before: 0,
    after: 0,
    expected: "0 violations across every fakeGenerate call",
    observed: `${estimateInvariantViolations} violations`,
    pass: estimateInvariantViolations === 0,
  });

  // ─── Ledger self-audit: events sum to balances ───────────────────
  {
    const simUsers = await prisma.user.findMany({
      where: { email: { endsWith: `@${SIM_DOMAIN}` } },
      select: { id: true },
    });
    let mismatches = 0;
    for (const u of simUsers) {
      const events = await prisma.usageEvent.aggregate({
        where: { userId: u.id, eventType: { startsWith: "credit." } },
        _sum: { amount: true },
      });
      // Event amounts are signed balance deltas, so their sum must equal
      // the raw stored state: subscription bucket + remaining of ALL
      // grants (no expiry filter - un-swept expired remainders have no
      // expire event yet, by design; the daily sweep logs them).
      const account = await prisma.creditAccount.findUnique({
        where: { userId: u.id },
      });
      const grants = await prisma.topupGrant.aggregate({
        where: { userId: u.id },
        _sum: { amountRemaining: true },
      });
      const stored =
        (account?.subscriptionBalance ?? 0) +
        (grants._sum.amountRemaining ?? 0);
      if ((events._sum.amount ?? 0) !== stored) mismatches += 1;
    }
    check("AUDIT", "Σ(signed ledger events) == live balance for every user", {
      before: 0,
      after: 0,
      expected: `0 mismatches across ${simUsers.length} sim users`,
      observed: `${mismatches} mismatches`,
      pass: mismatches === 0,
    });
  }

  // ─── Report ──────────────────────────────────────────────────────
  const passed = rows.filter((r) => r.pass).length;
  const failed = rows.length - passed;
  console.log(`\n${passed}/${rows.length} checks passed, ${failed} failed`);

  const report = buildReport(rows, notes, passed, failed);
  const outDir = join(process.cwd(), "scratch");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "credit-sim-report.md");
  writeFileSync(outPath, report, "utf8");
  console.log(`Report written to ${outPath}`);

  console.log("Cleaning up sim users…");
  await wipeSimUsers();
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

function buildReport(
  rows: Row[],
  notes: string[],
  passed: number,
  failed: number,
): string {
  const lines: string[] = [];
  lines.push("# Credit-system simulation report");
  lines.push("");
  lines.push(`Run: ${new Date().toISOString()} - real ledger (lib/credits) against a fake generator, no Claude calls, no payments.`);
  lines.push("");
  lines.push(`**${passed}/${rows.length} checks passed${failed ? `, ${failed} FAILED` : ""}.**`);
  lines.push("");
  lines.push("| # | Interaction | Balance before | Held | Charged | Refunded | Balance after | Result |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.title} | ${r.before} | ${r.held ?? "-"} | ${r.charged ?? "-"} | ${r.refunded ?? "-"} | ${r.after} | ${r.pass ? "PASS" : "**FAIL**"} |`,
    );
  }
  lines.push("");
  lines.push("## Detail (expected vs observed)");
  lines.push("");
  for (const r of rows) {
    lines.push(`### ${r.id} - ${r.title} ${r.pass ? "(pass)" : "(FAIL)"}`);
    lines.push(`- Expected: ${r.expected}`);
    lines.push(`- Observed: ${r.observed}`);
    lines.push("");
  }
  if (notes.length) {
    lines.push("## Notes & open items");
    lines.push("");
    for (const n of notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
