"use client";

// /billing page body (embedded billing, 2026-06-12) - replaces the
// Stripe-hosted Customer Portal:
//   1. Subscription card - status, renewal/ends date, cancel (NoticeCard
//      confirm, period-end only) and resume.
//   2. Payment methods - list / add (SetupIntent + PaymentElement with
//      the checkout Appearance) / remove / set default.
// The past_due dunning banner sits on top and points at the card
// section. Rows reuse the `.settings-row` recipe.

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { dateFnsLocale } from "@/lib/i18n/date";
import { useCreditBalance } from "@/lib/credits/store";
import { normalizePlan, planLabel, type KnownPlan } from "@/lib/plan";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkoutAppearance, CHECKOUT_FONTS } from "@/lib/billing/appearance";
import { NoticeCard } from "@/components/common/NoticeCard";
import { PlanUsage } from "@/components/app/PlanUsage";
import Link from "next/link";

type Summary = {
  plan: KnownPlan;
  hasBillingAccount: boolean;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  cadence: "monthly" | "yearly" | null;
};

type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
};

// Card brands with a recognizable wordmark; everything else renders the
// generic card glyph.
const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  mada: "mada",
  unionpay: "UnionPay",
  discover: "Discover",
};

export function ManageBilling() {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.components.billing;
  const credits = useCreditBalance();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cardNotice, setCardNotice] = useState<string | null>(null);

  const refreshSummary = useCallback(() => {
    fetch("/api/billing/summary", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => d && setSummary(d))
      .catch(() => {});
  }, []);

  const refreshMethods = useCallback(() => {
    fetch("/api/billing/payment-methods", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { paymentMethods: PaymentMethod[]; defaultId: string | null } | null) => {
          if (d) {
            setMethods(d.paymentMethods);
            setDefaultId(d.defaultId);
          }
        },
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
    refreshMethods();
  }, [refreshSummary, refreshMethods]);

  const plan = summary ? summary.plan : credits ? normalizePlan(credits.plan) : "free";
  const planName = planLabel(dict.components.planUsage, plan);
  const periodEnd =
    summary?.currentPeriodEnd
      ? format(new Date(summary.currentPeriodEnd), "d MMMM", {
          locale: dateFnsLocale(locale),
        })
      : null;
  const hasSub = !!periodEnd && summary?.status !== "canceled";
  // The cadence pill lives in PlanUsage (fed by the credit store). Here we
  // only build the cancel-aware renewal sub-line, which still wants the
  // "billed monthly/yearly" hint when a subscription is active.
  const cadence = summary?.cadence ?? null;
  const cadenceHint = cadence === "yearly" ? t.yearlyHint : t.monthlyHint;
  // Action button for the shared plan card: Cancel/Resume when subscribed,
  // Upgrade otherwise. Renewal sub-line: "ends on" when a cancel is
  // scheduled, else "renews · billed {cadence}".
  const planAction = !hasSub ? (
    <Link
      href={localizedHref("/plans", locale)}
      className="btn-gradient shrink-0 px-6 py-2.5 text-sm no-underline"
    >
      {t.upgrade}
    </Link>
  ) : summary?.cancelAtPeriodEnd ? (
    <button
      type="button"
      disabled={busy !== null}
      onClick={resumeSub}
      className="btn-gradient shrink-0 px-6 py-2.5 text-sm"
    >
      {busy === "resume" ? t.loading : t.resumeSub}
    </button>
  ) : (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => setConfirmCancel(true)}
      className="btn-pill shrink-0 px-6 py-2.5 text-sm"
    >
      {t.cancelSub}
    </button>
  );
  const renewalNote = hasSub
    ? summary?.cancelAtPeriodEnd
      ? t.endsOn.replace("{date}", periodEnd ?? "")
      : `${t.renews.replace("{date}", periodEnd ?? "")}${cadence ? ` · ${cadenceHint}` : ""}`
    : undefined;

  async function post(path: string, key: string, body?: unknown): Promise<Response | null> {
    setBusy(key);
    try {
      return await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function cancelSub() {
    const res = await post("/api/billing/subscription/cancel", "cancel");
    setConfirmCancel(false);
    if (res?.ok) {
      setSummary((s) => (s ? { ...s, cancelAtPeriodEnd: true } : s));
      refreshSummary();
    }
  }

  async function resumeSub() {
    const res = await post("/api/billing/subscription/resume", "resume");
    if (res?.ok) {
      setSummary((s) => (s ? { ...s, cancelAtPeriodEnd: false } : s));
      refreshSummary();
    }
  }

  async function removeCard(id: string) {
    setCardNotice(null);
    const res = await post("/api/billing/payment-methods/detach", id, {
      paymentMethodId: id,
    });
    if (res?.status === 409) setCardNotice(t.removeDefaultBlocked);
    if (res?.ok) refreshMethods();
  }

  async function makeDefault(id: string) {
    setCardNotice(null);
    const res = await post("/api/billing/payment-methods/default", id, {
      paymentMethodId: id,
    });
    if (res?.ok) setDefaultId(id);
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Dunning banner - points at the card section below. */}
      {summary?.status === "past_due" ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm text-foreground"
          style={{
            background: "var(--tq-status-warn-bg)",
            borderColor: "var(--tq-status-warn-border)",
          }}
        >
          <span className="material-symbols-outlined text-[var(--tq-status-warn-text)]" style={{ fontSize: 16 }} aria-hidden>
            credit_card_off
          </span>
          {t.pastDue}
        </div>
      ) : null}

      {/* ── Subscription ── the shared plan card (same as /settings), with
          Cancel/Resume swapped in for the Upgrade CTA (user direction
          2026-06-13). */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          {t.subscriptionTitle}
        </h2>
        <PlanUsage action={planAction} renewalNote={renewalNote} />
      </div>

      {/* ── Payment methods ── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            {t.paymentMethodsTitle}
          </h2>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-pill px-4 py-2 text-sm"
            >
              {t.addCard}
            </button>
          ) : null}
        </div>

        <div className="surface-card rounded-2xl p-5">
          {methods === null ? (
            <p className="text-sm text-muted">{t.loading}</p>
          ) : methods.length === 0 && !adding ? (
            <p className="text-sm text-muted">{t.noCards}</p>
          ) : (
            <div>
              {methods.map((pm, i) => (
                <div
                  key={pm.id}
                  className={`settings-row ${i === methods.length - 1 && !adding ? "border-b-0" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-foreground/70" style={{ fontSize: 20 }} aria-hidden>
                      credit_card
                    </span>
                    <div>
                      <p className="settings-row-title flex items-center gap-2" dir="ltr">
                        {BRAND_LABELS[pm.brand] ?? pm.brand} •••• {pm.last4}
                        {pm.id === defaultId ? (
                          <span className="badge-purple">{t.defaultBadge}</span>
                        ) : null}
                      </p>
                      {pm.expMonth && pm.expYear ? (
                        <p className="settings-row-desc" dir="ltr">
                          {t.expires.replace(
                            "{date}",
                            `${String(pm.expMonth).padStart(2, "0")}/${String(pm.expYear).slice(-2)}`,
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {pm.id !== defaultId ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => makeDefault(pm.id)}
                        className="btn-pill px-3 py-1.5 text-xs"
                      >
                        {busy === pm.id ? t.loading : t.setDefault}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => removeCard(pm.id)}
                      className="btn-pill px-3 py-1.5 text-xs"
                    >
                      {t.removeCard}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cardNotice ? (
            <p className="mt-3 text-sm text-[var(--tq-status-warn-text)]" role="alert">
              {cardNotice}
            </p>
          ) : null}

          {/* Add-card form - SetupIntent + PaymentElement, themed like
              checkout, mounted only while open. */}
          <AnimatePresence>
            {adding ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="mt-4 border-t border-[var(--tq-border-hairline)] pt-4">
                  <AddCardForm
                    onDone={(savedId) => {
                      setAdding(false);
                      if (savedId) {
                        // First card (or user intent): make it the
                        // invoice default right away.
                        makeDefault(savedId);
                      }
                      refreshMethods();
                    }}
                  />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Cancel confirm ── */}
      <AnimatePresence>
        {confirmCancel ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="modal-dim fixed inset-0 z-50 flex items-start justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setConfirmCancel(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal mt-[20vh] w-full max-w-md rounded-2xl"
            >
              <NoticeCard
                icon="warning"
                tone="warn"
                title={t.cancelConfirmTitle}
                body={t.cancelConfirmBody.replace("{date}", periodEnd ?? "")}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(false)}
                      disabled={busy !== null}
                      className="btn-pill px-4 py-3 text-sm"
                    >
                      {t.keepSub}
                    </button>
                    <button
                      type="button"
                      onClick={cancelSub}
                      disabled={busy !== null}
                      className="btn-pill-danger px-4 py-3 text-sm"
                    >
                      {busy === "cancel" ? t.loading : t.confirmCancel}
                    </button>
                  </>
                }
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ─── Add-card form (SetupIntent + PaymentElement) ───

function AddCardForm({ onDone }: { onDone: (savedId: string | null) => void }) {
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.components.billing;
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/billing/payment-methods/setup-intent", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { clientSecret?: string } | null) => {
        if (!live) return;
        if (d?.clientSecret) setClientSecret(d.clientSecret);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="text-sm text-muted">{t.cardError}</p>;
  if (!clientSecret) return <p className="text-sm text-muted">{t.loading}</p>;

  return (
    <Elements
      stripe={getStripe(locale)}
      options={{
        clientSecret,
        appearance: checkoutAppearance(),
        fonts: CHECKOUT_FONTS,
      }}
    >
      <AddCardInner onDone={onDone} />
    </Elements>
  );
}

function AddCardInner({ onDone }: { onDone: (savedId: string | null) => void }) {
  const dict = useDict();
  const t = dict.components.billing;
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const result = await stripe.confirmSetup({
      elements,
      // Cards confirm in place; only redirect-based methods would
      // leave the page (we mint card-only SetupIntents).
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? t.cardError);
      setSaving(false);
      return;
    }
    const pm = result.setupIntent?.payment_method;
    onDone(typeof pm === "string" ? pm : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p className="text-sm text-[rgb(220,38,38)]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onDone(null)}
          disabled={saving || !stripe || !elements}
          className="btn-pill px-4 py-2 text-sm"
        >
          {dict.pages.settings.deleteAccount.cancel}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !stripe}
          className="btn-gradient px-5 py-2 text-sm disabled:opacity-60"
        >
          {saving ? t.savingCard : t.saveCard}
        </button>
      </div>
    </div>
  );
}
