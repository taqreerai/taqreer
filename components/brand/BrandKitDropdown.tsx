"use client";

// BrandKitDropdown — pick a saved brand kit from the card title row
// (flow-card redesign), without leaving the page. Shows the last 5 kits
// as titles; selecting one tells the parent to overwrite the card's
// colours / fonts / logo (parent reuses the existing seed-from-brand-kit
// path). Presentational: the parent fetches the kits and passes them in.

import { useEffect, useRef, useState } from "react";

export type BrandKitOption = { id: string; name: string };

export function BrandKitDropdown({
  kits,
  onSelect,
  disabled = false,
}: {
  // Already trimmed to the last 5 by the caller (orderBy updatedAt desc).
  kits: BrandKitOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // No saved kits → render nothing (the title row stays clean).
  if (kits.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={` flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-white/40" : "border-white/15 hover:border-white/30"
        }`}
        style={{ background: "rgba(255, 255, 255, var(--glass-opacity))" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
          bookmark
        </span>
        <span>هوية محفوظة</span>
        <span
          className={`material-symbols-outlined transition-transform ${
            open ? "rotate-180" : ""
          }`}
          style={{ fontSize: 13 }}
        >
          expand_more
        </span>
      </button>
      {open ? (
        <div
          className="absolute end-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-xl border p-1 bg-[var(--tq-surface)] border-[var(--tq-border-glass)]"
          role="listbox"
          aria-label="الهويات المحفوظة"
        >
          {kits.map((kit) => (
            <button
              key={kit.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onSelect(kit.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-start text-sm text-white/80 transition-colors hover:bg-white/5 hover:text-white"
            >
              <span
                className="material-symbols-outlined text-white/50"
                style={{ fontSize: 15 }}
              >
                palette
              </span>
              <span className="truncate">{kit.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
