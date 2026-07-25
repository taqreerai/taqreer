"use client";

// Admin > Settings (client). Edits the DB-backed runtime config live: generation
// presets (full CRUD, model picked from the live Anthropic list), per-tier knobs
// (slide cap, monthly credits, signup grant = free credits, unlocked presets,
// flows), and the free-credit amount. Saves hit /api/admin/settings/* then
// router.refresh() to re-read the server snapshot. English-only, dark-only, LTR.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminModal as Modal } from "@/components/admin/AdminModal";
import type { PresetConfig, TierConfigRow } from "@/lib/config/runtime-config";
import type { LiveModel } from "@/lib/anthropic/models";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const ACCENT = "var(--tq-purple)";
const DANGER = "var(--tq-text-danger)";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

type Props = {
  presets: PresetConfig[];
  tiers: TierConfigRow[];
  models: LiveModel[];
  flows: string[];
  configVersion: number;
  // Per-generated-image surcharge (PlatformSettings.imageCredits).
  imageCredits: number;
  // Flat base per partial/slide regen run (PlatformSettings.regenBaseCredits,
  // 2026-07-10 vision-layer repricing: the regen's own review bake).
  regenBaseCredits: number;
};

type PresetForm = {
  key: string;
  label: string;
  model: string;
  thinking: boolean;
  effort: string;
  maxTokens: string;
  baseCredits: string;
  perSlideCredits: string;
  secsPerSlide: string;
  baseOverheadSecs: string;
  active: boolean;
};

const EMPTY_PRESET: PresetForm = {
  key: "",
  label: "",
  model: "",
  thinking: false,
  effort: "low",
  maxTokens: "128000",
  baseCredits: "100",
  perSlideCredits: "10",
  secsPerSlide: "10",
  baseOverheadSecs: "30",
  active: true,
};

function presetToForm(p: PresetConfig): PresetForm {
  return {
    key: p.key,
    label: p.label,
    model: p.model,
    thinking: p.thinking,
    effort: p.effort ?? "low",
    maxTokens: String(p.maxTokens),
    baseCredits: String(p.baseCredits),
    perSlideCredits: String(p.perSlideCredits),
    secsPerSlide: String(p.secsPerSlide),
    baseOverheadSecs: String(p.baseOverheadSecs),
    active: p.active,
  };
}

type TierForm = {
  monthlyAllotment: string;
  signupGrant: string;
  slideCap: string;
  unlockedPresetKeys: string[];
  flows: string[];
};

function tierToForm(t: TierConfigRow): TierForm {
  return {
    monthlyAllotment: String(t.monthlyAllotment),
    signupGrant: String(t.signupGrant),
    slideCap: String(t.slideCap),
    unlockedPresetKeys: [...t.unlockedPresetKeys],
    flows: [...t.flows],
  };
}

function StatusChip({ active }: { active: boolean }) {
  return active ? (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: "var(--tq-status-ok-bg)",
        color: "var(--tq-status-ok-text)",
        border: "1px solid var(--tq-status-ok-border)",
      }}
    >
      Active
    </span>
  ) : (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: MUTED, border: "1px solid var(--tq-border-hairline)" }}
    >
      Inactive
    </span>
  );
}

function Pill({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs"
      style={{
        color: accent ? ACCENT : MUTED,
        background: "var(--tq-overlay-soft)",
      }}
    >
      {children}
    </span>
  );
}

// Suggest a kebab-case preset key from the picked model + its thinking/effort,
// e.g. claude-opus-4-8 -> "opus-4-8-fast" (thinking off) / "opus-4-8-low" (on).
// De-duped against the existing keys so the suggestion always saves cleanly.
// Matches the server's key rule: /^[a-z0-9]+(-[a-z0-9]+)*$/.
function suggestKey(
  modelId: string,
  thinking: boolean,
  effort: string,
  taken: string[],
): string {
  const base = modelId
    .trim()
    .toLowerCase()
    .replace(/^claude-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "";
  const root = `${base}-${thinking ? effort || "low" : "fast"}`;
  if (!taken.includes(root)) return root;
  for (let i = 2; i < 50; i++) {
    if (!taken.includes(`${root}-${i}`)) return `${root}-${i}`;
  }
  return root;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: MUTED }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function SettingsClient({ presets, tiers, models: initialModels, flows, configVersion, imageCredits, regenBaseCredits }: Props) {
  const router = useRouter();
  // Live model list, seeded from the server prop. Kept in state so the picker's
  // Refresh button can swap in a freshly fetched list without a page reload.
  const [models, setModels] = useState<LiveModel[]>(initialModels);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [presetModal, setPresetModal] = useState<{ mode: "add" | "edit"; key?: string } | null>(
    null,
  );
  const [presetForm, setPresetForm] = useState<PresetForm>(EMPTY_PRESET);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [tierPlan, setTierPlan] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState<TierForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Platform pricing knobs inline editor (Platform section). Saved together -
  // the PATCH route validates and writes both.
  const [imageCreditsDraft, setImageCreditsDraft] = useState(String(imageCredits));
  const [regenBaseDraft, setRegenBaseDraft] = useState(String(regenBaseCredits));
  const [imageSaving, setImageSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const saveImageCredits = async () => {
    setImageSaving(true);
    setImageError(null);
    try {
      const res = await fetch("/api/admin/settings/platform", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          imageCredits: imageCreditsDraft,
          regenBaseCredits: regenBaseDraft,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Save failed");
      }
      router.refresh();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setImageSaving(false);
    }
  };

  const freeTier = tiers.find((t) => t.plan === "free");

  const openAdd = () => {
    setPresetForm(EMPTY_PRESET);
    setError(null);
    setPresetModal({ mode: "add" });
  };
  const openEdit = (p: PresetConfig) => {
    setPresetForm(presetToForm(p));
    setError(null);
    setPresetModal({ mode: "edit", key: p.key });
  };
  const openTier = (t: TierConfigRow) => {
    setTierForm(tierToForm(t));
    setError(null);
    setTierPlan(t.plan);
  };

  const fableModel = /fable/i.test(presetForm.model);
  const patch = (next: Partial<PresetForm>) => setPresetForm((f) => ({ ...f, ...next }));

  // The stored model is no longer offered by the API (renamed / retired). Keep
  // it selectable so editing an existing preset never silently reassigns it.
  const staleModel =
    presetForm.model.trim().length > 0 &&
    !models.some((m) => m.id === presetForm.model);

  const refreshModels = async () => {
    if (modelsLoading) return;
    setModelsLoading(true);
    setModelsNote(null);
    try {
      const res = await fetch("/api/admin/settings/models?refresh=1", {
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as {
        models?: LiveModel[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      const next = json.models ?? [];
      setModels(next);
      setModelsNote(
        next.length ? `Updated: ${next.length} models` : "Live list unavailable",
      );
    } catch (e) {
      setModelsNote(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setModelsLoading(false);
    }
  };

  // Picking a model fills Label (its display name) and, when adding, suggests a
  // Key. Both stay editable: they are only overwritten while still empty or
  // still holding the value auto-derived from the PREVIOUS model, so a label or
  // key you typed yourself is never clobbered.
  const onModelChange = (nextId: string) => {
    const prev = models.find((m) => m.id === presetForm.model);
    const next = models.find((m) => m.id === nextId);
    const update: Partial<PresetForm> = { model: nextId };
    if (
      next &&
      (!presetForm.label.trim() || (prev && presetForm.label === prev.displayName))
    ) {
      update.label = next.displayName;
    }
    if (presetModal?.mode === "add") {
      const taken = presets.map((p) => p.key);
      // Fable forces thinking on, which changes the key suffix. Detect
      // "still auto" with the thinking state that produced the CURRENT key
      // (the previous model's), not the incoming one, or switching e.g.
      // opus -> fable would strand the old "opus-5-fast" key.
      const prevThinking = /fable/i.test(presetForm.model)
        ? true
        : presetForm.thinking;
      const nextThinking = /fable/i.test(nextId) ? true : presetForm.thinking;
      const prevSuggestion = prev
        ? suggestKey(prev.id, prevThinking, presetForm.effort, taken)
        : "";
      if (!presetForm.key.trim() || presetForm.key === prevSuggestion) {
        update.key = suggestKey(nextId, nextThinking, presetForm.effort, taken);
      }
    }
    patch(update);
  };

  const savePreset = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const thinking = fableModel ? true : presetForm.thinking;
    const body = {
      key: presetForm.key,
      label: presetForm.label,
      model: presetForm.model,
      thinking,
      effort: thinking ? presetForm.effort : null,
      maxTokens: Number(presetForm.maxTokens),
      baseCredits: Number(presetForm.baseCredits),
      perSlideCredits: Number(presetForm.perSlideCredits),
      secsPerSlide: Number(presetForm.secsPerSlide),
      baseOverheadSecs: Number(presetForm.baseOverheadSecs),
      active: presetForm.active,
    };
    const url =
      presetModal?.mode === "edit"
        ? `/api/admin/settings/presets/${presetModal.key}`
        : "/api/admin/settings/presets";
    try {
      const res = await fetch(url, {
        method: presetModal?.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setPresetModal(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteKey || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/settings/presets/${deleteKey}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
      setDeleteKey(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const saveTier = async () => {
    if (!tierPlan || !tierForm || saving) return;
    setSaving(true);
    setError(null);
    const body = {
      monthlyAllotment: Number(tierForm.monthlyAllotment),
      signupGrant: Number(tierForm.signupGrant),
      slideCap: Number(tierForm.slideCap),
      unlockedPresetKeys: tierForm.unlockedPresetKeys,
      flows: tierForm.flows,
    };
    try {
      const res = await fetch(`/api/admin/settings/tiers/${tierPlan}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setTierPlan(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleIn = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="space-y-8">
      {/* Free credits highlight */}
      <section
        className="surface-card flex items-center justify-between rounded-xl p-5"
      >
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>
            Free credits
          </div>
          <div className="text-3xl font-bold" style={{ color: PRIMARY }}>
            {(freeTier?.signupGrant ?? 0).toLocaleString("en-US")}
          </div>
          <p className="text-xs" style={{ color: MUTED }}>
            Granted once to every new signup. Drives the grant, the welcome email,
            the credit ring, and pricing.
          </p>
        </div>
        {freeTier ? (
          <button
            type="button"
            onClick={() => openTier(freeTier)}
            className="btn-pill flex h-10 items-center gap-2 px-4 text-sm font-medium"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              edit
            </span>
            Edit
          </button>
        ) : null}
      </section>

      {/* Presets */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold" style={{ color: PRIMARY }}>
              Generation presets
            </h2>
            <p className="text-xs" style={{ color: MUTED }}>
              Model, thinking, and credit cost per preset. Inactive presets
              disappear from the generation picker; a direct request falls back
              to the default.
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="btn-pill flex h-10 items-center gap-2 px-4 text-sm font-medium"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              add
            </span>
            Add preset
          </button>
        </div>

        <div className="surface-card rounded-xl px-4">
          {presets.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: MUTED }}>
              No presets configured.
            </p>
          ) : (
            presets.map((p, i) => (
              <div
                key={p.key}
                className="flex items-center gap-4 py-3"
                style={{
                  borderBottom:
                    i === presets.length - 1
                      ? "none"
                      : "1px solid var(--tq-border-hairline)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium" style={{ color: PRIMARY }}>
                      {p.label}
                    </span>
                    <StatusChip active={p.active} />
                  </div>
                  <span className="truncate text-xs" style={{ color: MUTED }}>
                    {p.key} · {p.model}
                  </span>
                </div>

                <div className="hidden items-center gap-2 sm:flex">
                  {p.thinking ? (
                    <Pill accent>Thinking{p.effort ? ` · ${p.effort}` : ""}</Pill>
                  ) : (
                    <Pill>Fast</Pill>
                  )}
                </div>

                <div className="hidden w-28 text-end text-xs sm:block" style={{ color: MUTED }}>
                  <span style={{ color: PRIMARY }}>{p.baseCredits}</span> + {p.perSlideCredits}
                  /slide
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    aria-label="Edit preset"
                    title="Edit preset"
                    className="grid h-8 w-8 place-items-center rounded-full"
                    style={{ color: ACCENT, background: "var(--tq-overlay-soft)" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      edit
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDeleteKey(p.key);
                    }}
                    aria-label="Delete preset"
                    title="Delete preset"
                    className="grid h-8 w-8 place-items-center rounded-full"
                    style={{ color: DANGER, background: "var(--tq-overlay-soft)" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      delete
                    </span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Tiers */}
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold" style={{ color: PRIMARY }}>
            Tiers
          </h2>
          <p className="text-xs" style={{ color: MUTED }}>
            Slide cap, monthly credits, signup grant, unlocked presets, and flows
            per plan. Price is display-only (real prices are Stripe products).
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {tiers.map((t) => (
            <div key={t.plan} className="surface-card space-y-3 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold capitalize" style={{ color: PRIMARY }}>
                    {t.plan}
                  </span>
                  <span className="text-xs" style={{ color: MUTED }}>
                    {t.priceUsd === 0 ? "Free" : `$${t.priceUsd}/mo`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openTier(t)}
                  aria-label="Edit tier"
                  title="Edit tier"
                  className="grid h-8 w-8 place-items-center rounded-full"
                  style={{ color: ACCENT, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    edit
                  </span>
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt style={{ color: MUTED }}>Monthly credits</dt>
                <dd className="text-end" style={{ color: PRIMARY }}>
                  {t.monthlyAllotment.toLocaleString("en-US")}
                </dd>
                <dt style={{ color: MUTED }}>Signup grant</dt>
                <dd className="text-end" style={{ color: PRIMARY }}>
                  {t.signupGrant.toLocaleString("en-US")}
                </dd>
                <dt style={{ color: MUTED }}>Slide cap</dt>
                <dd className="text-end" style={{ color: PRIMARY }}>
                  {t.slideCap}
                </dd>
              </dl>
              <div className="flex flex-wrap gap-1">
                {t.unlockedPresetKeys.map((k) => (
                  <Pill key={k}>{k}</Pill>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {t.flows.map((f) => (
                  <Pill key={f}>{f}</Pill>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform-wide pricing knobs */}
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold" style={{ color: PRIMARY }}>
            Platform pricing
          </h2>
          <p className="text-xs" style={{ color: MUTED }}>
            Credits per generated image on images-mode decks (held one per
            slide up to the 12-image deck cap; settled on actual boxes; 0 =
            free), and the flat base charged once per partial/slide regen run
            (the regen&apos;s own render + vision review + freeze bake).
          </p>
        </div>
        <div className="surface-card flex flex-wrap items-end gap-3 rounded-xl p-4">
          <Field label="Credits per image">
            <input
              type="number"
              min={0}
              value={imageCreditsDraft}
              onChange={(e) => setImageCreditsDraft(e.target.value)}
              className="w-32 rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label="Regen base credits">
            <input
              type="number"
              min={0}
              value={regenBaseDraft}
              onChange={(e) => setRegenBaseDraft(e.target.value)}
              className="w-32 rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>
          <button
            type="button"
            onClick={saveImageCredits}
            disabled={
              imageSaving ||
              (imageCreditsDraft === String(imageCredits) &&
                regenBaseDraft === String(regenBaseCredits))
            }
            className="btn-pill px-4 py-2 text-sm disabled:opacity-50"
          >
            {imageSaving ? "Saving..." : "Save"}
          </button>
          {imageError ? (
            <span className="text-xs" style={{ color: DANGER }}>
              {imageError}
            </span>
          ) : null}
        </div>
      </section>

      {/* Live models reference */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium" style={{ color: MUTED }}>
          Available models (live){models.length ? ` · ${models.length}` : ""}
        </h2>
        {models.length === 0 ? (
          <p className="text-xs" style={{ color: MUTED }}>
            Live list unavailable (no API key or fetch failed). The model field
            falls back to typing the id.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span
                key={m.id}
                title={m.id}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
              >
                {m.displayName}
              </span>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs" style={{ color: MUTED }}>
        Config version {configVersion}
      </p>

      {/* Preset add/edit modal */}
      <Modal
        open={presetModal !== null}
        title={presetModal?.mode === "edit" ? "Edit preset" : "Add preset"}
        onClose={() => setPresetModal(null)}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key (kebab-case)">
              <input
                value={presetForm.key}
                onChange={(e) => patch({ key: e.target.value })}
                disabled={presetModal?.mode === "edit"}
                placeholder="opus-fast"
                className="h-10 w-full rounded-lg px-3 text-sm outline-none disabled:opacity-50"
                style={inputStyle}
              />
            </Field>
            <Field label="Label">
              <input
                value={presetForm.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="Opus 4.8"
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="Model">
            <div className="flex items-center gap-2">
              {models.length === 0 ? (
                // Live list unavailable (no API key / fetch failed): fall back to
                // typing the id so an existing preset stays editable.
                <input
                  value={presetForm.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  placeholder="claude-opus-4-8"
                  className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                  style={inputStyle}
                />
              ) : (
                <select
                  value={presetForm.model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                  style={inputStyle}
                >
                  {!presetForm.model && <option value="">Select a model</option>}
                  {staleModel && (
                    <option value={presetForm.model}>
                      {presetForm.model} (not in live list)
                    </option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.id})
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={refreshModels}
                disabled={modelsLoading}
                title="Re-fetch the live model list from Anthropic"
                className="btn-pill h-10 shrink-0 px-4 disabled:opacity-50"
              >
                {modelsLoading ? "Refreshing" : "Refresh"}
              </button>
            </div>
            {staleModel && models.length > 0 ? (
              <p className="text-xs" style={{ color: DANGER }}>
                This model is not in the live list. Saving will be rejected, pick
                a current one.
              </p>
            ) : null}
            {modelsNote ? (
              <p className="text-xs" style={{ color: MUTED }}>
                {modelsNote}
              </p>
            ) : null}
          </Field>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ color: PRIMARY }}>
              <input
                type="checkbox"
                checked={fableModel ? true : presetForm.thinking}
                disabled={fableModel}
                onChange={(e) => patch({ thinking: e.target.checked })}
              />
              Thinking{fableModel ? " (forced for Fable)" : ""}
            </label>
            {(fableModel || presetForm.thinking) && (
              <select
                value={presetForm.effort}
                onChange={(e) => patch({ effort: e.target.value })}
                className="h-9 rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              >
                {EFFORTS.map((eff) => (
                  <option key={eff} value={eff}>
                    {eff}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Base credits">
              <input
                type="number"
                min={0}
                value={presetForm.baseCredits}
                onChange={(e) => patch({ baseCredits: e.target.value })}
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="Per-slide">
              <input
                type="number"
                min={0}
                value={presetForm.perSlideCredits}
                onChange={(e) => patch({ perSlideCredits: e.target.value })}
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="Max tokens">
              <input
                type="number"
                min={1}
                value={presetForm.maxTokens}
                onChange={(e) => patch({ maxTokens: e.target.value })}
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Secs/slide">
              <input
                type="number"
                min={0}
                value={presetForm.secsPerSlide}
                onChange={(e) => patch({ secsPerSlide: e.target.value })}
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="Overhead secs">
              <input
                type="number"
                min={0}
                value={presetForm.baseOverheadSecs}
                onChange={(e) => patch({ baseOverheadSecs: e.target.value })}
                className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="Active">
              <label
                className="flex h-10 items-center gap-2 text-sm"
                style={{ color: PRIMARY }}
              >
                <input
                  type="checkbox"
                  checked={presetForm.active}
                  onChange={(e) => patch({ active: e.target.checked })}
                />
                Selectable
              </label>
            </Field>
          </div>

          {error ? (
            <p className="text-xs" style={{ color: DANGER }}>
              {error}
            </p>
          ) : null}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPresetModal(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={savePreset}
              disabled={saving}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save preset"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete preset confirm */}
      <Modal open={deleteKey !== null} title="Delete preset" onClose={() => setDeleteKey(null)}>
        <div className="space-y-4">
          <p className="text-sm" style={{ color: MUTED }}>
            Delete preset <span style={{ color: PRIMARY }}>{deleteKey}</span>? It
            will be removed from every tier. Blocked if a tier would be left with
            no active preset.
          </p>
          {error ? (
            <p className="text-xs" style={{ color: DANGER }}>
              {error}
            </p>
          ) : null}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteKey(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={saving}
              className="btn-pill-danger flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Deleting..." : "Delete preset"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Tier knobs modal */}
      <Modal
        open={tierPlan !== null}
        title={`Edit ${tierPlan ?? ""} tier`}
        onClose={() => setTierPlan(null)}
      >
        {tierForm ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Monthly credits">
                <input
                  type="number"
                  min={0}
                  value={tierForm.monthlyAllotment}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, monthlyAllotment: e.target.value })
                  }
                  className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                  style={inputStyle}
                />
              </Field>
              <Field
                label={tierPlan === "free" ? "Free credits" : "Signup grant"}
              >
                <input
                  type="number"
                  min={0}
                  value={tierForm.signupGrant}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, signupGrant: e.target.value })
                  }
                  className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                  style={inputStyle}
                />
              </Field>
              <Field label="Slide cap">
                <input
                  type="number"
                  min={1}
                  max={75}
                  value={tierForm.slideCap}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, slideCap: e.target.value })
                  }
                  className="h-10 w-full rounded-lg px-3 text-sm outline-none"
                  style={inputStyle}
                />
              </Field>
            </div>

            <Field label="Unlocked presets">
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const on = tierForm.unlockedPresetKeys.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() =>
                        setTierForm({
                          ...tierForm,
                          unlockedPresetKeys: toggleIn(
                            tierForm.unlockedPresetKeys,
                            p.key,
                          ),
                        })
                      }
                      className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        color: on ? PRIMARY : MUTED,
                        background: on ? "var(--tq-overlay)" : "var(--tq-overlay-soft)",
                        border: `1px solid ${on ? "var(--tq-status-ok-border)" : "var(--tq-border-hairline)"}`,
                        opacity: p.active ? 1 : 0.5,
                      }}
                    >
                      {p.key}
                      {p.active ? "" : " (inactive)"}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Flows">
              <div className="flex flex-wrap gap-2">
                {flows.map((f) => {
                  const on = tierForm.flows.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        setTierForm({ ...tierForm, flows: toggleIn(tierForm.flows, f) })
                      }
                      className="rounded-full px-3 py-1 text-xs font-medium capitalize"
                      style={{
                        color: on ? PRIMARY : MUTED,
                        background: on ? "var(--tq-overlay)" : "var(--tq-overlay-soft)",
                        border: `1px solid ${on ? "var(--tq-status-ok-border)" : "var(--tq-border-hairline)"}`,
                      }}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </Field>

            {error ? (
              <p className="text-xs" style={{ color: DANGER }}>
                {error}
              </p>
            ) : null}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setTierPlan(null)}
                className="btn-pill flex-1 px-4 py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveTier}
                disabled={saving}
                className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save tier"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
