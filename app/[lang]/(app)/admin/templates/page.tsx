"use client";

// Admin > Templates curation. Static Phase-0 screen: a "Featured" set (drives
// the landing grid + marquee, manual order) and a pool of all public templates
// to feature from; a Premium toggle per template. State is local over mock data
// (lib/admin/mock.ts); the wiring phase persists via PATCH /api/admin/templates.
// English-only, dark-only, LTR (forced by the admin layout).

import { useState } from "react";
import { MOCK_TEMPLATES, type AdminTemplate } from "@/lib/admin/mock";

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

// Featured items sorted by their manual order.
function featuredSorted(list: AdminTemplate[]): AdminTemplate[] {
  return list
    .filter((t) => t.featured)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function Thumb({ t }: { t: AdminTemplate }) {
  const ratio = "16 / 9"; // always 16:9 in the listing, like the projects page
  // Phase 0: placeholder tile (mock has no thumbnails). Real thumbnailUrls land
  // in the wiring phase.
  return (
    <div
      className="grid w-full place-items-center overflow-hidden rounded-lg"
      style={{
        aspectRatio: ratio,
        background: "var(--tq-overlay-soft)",
        border: "1px solid var(--tq-border-hairline)",
      }}
    >
      <span className="text-2xl font-bold" style={{ color: MUTED }}>
        {t.name.charAt(0)}
      </span>
    </div>
  );
}

function PremiumToggle({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
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

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<AdminTemplate[]>(MOCK_TEMPLATES);

  const featured = featuredSorted(templates);
  const pool = templates.filter((t) => !t.featured);

  const renumber = (list: AdminTemplate[]): AdminTemplate[] => {
    const order = new Map(featuredSorted(list).map((t, i) => [t.id, i]));
    return list.map((t) =>
      t.featured ? { ...t, order: order.get(t.id) ?? 0 } : { ...t, order: null },
    );
  };

  const toggleFeatured = (id: string) => {
    setTemplates((prev) => {
      const next = prev.map((t) =>
        t.id === id
          ? {
              ...t,
              featured: !t.featured,
              order: t.featured ? null : prev.filter((x) => x.featured).length,
            }
          : t,
      );
      return renumber(next);
    });
  };

  const togglePremium = (id: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, premium: !t.premium } : t)),
    );
  };

  const move = (id: string, dir: -1 | 1) => {
    setTemplates((prev) => {
      const sorted = featuredSorted(prev);
      const idx = sorted.findIndex((t) => t.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= sorted.length) return prev;
      const a = sorted[idx];
      const b = sorted[swap];
      return prev.map((t) => {
        if (t.id === a.id) return { ...t, order: b.order };
        if (t.id === b.id) return { ...t, order: a.order };
        return t;
      });
    });
  };

  return (
    <div className="space-y-8">
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
          All public templates
        </h2>
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
      </section>
    </div>
  );
}
