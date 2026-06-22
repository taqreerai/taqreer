"use client";

// Admin > Templates curation (client). The curator account's public templates,
// split into a Featured set (drives the landing marquee + grid + welcome strip,
// in manual order) and a pool to feature from, plus a per-template Premium
// toggle. Every action persists via /api/admin/templates with an optimistic
// local update and a snapshot-revert on failure. Dark-only, LTR (admin layout).

import { useState } from "react";
import type { AdminTemplate } from "@/lib/admin/mock";

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

// Shown when an optimistic curation save fails and the card reverts.
const SAVE_ERROR =
  "Couldn't save that change - it was reverted. Check your connection and try again.";

function featuredSorted(list: AdminTemplate[]): AdminTemplate[] {
  return list
    .filter((t) => t.featured)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function Thumb({ t }: { t: AdminTemplate }) {
  return (
    <div
      className="grid w-full place-items-center overflow-hidden rounded-lg"
      style={{
        aspectRatio: "16 / 9",
        background: "var(--tq-overlay-soft)",
        border: "1px solid var(--tq-border-hairline)",
      }}
    >
      {t.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.thumbnail} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: 28, color: MUTED }}>
          image
        </span>
      )}
    </div>
  );
}

function PremiumToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      style={{
        color: on ? PRIMARY : MUTED,
        background: on ? "var(--tq-overlay)" : "transparent",
        border: `1px solid ${on ? "var(--tq-purple)" : "var(--tq-border-hairline)"}`,
      }}
      aria-pressed={on}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {on ? "lock" : "lock_open"}
      </span>
      Premium
    </button>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-30"
      style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
    </button>
  );
}

export function TemplatesClient({
  initialTemplates,
}: {
  initialTemplates: AdminTemplate[];
}) {
  const [templates, setTemplates] = useState<AdminTemplate[]>(initialTemplates);
  // Surfaced when an optimistic save fails and the card reverts, so a failed
  // save is visible instead of silently snapping back. Cleared on the next try.
  const [error, setError] = useState<string | null>(null);

  const featured = featuredSorted(templates);
  const pool = templates.filter((t) => !t.featured);

  // Recompute 0-based order over the featured set after a feature/unfeature.
  const renumber = (list: AdminTemplate[]): AdminTemplate[] => {
    const order = new Map(featuredSorted(list).map((t, i) => [t.id, i]));
    return list.map((t) =>
      t.featured ? { ...t, order: order.get(t.id) ?? 0 } : { ...t, order: null },
    );
  };

  const togglePremium = async (id: string) => {
    setError(null);
    const snapshot = templates;
    const cur = templates.find((t) => t.id === id);
    if (!cur) return;
    const next = !cur.premium;
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, premium: next } : t)),
    );
    try {
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPremium: next }),
      });
      if (!res.ok) throw new Error("premium failed");
    } catch {
      setTemplates(snapshot);
      setError(SAVE_ERROR);
    }
  };

  const toggleFeatured = async (id: string) => {
    setError(null);
    const snapshot = templates;
    const cur = templates.find((t) => t.id === id);
    if (!cur) return;
    const willFeature = !cur.featured;
    setTemplates((prev) =>
      renumber(
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                featured: willFeature,
                order: willFeature ? prev.filter((x) => x.featured).length : null,
              }
            : t,
        ),
      ),
    );
    try {
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: willFeature }),
      });
      if (!res.ok) throw new Error("feature failed");
    } catch {
      setTemplates(snapshot);
      setError(SAVE_ERROR);
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    setError(null);
    const snapshot = templates;
    const sorted = featuredSorted(templates);
    const idx = sorted.findIndex((t) => t.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
    const orderedIds = reordered.map((t) => t.id);
    const orderMap = new Map(orderedIds.map((tid, i) => [tid, i]));
    setTemplates((prev) =>
      prev.map((t) =>
        orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t,
      ),
    );
    try {
      const res = await fetch("/api/admin/templates/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error("reorder failed");
    } catch {
      setTemplates(snapshot);
      setError(SAVE_ERROR);
    }
  };

  return (
    <div className="space-y-8">
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--tq-status-down-bg)",
            border: "1px solid var(--tq-status-down-border)",
            color: "var(--tq-status-down-text)",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="material-symbols-outlined leading-none opacity-70 transition-opacity hover:opacity-100"
            style={{ fontSize: 18 }}
          >
            close
          </button>
        </div>
      ) : null}
      {/* Featured */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold" style={{ color: PRIMARY }}>
            Featured on landing + marquee
          </h2>
          <span className="text-xs" style={{ color: MUTED }}>
            {featured.length} featured - top to bottom = landing order
          </span>
        </div>

        {featured.length === 0 ? (
          <p
            className="surface-card rounded-xl p-6 text-center text-sm"
            style={{ color: MUTED }}
          >
            Nothing featured yet. Feature templates from the pool below.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((t, i) => (
              <div
                key={t.id}
                className="surface-card flex flex-col gap-3 rounded-xl p-3"
              >
                <div className="relative">
                  <Thumb t={t} />
                  <span
                    className="absolute start-2 top-2 grid h-6 w-6 place-items-center rounded-full text-xs font-bold"
                    style={{ background: ACCENT, color: "#fff" }}
                  >
                    {i + 1}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: PRIMARY }}
                  >
                    {t.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <PremiumToggle on={t.premium} onClick={() => togglePremium(t.id)} />
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon="keyboard_arrow_up"
                      label="Move up"
                      onClick={() => move(t.id, -1)}
                      disabled={i === 0}
                    />
                    <IconButton
                      icon="keyboard_arrow_down"
                      label="Move down"
                      onClick={() => move(t.id, 1)}
                      disabled={i === featured.length - 1}
                    />
                    <IconButton
                      icon="star"
                      label="Unfeature"
                      onClick={() => toggleFeatured(t.id)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pool */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Curator templates - available to feature
        </h2>
        {pool.length === 0 ? (
          <p
            className="surface-card rounded-xl p-6 text-center text-sm"
            style={{ color: MUTED }}
          >
            No more public templates to feature.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {pool.map((t) => (
              <div
                key={t.id}
                className="surface-card flex flex-col gap-3 rounded-xl p-3"
              >
                <Thumb t={t} />
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: PRIMARY }}
                  >
                    {t.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <PremiumToggle on={t.premium} onClick={() => togglePremium(t.id)} />
                  <button
                    type="button"
                    onClick={() => toggleFeatured(t.id)}
                    className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors"
                    style={{ color: ACCENT, background: "var(--tq-overlay-soft)" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                      star
                    </span>
                    Feature
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
