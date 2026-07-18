"use client";

// Admin > Activity (client). Lists users (name / email / signup location) with
// client-side search + pagination (Decks-tab pattern). Each row expands to lazy-
// load that user's full activity timeline from /api/admin/activity/[userId]:
// deck generations, full + partial regens (with the slides that changed),
// failed/cancelled runs, and exports. English-only, dark-only, LTR (forced by
// the admin layout). A ?user=<id> query auto-expands + pages to that user.

import { useCallback, useState } from "react";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { formatRelativeTime } from "@/lib/util/relative-time";
import { IconCircle } from "@/components/admin/IconCircle";
import type {
  ActivityUser,
  ActivityTimeline,
  TimelineItem,
} from "@/lib/admin/activity";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const DANGER = "var(--tq-status-down-text)";
const DANGER_BG = "var(--tq-status-down-bg)";

const PAGE_SIZE = 10;

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  png: "PNG",
  pptx: "PPTX",
  gslides: "Google Slides",
  gslides_fallback_pptx: "Google Slides (PPTX)",
};

type TimelineState = {
  items: TimelineItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
};

// ─── One activity row ────────────────────────────────────────────────────────

function Pill({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ color: PRIMARY, background: "var(--tq-overlay-soft)" }}
    >
      {children}
    </span>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  // icon + primary label + a right-side meta (cost / duration or format).
  let icon = "auto_awesome";
  let iconColor: string | undefined;
  let iconBg: string | undefined;
  let title = "";
  let meta: string | null = null;

  switch (item.kind) {
    case "generation":
      icon = "auto_awesome";
      title = `New deck · ${item.flow}`;
      meta = [item.cost, item.duration].filter(Boolean).join(" · ") || null;
      break;
    case "regen-full":
      icon = "autorenew";
      title = `Full regen · ${item.flow}`;
      meta = [item.cost, item.duration].filter(Boolean).join(" · ") || null;
      break;
    case "regen-partial":
      icon = "auto_fix_high";
      title = `Partial regen · ${item.count} ${item.count === 1 ? "slide" : "slides"}`;
      meta = [item.cost, item.duration].filter(Boolean).join(" · ") || null;
      break;
    case "export":
      icon = "ios_share";
      title = `Exported ${FORMAT_LABEL[item.format] ?? item.format}`;
      meta =
        item.slideCount != null
          ? `${item.slideCount} ${item.slideCount === 1 ? "slide" : "slides"}`
          : null;
      break;
    case "failed-gen":
      icon = "error";
      iconColor = DANGER;
      iconBg = DANGER_BG;
      title =
        item.outcome === "cancelled"
          ? `Generation cancelled · ${item.flow}`
          : `Generation failed · ${item.flow}`;
      break;
  }

  return (
    <div className="flex items-start gap-3 py-2.5">
      <IconCircle icon={icon} size={30} iconSize={16} color={iconColor} background={iconBg} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-sm"
            style={{ color: item.kind === "failed-gen" ? DANGER : PRIMARY }}
          >
            {title}
          </span>
        </div>
        {item.projectTitle ? (
          <div
            className="inline-block max-w-full truncate align-bottom text-xs"
            style={{ color: MUTED }}
            dir="auto"
          >
            {item.projectTitle}
          </div>
        ) : null}
        {item.kind === "regen-partial" && item.slides.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.slides.map((s, i) => (
              <Pill key={i} title={s.role ?? undefined}>
                {s.position != null ? `Slide ${s.position}` : "Slide ?"}
                {s.role ? ` · ${s.role}` : ""}
              </Pill>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {meta ? (
          <span className="text-xs tabular-nums" style={{ color: PRIMARY }}>
            {meta}
          </span>
        ) : null}
        <span className="text-xs" style={{ color: MUTED }} suppressHydrationWarning>
          {formatRelativeTime(item.at, "en")}
        </span>
      </div>
    </div>
  );
}

// ─── Expanded timeline ───────────────────────────────────────────────────────

function Timeline({
  state,
  onLoadMore,
  onRetry,
}: {
  state: TimelineState | undefined;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  // Only the INITIAL load (no items yet) takes over with the loading / error /
  // empty states. Once items are loaded, a failed "load more" keeps them on
  // screen and surfaces the error inline on the footer button.
  if (!state || (state.loading && state.items.length === 0)) {
    return (
      <p className="py-4 text-center text-sm" style={{ color: MUTED }}>
        Loading activity...
      </p>
    );
  }
  if (state.items.length === 0) {
    if (state.error) {
      return (
        <div className="flex items-center justify-center gap-3 py-4">
          <span className="text-sm" style={{ color: MUTED }}>
            Could not load activity.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ color: PRIMARY, background: "var(--tq-overlay-soft)" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <p className="py-4 text-center text-sm" style={{ color: MUTED }}>
        No activity yet.
      </p>
    );
  }
  return (
    <div className="ps-2">
      {state.items.map((it, i) => (
        <div
          key={it.id}
          style={
            i === state.items.length - 1
              ? undefined
              : { borderBottom: "1px solid var(--tq-border-hairline)" }
          }
        >
          <TimelineRow item={it} />
        </div>
      ))}
      {state.loadingMore || state.error || state.nextCursor ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={state.loadingMore}
            className="rounded-full px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ color: PRIMARY, background: "var(--tq-overlay-soft)" }}
          >
            {state.loadingMore
              ? "Loading..."
              : state.error
                ? "Couldn't load more. Retry"
                : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ActivityClient({
  users,
  initialUserId,
  initialTimeline,
}: {
  users: ActivityUser[];
  initialUserId: string | null;
  initialTimeline: ActivityTimeline | null;
}) {
  const initialIndex = initialUserId
    ? users.findIndex((u) => u.id === initialUserId)
    : -1;

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(
    initialIndex >= 0 ? Math.floor(initialIndex / PAGE_SIZE) + 1 : 1,
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialIndex >= 0 ? [initialUserId as string] : []),
  );
  // The deep-linked user's timeline is fetched on the server and seeded here as
  // the initial state, so its row opens already populated with no fetch-on-mount.
  const [timelines, setTimelines] = useState<Record<string, TimelineState>>(() =>
    initialUserId && initialTimeline
      ? {
          [initialUserId]: {
            items: initialTimeline.items,
            nextCursor: initialTimeline.nextCursor,
            loading: false,
            loadingMore: false,
            error: false,
          },
        }
      : {},
  );

  // Async fetch ONLY: setState lands in an async continuation. Called from
  // startLoad (event handlers), never directly from render/effects.
  const fetchTimeline = useCallback(async (userId: string, cursor?: string) => {
    try {
      const qs = new URLSearchParams();
      if (cursor) qs.set("before", cursor);
      const res = await fetch(
        `/api/admin/activity/${userId}${qs.toString() ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        items: TimelineItem[];
        nextCursor: string | null;
      };
      setTimelines((prev) => ({
        ...prev,
        [userId]: {
          items: cursor
            ? [...(prev[userId]?.items ?? []), ...data.items]
            : data.items,
          nextCursor: data.nextCursor,
          loading: false,
          loadingMore: false,
          error: false,
        },
      }));
    } catch {
      setTimelines((prev) => ({
        ...prev,
        [userId]: {
          items: prev[userId]?.items ?? [],
          nextCursor: prev[userId]?.nextCursor ?? null,
          loading: false,
          loadingMore: false,
          error: true,
        },
      }));
    }
  }, []);

  // Set the loading flag + kick the fetch. Called only from event handlers, so
  // the synchronous setState here is fine.
  const startLoad = (userId: string, cursor?: string) => {
    setTimelines((prev) => ({
      ...prev,
      [userId]: {
        items: prev[userId]?.items ?? [],
        nextCursor: prev[userId]?.nextCursor ?? null,
        loading: !cursor,
        loadingMore: !!cursor,
        error: false,
      },
    }));
    fetchTimeline(userId, cursor);
  };

  const toggle = (userId: string) => {
    const willExpand = !expanded.has(userId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(userId);
      else next.delete(userId);
      return next;
    });
    if (willExpand && !timelines[userId]) startLoad(userId);
  };

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.country ?? "").toLowerCase().includes(q) ||
      (u.city ?? "").toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 220 }}>
          <span
            aria-hidden="true"
            className="material-symbols-outlined pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
            style={{ fontSize: 18, color: MUTED }}
          >
            search
          </span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, or location"
            className="h-10 w-full rounded-full ps-10 pe-4 text-sm outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      {/* List */}
      <div className="surface-card rounded-xl px-4">
        {pageRows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: MUTED }}>
            No users match this search.
          </p>
        ) : (
          pageRows.map((u, i) => {
            const isOpen = expanded.has(u.id);
            const location = [u.city, u.country].filter(Boolean).join(", ");
            return (
              <div
                key={u.id}
                style={{
                  borderBottom:
                    i === pageRows.length - 1 && !isOpen
                      ? "none"
                      : "1px solid var(--tq-border-hairline)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(u.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-4 py-3 text-start"
                >
                  <span
                    className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-bold"
                    style={{
                      background: avatarGradientForSeed(u.email),
                      color: "#fff",
                    }}
                  >
                    {u.name.charAt(0).toUpperCase()}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm font-medium"
                      style={{ color: PRIMARY }}
                    >
                      {u.name}
                    </div>
                    <div className="truncate text-xs" style={{ color: MUTED }}>
                      {u.email}
                    </div>
                  </div>

                  <div
                    className="hidden min-w-0 max-w-[180px] flex-shrink-0 items-center gap-1.5 text-xs sm:flex"
                    style={{ color: MUTED }}
                  >
                    {location ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined"
                          style={{ fontSize: 15 }}
                        >
                          location_on
                        </span>
                        <span className="truncate">{location}</span>
                      </>
                    ) : (
                      <span style={{ opacity: 0.6 }}>Unknown</span>
                    )}
                  </div>

                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined flex-shrink-0 transition-transform"
                    style={{
                      fontSize: 20,
                      color: MUTED,
                      transform: isOpen ? "rotate(180deg)" : "none",
                    }}
                  >
                    expand_more
                  </span>
                </button>

                {isOpen ? (
                  <div className="pb-3">
                    <Timeline
                      state={timelines[u.id]}
                      onLoadMore={() => {
                        const cursor = timelines[u.id]?.nextCursor;
                        if (cursor) startLoad(u.id, cursor);
                      }}
                      onRetry={() => startLoad(u.id)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs" style={{ color: MUTED }}>
          Showing {rangeStart}-{rangeEnd} of {filtered.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
            className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40"
            style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              chevron_left
            </span>
          </button>
          <span className="text-xs" style={{ color: MUTED }}>
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, safePage + 1))}
            disabled={safePage >= totalPages}
            aria-label="Next page"
            className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40"
            style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              chevron_right
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
