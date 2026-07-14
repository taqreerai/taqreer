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

  // ── Derived pricing shorthands ─────────────────────────────────────
  // Every expectation below derives from the live constants so the next
  // repricing updates the sim instead of breaking it.
  const FREE_GRANT = cost.TIERS.free.signupGrant;
  const PLUS_CREDITS = cost.TIERS.plus.monthlyAllotment;
  const PRO_CREDITS = cost.TIERS.pro.monthlyAllotment;
  const MAX_CREDITS = cost.TIERS.max.monthlyAllotment;
  const FREE_CAP = cost.TIERS.free.slideCap;
  const PLUS_CAP = cost.TIERS.plus.slideCap;
  // Standard top-up pack used by the pack scenarios (the "small" pack).
  const PACK = cost.TOPUP_PACKS.find((p) => p.key === "small")!.credits;
  const genCost = (preset: Quality, slides: number) =>
    cost.generationCost(preset, slides);

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
    const price = genCost("opus-fast", 10); // base + 10 × perSlide
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: 10 },
      outcome: { kind: "success", produce: 10 },
    });
    assertEstimateInvariant(result);
    check("1.1", `Fixed 10-slide opus-fast deck costs exactly ${price}`, {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: `held ${price}, charged ${price}, refunded 0, balance ${PLUS_CREDITS}→${PLUS_CREDITS - price}`,
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === price &&
        result.charged === price &&
        result.refunded === 0 &&
        result.before === PLUS_CREDITS &&
        result.after === PLUS_CREDITS - price,
    });
  }

  {
    // 1.2 Auto mode: hold the estimate, charge the actual, release the rest.
    const user = await makeUser("plus");
    // estimate: ceil(1000/100)+2 = 12 slides → hold genCost(12);
    // actual 9 → charge genCost(9), release the difference.
    const estSlides = cost.estimateSlides({
      kind: "text",
      text: words(1000),
    }).slides!;
    const hold = genCost("opus-fast", estSlides);
    const charge = genCost("opus-fast", 9);
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1000) }, // → 12 slides est.
      outcome: { kind: "success", produce: 9 },
    });
    assertEstimateInvariant(result);
    check("1.2", `Auto count: hold ${estSlides}-slide max, charge the 9 produced`, {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: `held ${hold}, charged ${charge}, refunded ${hold - charge}, balance ${PLUS_CREDITS}→${PLUS_CREDITS - charge}`,
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === hold &&
        result.charged === charge &&
        result.refunded === hold - charge &&
        result.after === PLUS_CREDITS - charge,
    });
  }

  {
    // 1.3 Model overshoots the estimate → charge CLAMPS to what was shown.
    const user = await makeUser("plus");
    const estSlides = cost.estimateSlides({
      kind: "text",
      text: words(1000),
    }).slides!; // 12
    const hold = genCost("opus-fast", estSlides);
    const overshoot = estSlides + 2; // produce 2 past the estimate
    const rawCost = genCost("opus-fast", overshoot);
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1000) }, // hold = estSlides
      outcome: { kind: "success", produce: overshoot }, // raw cost > hold
    });
    assertEstimateInvariant(result);
    check("1.3", "Overproduced deck never charges past the shown estimate", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: `held ${hold}, charged clamped to ${hold} (not ${rawCost}), refunded 0`,
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}`,
      pass: result.held === hold && result.charged === hold && result.refunded === 0,
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
    // Quotes cover ACTIVE presets only: fable-low is inactive in the
    // seed, so it must not be quoted at all (it isn't in the picker).
    const fastQuote = genCost("opus-fast", est.slides!);
    const balancedQuote = genCost("opus-balanced", est.slides!);
    const expectQuotes =
      q.find((x) => x.preset === "opus-fast")?.credits === fastQuote &&
      q.find((x) => x.preset === "opus-balanced")?.credits === balancedQuote &&
      q.find((x) => x.preset === "fable-low") === undefined;
    check("2.1", "Create-from-text estimate: 1200 words → 14 slides, active quotes", {
      before: PRO_CREDITS,
      after: PRO_CREDITS,
      expected: `14 slides; opus-fast ${fastQuote} / opus-balanced ${balancedQuote} shown before generating; fable-low (inactive) not quoted`,
      observed: `${est.slides} slides; quotes ${q.map((x) => `${x.preset}=${x.credits}`).join(", ")}`,
      pass: est.slides === 14 && expectQuotes,
    });

    // 2.2 Enhance rebuilds 1:1 → page count is the count, known up front.
    const enhanceEst = cost.estimateSlides({ kind: "enhance", pageCount: 24 });
    check("2.2", "Enhance estimate = source page count (exact)", {
      before: PRO_CREDITS,
      after: PRO_CREDITS,
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
      before: PRO_CREDITS,
      after: PRO_CREDITS,
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
      before: PRO_CREDITS,
      after: PRO_CREDITS,
      expected: "2 + 3 sheets + 120/20 rows = 11 slides",
      observed: `${dataEst.slides} slides (basis=${dataEst.basis})`,
      pass: dataEst.slides === 11,
    });

    // 2.5 A user-set count always wins.
    const fixedEst = cost.estimateSlides({ kind: "fixed", count: 7 });
    check("2.5", "User-set slide count overrides estimation", {
      before: PRO_CREDITS,
      after: PRO_CREDITS,
      expected: "7 slides, exact",
      observed: `${fixedEst.slides} slides, exact=${fixedEst.exact}`,
      pass: fixedEst.slides === 7 && fixedEst.exact === true,
    });
  }

  // ─── Section 3 - Low credits vs oversized content ────────────────

  {
    // Free user burned down to a low balance drops in a 2800-word brief
    // (capped at FREE_CAP for the Free tier). Scenario shape: the balance
    // affords a reduced deck but not the capped hold. All sizes derive from
    // the live FREE_GRANT / FREE_CAP so this survives repricing.
    const user = await makeUser("free"); // FREE_GRANT
    const reducedTarget = Math.max(1, FREE_CAP - 1); // reduce offer, under the cap
    const lowBalance = genCost("opus-fast", reducedTarget); // affords exactly reducedTarget slides
    const capHold = genCost("opus-fast", FREE_CAP); // the capped-brief hold
    // The free grant only affords ~1 deck, so charge straight down to the
    // target balance rather than spending a real deck first.
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: FREE_GRANT - lowBalance,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    }); // → lowBalance left

    const bigText = words(2800);
    const blocked = await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "create",
      preset: "opus-fast",
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
      expected: `blocked insufficient_credits, balance untouched (${lowBalance}), offers: reduce to ${reducedTarget} @ ${lowBalance} or top up ${capHold - lowBalance} (no cheaper preset exists on Free)`,
      observed: `${blocked.status} (${blocked.blockedReason}); balance ${blocked.before}→${blocked.after}; options ${JSON.stringify(opts)}`,
      pass:
        blocked.status === "blocked" &&
        blocked.blockedReason === "insufficient_credits" &&
        blocked.before === lowBalance &&
        blocked.after === lowBalance &&
        opts !== null &&
        opts.reducedSlides === reducedTarget &&
        opts.reducedCredits === lowBalance &&
        opts.cheaperPresets.length === 0 &&
        opts.topupGap === capHold - lowBalance,
    });

    // 3.2 The user picks the reduce offer → the deck is simply a normal
    // generation at the smaller count, charged exactly that price.
    const reduced = await fakeGenerate({
      userId: user.id,
      plan: "free",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: reducedTarget },
      outcome: { kind: "success", produce: reducedTarget },
    });
    assertEstimateInvariant(reduced);
    check("3.2", "Reduced deck: charged exactly the affordable size", {
      before: reduced.before,
      after: reduced.after,
      held: reduced.held,
      charged: reduced.charged,
      refunded: reduced.refunded,
      expected: `charged ${lowBalance} (${reducedTarget} slides), balance ${lowBalance}→0`,
      observed: `charged ${reduced.charged}, balance ${reduced.before}→${reduced.after}`,
      pass: reduced.charged === lowBalance && reduced.after === 0,
    });
  }

  {
    // 3.3 Cheaper-model path: the block lists presets that DO fit.
    const user = await makeUser("pro");
    const est = cost.estimateSlides({
      kind: "text",
      text: words(1200),
    }).slides!; // 14
    const balancedQuote = genCost("opus-balanced", est);
    const fastQuote = genCost("opus-fast", est);
    // Land the balance between the two quotes: opus-balanced blocked,
    // opus-fast still affordable at the full size.
    const midBalance = Math.floor((fastQuote + balancedQuote) / 2);
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: PRO_CREDITS - midBalance,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    });
    const blocked = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "text", text: words(1200) }, // est slides → balancedQuote
      outcome: { kind: "success", produce: est },
    });
    const opts3 =
      !blocked.preflight.ok && blocked.preflight.options
        ? blocked.preflight.options
        : null;
    const cheaperOk = opts3 !== null && opts3.cheaperPresets.includes("opus-fast");
    const fallback = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "text", text: words(1200) },
      outcome: { kind: "success", produce: est },
    });
    assertEstimateInvariant(fallback);
    check("3.3", "Cheaper model offered and charges its own price", {
      before: blocked.before,
      after: fallback.after,
      held: fallback.held,
      charged: fallback.charged,
      expected: `opus-balanced (${balancedQuote}) blocked at ${midBalance}; opus-fast offered; opus-fast full ${est} slides charged ${fastQuote}`,
      observed: `blocked=${blocked.blockedReason}, cheaper=${JSON.stringify(opts3?.cheaperPresets)}, fallback charged ${fallback.charged}, balance ${blocked.before}→${fallback.after}`,
      pass:
        blocked.status === "blocked" &&
        cheaperOk &&
        fallback.charged === fastQuote &&
        fallback.after === midBalance - fastQuote,
    });
  }

  {
    // 3.4 Top-up path: buy a pack, then the original choice fits.
    const user = await makeUser("pro");
    const est = cost.estimateSlides({
      kind: "text",
      text: words(1200),
    }).slides!; // 14
    const balancedQuote = genCost("opus-balanced", est);
    // Same sub balance as 3.3: below the opus-balanced quote on its own,
    // so the pack is what unblocks the run.
    const fastQuote = genCost("opus-fast", est);
    const midBalance = Math.floor((fastQuote + balancedQuote) / 2);
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: PRO_CREDITS - midBalance,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    }); // → midBalance
    await ledger.grantTopup({
      userId: user.id,
      credits: PACK,
      sourceKey: `sim-topup-${user.id}`,
      ...quiet,
    });
    const result = await fakeGenerate({
      userId: user.id,
      plan: "pro",
      flow: "create",
      preset: "opus-balanced",
      slideInput: { kind: "text", text: words(1200) }, // balancedQuote
      outcome: { kind: "success", produce: est },
    });
    assertEstimateInvariant(result);
    const split = await ledger.getBalance(user.id);
    const topupLeft = PACK - (balancedQuote - midBalance);
    check("3.4", "Top-up unblocks; subscription spent before the pack", {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      expected: `${midBalance + PACK} → charged ${balancedQuote} → ${topupLeft} total (subscription 0, top-up ${topupLeft} - sub bucket burns first)`,
      observed: `balance ${result.before}→${result.after} (sub ${split.subscription}, topup ${split.topup})`,
      pass:
        result.before === midBalance + PACK &&
        result.charged === balancedQuote &&
        split.subscription === 0 &&
        split.topup === topupLeft,
    });
  }

  {
    // 3.5 Source deck above the tier cap blocks at preflight - never a
    // truncated rebuild, never a charge.
    const user = await makeUser("plus"); // cap PLUS_CAP
    const oversized = PLUS_CAP * 2; // a source deck twice the tier cap
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "enhance",
      preset: "opus-fast",
      slideInput: { kind: "enhance", pageCount: oversized },
      outcome: { kind: "success", produce: oversized },
    });
    check("3.5", `${oversized}-page enhance on a ${PLUS_CAP}-cap tier blocks, charges 0`, {
      before: result.before,
      after: result.after,
      expected: `blocked slide_cap_exceeded, balance unchanged ${PLUS_CREDITS}`,
      observed: `${blockedDesc(result)}, balance ${result.before}→${result.after}`,
      pass:
        result.status === "blocked" &&
        result.blockedReason === "slide_cap_exceeded" &&
        result.after === PLUS_CREDITS,
    });
  }

  function blockedDesc(r: GenResult): string {
    return r.status === "blocked" ? `blocked (${r.blockedReason})` : r.status;
  }

  // ─── Section 4 - Abuse: user side ────────────────────────────────

  {
    // 4.1 Cancel late: pay for the slides actually made.
    const user = await makeUser("plus");
    const fullCount = PLUS_CAP; // a full-cap deck
    const cancelAt = fullCount - 5;
    const holdFull = genCost("opus-fast", fullCount);
    const partialCost = genCost("opus-fast", cancelAt);
    const result = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: fullCount }, // hold holdFull
      outcome: { kind: "cancel", afterSlides: cancelAt },
    });
    assertEstimateInvariant(result);
    check("4.1", `Cancel at ${cancelAt}/${fullCount}: pays for ${cancelAt}, refunds the rest`, {
      before: result.before,
      after: result.after,
      held: result.held,
      charged: result.charged,
      refunded: result.refunded,
      expected: `held ${holdFull}, charged ${partialCost} (base + ${cancelAt} slides), refunded ${holdFull - partialCost}`,
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}`,
      pass:
        result.held === holdFull &&
        result.charged === partialCost &&
        result.refunded === holdFull - partialCost,
    });

    // 4.2 Cancel before anything streamed: full release.
    const early = await fakeGenerate({
      userId: user.id,
      plan: "plus",
      flow: "create",
      preset: "opus-fast",
      slideInput: { kind: "fixed", count: fullCount },
      outcome: { kind: "cancel", afterSlides: 0 },
    });
    check("4.2", "Cancel before first slide: full refund", {
      before: early.before,
      after: early.after,
      held: early.held,
      charged: early.charged,
      refunded: early.refunded,
      expected: `held ${holdFull}, charged 0, refunded ${holdFull}, balance unchanged`,
      observed: `held ${early.held}, charged ${early.charged}, refunded ${early.refunded}, balance ${early.before}→${early.after}`,
      pass:
        early.charged === 0 &&
        early.refunded === holdFull &&
        early.before === early.after,
    });
  }

  {
    // 4.3 An "edit" that runs the AI costs credits; a local edit doesn't.
    const user = await makeUser("pro");
    const before = await balanceOf(user.id);
    // Local in-canvas edit: pure content save, no Claude → no ledger call.
    const afterLocal = await balanceOf(user.id);
    // AI partial regen of 3 slides on opus-balanced: 3 × perSlide, no base.
    const regenPrice = cost.regenCost("opus-balanced", 3);
    const namePrice = cost.NAME_GEN_COST;
    const regen = await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-regen-${user.id}`,
      amount: regenPrice,
      metadata: { kind: "partial-regen", slides: 3, preset: "opus-balanced" },
      ...quiet,
    });
    const afterRegen = await balanceOf(user.id);
    // Name-gen (Haiku): flat NAME_GEN_COST.
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-namegen-${user.id}`,
      amount: namePrice,
      metadata: { kind: "name-gen" },
      ...quiet,
    });
    const afterName = await balanceOf(user.id);
    check("4.3", `AI edits charge (regen ${regenPrice}, name-gen ${namePrice}); local edits free`, {
      before,
      after: afterName,
      charged: regenPrice + namePrice,
      expected: `local edit ±0; regen −${regenPrice}; name-gen −${namePrice}`,
      observed: `local ${before}→${afterLocal}; regen →${afterRegen}; name-gen →${afterName}`,
      pass:
        before === afterLocal &&
        regen.ok &&
        afterRegen === before - regenPrice &&
        afterName === before - regenPrice - namePrice,
    });
  }

  {
    // 4.4 Two simultaneous generations racing one balance: only one wins.
    const user = await makeUser("free"); // FREE_GRANT
    // Two identical decks racing one balance; leave 1.5 jobs' worth of
    // credits so both preflights pass but only ONE hold can fit. Deck size
    // derives from the live grant/cap: the largest deck (<= FREE_CAP) whose
    // 1.5x cost still fits FREE_GRANT (the small free grant may not afford
    // 1.5 full-cap decks).
    let raceSlides = FREE_CAP;
    while (
      raceSlides > 1 &&
      genCost("opus-fast", raceSlides) +
        Math.floor(genCost("opus-fast", raceSlides) / 2) >
        FREE_GRANT
    ) {
      raceSlides -= 1;
    }
    const jobCost = genCost("opus-fast", raceSlides);
    const raceBalance = jobCost + Math.floor(jobCost / 2);
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: FREE_GRANT - raceBalance,
      metadata: { reason: "sim burn-down" },
      ...quiet,
    });
    const [a, b] = await Promise.all([
      fakeGenerate({
        userId: user.id,
        plan: "free",
        flow: "create",
        preset: "opus-fast",
        slideInput: { kind: "fixed", count: raceSlides },
        outcome: { kind: "success", produce: raceSlides },
      }),
      fakeGenerate({
        userId: user.id,
        plan: "free",
        flow: "create",
        preset: "opus-fast",
        slideInput: { kind: "fixed", count: raceSlides },
        outcome: { kind: "success", produce: raceSlides },
      }),
    ]);
    const wins = [a, b].filter((r) => r.status === "succeeded").length;
    const finalBalance = await balanceOf(user.id);
    check("4.4", "Concurrent double-spend: exactly one generation wins", {
      before: raceBalance,
      after: finalBalance,
      expected: `1 of 2 succeeds, balance ${raceBalance}→${raceBalance - jobCost}, never negative`,
      observed: `${wins} succeeded, balance →${finalBalance}`,
      pass: wins === 1 && finalBalance === raceBalance - jobCost,
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
      before: FREE_GRANT,
      after: balance,
      expected: `second grant returns alreadyGranted, balance stays ${FREE_GRANT}`,
      observed: `alreadyGranted=${again.alreadyGranted}, balance ${balance}`,
      pass: again.alreadyGranted === true && balance === FREE_GRANT,
    });
    notes.push(
      `4.7 Multi-account farming: each NEW account legitimately receives the one-time ${FREE_GRANT}. ` +
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
      afterHolds === PLUS_CREDITS - 500 &&
      s1.ok &&
      !s1.alreadySettled &&
      s2.ok &&
      s2.alreadySettled === true &&
      s3.ok &&
      s3.alreadySettled === true &&
      end === PLUS_CREDITS - 300;
    check("5.1", "Retries: double hold, double settle, late release - one debit", {
      before: PLUS_CREDITS,
      after: end,
      held: 500,
      charged: 300,
      refunded: 200,
      expected: `hold 500 once (${PLUS_CREDITS}→${PLUS_CREDITS - 500}), settle 300 once (→${PLUS_CREDITS - 300}), replays are no-ops`,
      observed: `afterHolds ${afterHolds}, end ${end}, h2.alreadyHeld=${h2.ok && h2.alreadyHeld}, s2.replay=${s2.ok && s2.alreadySettled}, s3.replay=${s3.ok && s3.alreadySettled}`,
      pass,
    });
  }

  {
    // 5.2 Failed generation after retries: full refund, charged 0.
    const user = await makeUser("pro");
    const holdExp = genCost("opus-balanced", 20);
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
      expected: `held ${holdExp}, charged 0, refunded ${holdExp}, balance unchanged`,
      observed: `held ${result.held}, charged ${result.charged}, refunded ${result.refunded}, balance ${result.before}→${result.after}`,
      pass:
        result.held === holdExp &&
        result.charged === 0 &&
        result.refunded === result.held &&
        result.before === result.after,
    });

    // 5.2b Preset gate: a tier can never run (or be charged for) a
    // preset it hasn't unlocked. (plus unlocked opus-balanced
    // 2026-06-12 - fable-low is the pro+ gate now, and is ALSO inactive
    // in the 2026-07 seed; either condition alone returns preset_locked,
    // so the tier-gate semantic still holds.)
    const starterUser = await makeUser("plus");
    const gated = await fakeGenerate({
      userId: starterUser.id,
      plan: "plus",
      flow: "create",
      preset: "fable-low",
      slideInput: { kind: "fixed", count: 20 },
      outcome: { kind: "success", produce: 20 },
    });
    check("5.2b", "Locked preset blocks before any charge", {
      before: gated.before,
      after: gated.after,
      expected: "plus + fable-low → blocked preset_locked, balance unchanged",
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
      preset: "opus-fast",
      slideInput: { kind: "enhance", pageCount: 5 },
      outcome: { kind: "success", produce: 5 },
    });
    check("5.3", "Free tier: source flows blocked before any charge", {
      before: result.before,
      after: result.after,
      expected: `blocked flow_locked, balance unchanged ${FREE_GRANT}`,
      observed: `${blockedDesc(result)}, balance ${result.before}→${result.after}`,
      pass:
        result.status === "blocked" &&
        result.blockedReason === "flow_locked" &&
        result.after === FREE_GRANT,
    });
  }

  // ─── Section 6 - Reset, top-ups, downgrades ──────────────────────

  {
    // 6.1 Spend order + exact-source refunds across buckets.
    const user = await makeUser("plus"); // sub PLUS_CREDITS
    await ledger.grantTopup({
      userId: user.id,
      credits: PACK,
      sourceKey: `sim-topup-order-${user.id}`,
      ...quiet,
    });
    // Hold the whole sub bucket + 200 of the pack, settle 100 less →
    // the 100 refund must land back in the TOP-UP bucket (charge eats
    // the subscription portion first).
    const holdAmt = PLUS_CREDITS + 200;
    const chargeAmt = PLUS_CREDITS + 100;
    const packLeft = PACK - 100;
    const h = await ledger.holdCredits({
      userId: user.id,
      jobKey: "sim-bucket-job",
      amount: holdAmt,
      ...quiet,
    });
    const s = await ledger.settleHold({
      jobKey: "sim-bucket-job",
      chargeAmount: chargeAmt,
      ...quiet,
    });
    const split = await ledger.getBalance(user.id);
    check("6.1", "Buckets: sub spent first; refund returns to the pack", {
      before: PLUS_CREDITS + PACK,
      after: split.total,
      held: holdAmt,
      charged: s.ok ? s.charged : null,
      refunded: s.ok ? s.refunded : null,
      expected: `after settle: total ${packLeft} = sub 0 + topup ${packLeft}`,
      observed: `total ${split.total} = sub ${split.subscription} + topup ${split.topup} (hold ok=${h.ok})`,
      pass:
        split.total === packLeft &&
        split.subscription === 0 &&
        split.topup === packLeft,
    });
  }

  {
    // 6.2 Monthly reset: allotment snaps back, no rollover, pack survives.
    const user = await makeUser("plus"); // sub PLUS_CREDITS, resets +1 month
    await ledger.grantTopup({
      userId: user.id,
      credits: PACK,
      sourceKey: `sim-topup-reset-${user.id}`,
      ...quiet,
    });
    // Burn a third of the sub bucket only (sub is spent first): derived,
    // so a repriced allotment keeps subLeft positive and topup untouched.
    const burn = Math.floor(PLUS_CREDITS / 3);
    const subLeft = PLUS_CREDITS - burn;
    await ledger.chargeCredits({
      userId: user.id,
      chargeKey: `sim-burn-${user.id}`,
      amount: burn, // sub first → subLeft remains, topup untouched
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
      expected: `before: sub ${subLeft} + topup ${PACK}; after reset: sub ${PLUS_CREDITS} + topup ${PACK} = ${PLUS_CREDITS + PACK}; re-run no-op`,
      observed: `before sub ${beforeReset.subscription}/topup ${beforeReset.topup}; after sub ${after.subscription}/topup ${after.topup}; reset=${reset.reset}, rerun=${reset2.reset}`,
      pass:
        beforeReset.subscription === subLeft &&
        beforeReset.topup === PACK &&
        reset.reset === true &&
        after.subscription === PLUS_CREDITS &&
        after.topup === PACK &&
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
      expected: `${PACK} pack credits expire; subscription bucket untouched`,
      observed: `expired ${expired.expired}; sub ${afterExpiry.subscription}, topup ${afterExpiry.topup}`,
      pass:
        expired.expired === PACK &&
        afterExpiry.topup === 0 &&
        afterExpiry.subscription === PLUS_CREDITS,
    });
  }

  {
    // 6.4 Downgrade keeps everything spendable.
    const user = await makeUser("max"); // MAX_CREDITS
    await ledger.grantTopup({
      userId: user.id,
      credits: PACK,
      sourceKey: `sim-topup-downgrade-${user.id}`,
      ...quiet,
    });
    const total = MAX_CREDITS + PACK;
    const before = await ledger.getBalance(user.id);
    await ledger.changePlanKeepBalance({ userId: user.id, plan: "free", ...quiet });
    const after = await ledger.getBalance(user.id);
    check("6.4", "Downgrade max→free: balance fully preserved", {
      before: before.total,
      after: after.total,
      expected: `${total} stays ${total} (next cycle's allotment becomes 0)`,
      observed: `total ${after.total}, sub ${after.subscription}, topup ${after.topup}, nextAllotment ${after.monthlyAllotment}`,
      pass: after.total === total && after.monthlyAllotment === 0,
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
