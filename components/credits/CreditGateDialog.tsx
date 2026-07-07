"use client";

// CreditGateDialog - thin adapter (2026-06-26). The 402 preflight payload no
// longer shows an intermediate card. Every gate (insufficient credits / flow
// locked / preset locked / slide cap) now opens the UpgradeModal (pricing
// tiers) DIRECTLY with a contextual headline, so the user lands on the plans
// in ONE step. Subscribers out of credits still jump straight to their
// covering top-up pack's checkout (their natural refill); everyone else sees
// the tiers. The old reduce-slides offer was dropped with the card.

import { useDict } from "@/components/i18n/LocaleProvider";
import { TOPUP_PACKS } from "@/lib/credits/cost";
import { formatCredits, useCreditBalance } from "@/lib/credits/store";
import { normalizePlan, planLabel } from "@/lib/plan";
import { UpgradeModal } from "@/components/billing/UpgradeModal";

// The 402 body POST /api/projects returns when preflight blocks.
export type CreditGatePayload = {
  error:
    | "insufficient_credits"
    | "flow_locked"
    | "preset_locked"
    | "slide_cap_exceeded";
  balance: number;
  slideCap: number | null;
  // flow_locked: the cheapest plan that unlocks the flow (fills {tier}).
  minFlowTier?: string | null;
  options: {
    reducedSlides: number | null;
    reducedCredits: number | null;
    cheaperPresets: string[];
    topupGap: number;
  } | null;
};

export function isCreditGatePayload(data: unknown): data is CreditGatePayload {
  if (!data || typeof data !== "object") return false;
  const error = (data as { error?: unknown }).error;
  return (
    error === "insufficient_credits" ||
    error === "flow_locked" ||
    error === "preset_locked" ||
    error === "slide_cap_exceeded"
  );
}

export function CreditGateDialog({
  gate,
  onClose,
}: {
  gate: CreditGatePayload | null;
  onClose: () => void;
  // Accepted for backward-compat with the flows' call sites; the reduce-slides
  // offer was removed when the gate started opening the tiers modal directly.
  onReduce?: (slides: number) => void;
  allowReduce?: boolean;
}) {
  const dict = useDict();
  const t = dict.components.creditGate;
  const credits = useCreditBalance();
  const isFree = !credits || normalizePlan(credits.plan) === "free";

  // Subscriber out of credits: jump straight to the smallest covering pack's
  // checkout (the refill they actually want). Free users + every other gate
  // land on the tiers so they can pick a plan to upgrade. Packs come live
  // from /api/credits (Stripe-backed), bundled constant as fallback.
  const packs = credits?.topupPacks ?? TOPUP_PACKS;
  const coveringPack =
    gate?.error === "insufficient_credits" && !isFree && gate.options
      ? packs.find((p) => p.credits >= gate.options!.topupGap) ??
        packs[packs.length - 1]
      : null;
  const initialLookupKey = coveringPack ? `topup_${coveringPack.key}` : null;

  // Contextual headline so the tiers modal explains WHY it opened.
  let gateContext: { title: string; body: string } | null = null;
  if (gate) {
    const cta = t.chooseTier;
    if (gate.error === "insufficient_credits") {
      const needed = gate.options ? gate.balance + gate.options.topupGap : 0;
      const detail = t.insufficientBody
        .replace("{needed}", formatCredits(needed))
        .replace("{have}", formatCredits(gate.balance));
      gateContext = { title: t.insufficientTitle, body: `${detail} ${cta}`.trim() };
    } else if (gate.error === "flow_locked") {
      // Fill {tier} with the localized name of the cheapest plan whose
      // flows include the gated one (server-derived from live config);
      // "plus" fallback covers a stale client against an older payload.
      const tierKey = gate.minFlowTier ?? "plus";
      gateContext = {
        title: t.flowLockedTitle,
        body: `${t.flowLockedBody.replace(
          "{tier}",
          planLabel(dict.components.planUsage, tierKey),
        )} ${cta}`.trim(),
      };
    } else if (gate.error === "preset_locked") {
      gateContext = {
        title: t.presetLockedTitle,
        body: `${t.presetLockedBody} ${cta}`.trim(),
      };
    } else {
      gateContext = {
        title: t.capTitle,
        body: `${t.capBody.replace("{cap}", formatCredits(gate.slideCap ?? 0))} ${cta}`.trim(),
      };
    }
  }

  return (
    <UpgradeModal
      open={gate !== null}
      gateContext={gateContext}
      initialLookupKey={initialLookupKey}
      onClose={onClose}
    />
  );
}
