"use client";

// /usage page body: the credit statement — how the user spent + received
// credits, newest-first, with a date filter (presets + a custom range).
// Built on the SAME `.settings-row` list the InvoicesList uses (the design
// system renders tabular data as settings rows, NEVER an HTML <table>;
// see /ar/brand). Each row is iconized by action: a generation reuses its
// flow's own static icon (create/enhance/mimic/datasheet), other movements
// fall back to a Material Symbol via AnimatedIcon.

import { useEffect, useRef, useState } from "react";
import {
  format,
  startOfMonth,
  startOfDay,
  endOfDay,
  subDays,
} from "date-fns";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { dateFnsLocale } from "@/lib/i18n/date";
import { SegmentedToggle } from "@/components/create/controls";
import { AnimatedIcon } from "@/components/icons/AnimatedIcon";
import { formatCredits } from "@/lib/credits/store";
import { describeLedgerRow, type LedgerRow } from "@/lib/credits/usage-events";
import { DateField, parseDateInput } from "@/components/common/DateField";

type Mode = "thisMonth" | "last30" | "allTime" | "custom";
type Totals = { spent: number; added: number };

type LedgerResponse = {
  rows: LedgerRow[];
  totals: Totals | null;
  nextCursor: string | null;
};

// A filter mode → the {from,to} window it queries. `custom` reads the two
// date inputs (either side optional). All non-custom presets end at "now".
function rangeFor(
  mode: Mode,
  customFrom: string,
  customTo: string,
): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (mode) {
    case "thisMonth":
      return { from: startOfMonth(now), to: now };
    case "last30":
      return { from: startOfDay(subDays(now, 29)), to: now };
    case "allTime":
      return { from: null, to: null };
    case "custom": {
      const f = parseDateInput(customFrom);
      const tt = parseDateInput(customTo);
      return {
        from: f ? startOfDay(f) : null,
        to: tt ? endOfDay(tt) : null,
      };
    }
  }
}

function buildQuery(
  from: Date | null,
  to: Date | null,
  cursor?: string,
): string {
  const p = new URLSearchParams();
  if (from) p.set("from", from.toISOString());
  if (to) p.set("to", to.toISOString());
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export function UsageList() {
  const dict = useDict();
  const { locale } = useLocale();
  const t = dict.components.usage;

  const [mode, setMode] = useState<Mode>("thisMonth");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Refetch page 1 whenever the filter changes. State resets live in the
  // change handlers below (not here) so this effect only ever sets state
  // inside the async resolution, matching the InvoicesList pattern.
  useEffect(() => {
    let live = true;
    const { from, to } = rangeFor(mode, customFrom, customTo);
    fetch(`/api/usage/ledger?${buildQuery(from, to)}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? (r.json() as Promise<LedgerResponse>) : null))
      .then((d) => {
        if (!live) return;
        if (d) {
          setRows(d.rows);
          setTotals(d.totals);
          setNextCursor(d.nextCursor);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [mode, customFrom, customTo]);

  function resetForRefetch() {
    setRows(null);
    setTotals(null);
    setNextCursor(null);
    setFailed(false);
  }

  function onModeChange(next: Mode) {
    resetForRefetch();
    if (next !== "custom") {
      setCustomFrom("");
      setCustomTo("");
    }
    setMode(next);
  }

  function onCustomFrom(value: string) {
    resetForRefetch();
    setMode("custom");
    setCustomFrom(value);
  }

  function onCustomTo(value: string) {
    resetForRefetch();
    setMode("custom");
    setCustomTo(value);
  }

  function onLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const { from, to } = rangeFor(mode, customFrom, customTo);
    fetch(`/api/usage/ledger?${buildQuery(from, to, nextCursor)}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? (r.json() as Promise<LedgerResponse>) : null))
      .then((d) => {
        if (!mountedRef.current) return;
        if (d) {
          setRows((prev) => [...(prev ?? []), ...d.rows]);
          setNextCursor(d.nextCursor);
        }
        setLoadingMore(false);
      })
      .catch(() => {
        if (mountedRef.current) setLoadingMore(false);
      });
  }

  const filterOptions: ReadonlyArray<{ value: Mode; label: string }> = [
    { value: "thisMonth", label: t.filters.thisMonth },
    { value: "last30", label: t.filters.last30 },
    { value: "allTime", label: t.filters.allTime },
    { value: "custom", label: t.filters.custom },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar — preset pills + (custom) range inputs. */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedToggle
          size="large"
          ariaLabel={t.filters.label}
          options={filterOptions}
          value={mode}
          onChange={onModeChange}
        />
        {mode === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              label={t.filters.from}
              value={customFrom}
              onChange={onCustomFrom}
              max={customTo || undefined}
            />
            <DateField
              label={t.filters.to}
              value={customTo}
              onChange={onCustomTo}
              min={customFrom || undefined}
            />
          </div>
        ) : null}
      </div>

      {/* Period totals — kept across load-more (server sends them once). */}
      {totals && rows && rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted">
            {t.summarySpent}:{" "}
            <span
              className="font-semibold text-foreground tabular-nums"
              dir="ltr"
            >
              {formatCredits(totals.spent)}
            </span>
          </span>
          <span className="text-muted">
            {t.summaryAdded}:{" "}
            <span
              className="font-semibold tabular-nums"
              dir="ltr"
              style={{ color: "var(--tq-status-ok-text)" }}
            >
              {formatCredits(totals.added)}
            </span>
          </span>
        </div>
      ) : null}

      {/* Statement — settings-row list inside a card (never a <table>). */}
      <div className="surface-card rounded-2xl p-5">
        {failed ? (
          <p className="text-sm text-muted">{t.loadFailed}</p>
        ) : rows === null ? (
          <p className="text-sm text-muted">{t.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <>
            {rows.map((row, i) => {
              const d = describeLedgerRow(row);
              const label =
                (t.events as Record<string, string>)[d.labelKey] ?? d.labelKey;
              const sign = row.delta < 0 ? "-" : "+";
              const amountColor =
                d.type === "added" ? "var(--tq-status-ok-text)" : undefined;
              return (
                <div
                  key={row.id}
                  className={`settings-row ${i === rows.length - 1 ? "border-b-0" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-overlay-soft text-foreground">
                      <AnimatedIcon name={d.icon} size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="settings-row-title truncate">
                        {label}
                        {row.slides ? (
                          <span className="font-normal text-muted">
                            {" "}
                            ·{" "}
                            {t.slidesSuffix.replace(
                              "{count}",
                              String(row.slides),
                            )}
                          </span>
                        ) : null}
                      </p>
                      <p className="settings-row-desc">
                        {format(new Date(row.at), "d MMMM yyyy", {
                          locale: dateFnsLocale(locale),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-xs text-muted">
                      {t.types[d.type]}
                    </span>
                    <span
                      className="text-sm font-semibold tabular-nums"
                      dir="ltr"
                      style={amountColor ? { color: amountColor } : undefined}
                    >
                      {sign}
                      {formatCredits(Math.abs(row.delta))}
                    </span>
                  </div>
                </div>
              );
            })}
            {nextCursor ? (
              <div className="flex justify-center pt-4">
                <button
                  type="button"
                  className="btn-pill px-4 py-1.5 text-xs"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? t.loading : t.loadMore}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
