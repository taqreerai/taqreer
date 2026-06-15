"use client";

// Branded date field + calendar popover, used in place of the OS-native
// `<input type="date">`. Same rationale as ColorPickerPopover: the native
// picker opens its own window that ignores our chrome, varies per-OS, and
// is English-only. This gives one visual vocabulary (.surface-menu +
// tokens, the account-menu dropdown recipe — its hairline flips with the
// theme, unlike .surface-popover whose white border vanishes in light),
// localized month / weekday names + Clear / Today buttons, and
// full RTL/LTR awareness (the grid flows with the chrome dir, the month
// arrows mirror). Numbers stay Latin (day cells use getDate(), the header
// uses date-fns which already renders Latin digits for ar).
//
// Contract: `value` is a "YYYY-MM-DD" string ("" = unset); `onChange`
// emits the same. `min` / `max` (also "YYYY-MM-DD") bound the selectable
// days so a range's start can't pass its end. The field is generic — the
// consumer passes the role label ("From" / "To") so start vs end is clear.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  isSameDay,
  isSameMonth,
  isToday,
  isAfter,
  isBefore,
} from "date-fns";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { dateFnsLocale } from "@/lib/i18n/date";

// Local-midnight parse/format so a "YYYY-MM-DD" never drifts a day across
// time zones (new Date("2026-06-12") would parse as UTC midnight).
export function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDateInput(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function Calendar({
  value,
  min,
  max,
  onPick,
  onClear,
  onToday,
}: {
  value: Date | null;
  min: Date | null;
  max: Date | null;
  onPick: (day: Date) => void;
  onClear: () => void;
  onToday: () => void;
}) {
  const { dir, locale } = useLocale();
  const dict = useDict();
  const t = dict.components.calendar;
  const dfLocale = dateFnsLocale(locale);

  // Re-mounted on every open (the popover only renders the calendar while
  // open), so this initializer lands on the selected month or today each
  // time — no rehydrate effect needed.
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(value ?? new Date()),
  );

  const weekStart = startOfWeek(viewMonth, { locale: dfLocale });
  const weekdays = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(weekStart, { locale: dfLocale }),
  });
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewMonth), { locale: dfLocale }),
    end: endOfWeek(endOfMonth(viewMonth), { locale: dfLocale }),
  });

  const isDisabled = (day: Date) =>
    (min ? isBefore(day, min) : false) || (max ? isAfter(day, max) : false);

  return (
    <div dir={dir}>
      {/* Month + nav */}
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-sm font-semibold text-foreground">
          {format(viewMonth, "MMMM yyyy", { locale: dfLocale })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-icon"
            aria-label={t.prevMonth}
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
              aria-hidden
            >
              {dir === "rtl" ? "chevron_right" : "chevron_left"}
            </span>
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label={t.nextMonth}
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
              aria-hidden
            >
              {dir === "rtl" ? "chevron_left" : "chevron_right"}
            </span>
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 px-1">
        {weekdays.map((d) => (
          <span
            key={d.toISOString()}
            className="py-1 text-center text-[11px] text-muted"
          >
            {format(d, "EEEEEE", { locale: dfLocale })}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1 p-1">
        {days.map((day) => {
          const selected = value ? isSameDay(day, value) : false;
          const outside = !isSameMonth(day, viewMonth);
          const today = isToday(day);
          const disabled = isDisabled(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              aria-label={format(day, "d MMMM yyyy", { locale: dfLocale })}
              aria-current={selected ? "date" : undefined}
              onClick={() => onPick(day)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors ${
                selected
                  ? "text-white"
                  : outside
                    ? "text-muted/50"
                    : "text-foreground"
              } ${!selected && !disabled ? "hover:bg-overlay-soft" : ""} ${
                today && !selected
                  ? "ring-1 ring-[var(--tq-border-focus)]"
                  : ""
              } ${disabled ? "cursor-default opacity-30" : ""}`}
              style={selected ? { backgroundColor: "var(--tq-purple)" } : undefined}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {/* Clear / Today */}
      <div className="mt-1 flex items-center justify-between border-t border-[var(--tq-border-hairline)] px-2 pt-2">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted transition-colors hover:text-foreground"
        >
          {t.clear}
        </button>
        <button
          type="button"
          onClick={onToday}
          className="text-xs font-medium"
          style={{ color: "var(--tq-purple)" }}
        >
          {t.today}
        </button>
      </div>
    </div>
  );
}

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  // Role label shown in the trigger so start vs end is unambiguous.
  label: string;
  value: string; // "YYYY-MM-DD" or ""
  onChange: (next: string) => void;
  min?: string;
  max?: string;
}) {
  const { dir, locale } = useLocale();
  const dict = useDict();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = parseDateInput(value);

  // Outside-click + ESC close (mousedown so the field also blurs).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Physical start edge from the chrome dir so the popover anchors to the
  // field's start in both directions.
  const startEdge = dir === "rtl" ? "right" : "left";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-[var(--tq-border-hairline)] bg-overlay-soft text-sm transition-colors hover:border-[var(--tq-border-focus)]"
        style={{ padding: "8px 14px" }}
      >
        <span
          className="material-symbols-outlined text-muted"
          style={{ fontSize: 16 }}
          aria-hidden
        >
          calendar_today
        </span>
        <span className="text-muted">{label}</span>
        <span className={selected ? "text-foreground" : "text-muted/60"}>
          {selected
            ? format(selected, "d MMM yyyy", { locale: dateFnsLocale(locale) })
            : dict.components.calendar.pick}
        </span>
        <span
          className="material-symbols-outlined text-muted"
          style={{ fontSize: 16 }}
          aria-hidden
        >
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-label={label}
            className="surface-menu absolute top-full z-30 mt-2 rounded-2xl p-2"
            style={{ [startEdge]: 0, width: 280 }}
            initial={{ scale: 0.96, y: -4 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <Calendar
              value={selected}
              min={parseDateInput(min ?? "")}
              max={parseDateInput(max ?? "")}
              onPick={(day) => {
                onChange(formatDateInput(day));
                setOpen(false);
              }}
              onClear={() => {
                onChange("");
                setOpen(false);
              }}
              onToday={() => {
                onChange(formatDateInput(new Date()));
                setOpen(false);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
