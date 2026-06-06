"use client";

// I2.3 — the font-family picker. A search field over the FULL Google Fonts catalog
// (bundled, no API key) where every result row previews in its own font. Arabic-
// capable families sort first (Arabic deck tool). Picking applies the family +
// loads it; "الخط الافتراضي" resets the element to the deck's theme font.
//
// Same glass recipe + motion as MorePopover/ColorPickerPopover: a child of the
// pill, so it animates scale+y only (never opacity — that would suppress the
// backdrop-filter mid-fade) and unmounts with the pill on outside-click.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { searchGoogleFonts, previewCss2Url } from "@/lib/editor/font-search";

const WIDTH = 248;
// One shared <link> in the parent doc, reused across opens — swapped to the
// current result set so each visible row renders in its own font (the browser
// only downloads the woff2 for rows it actually paints).
const PREVIEW_LINK_ID = "tq-font-preview-link";

export function FontPopover({
  open,
  currentFamily,
  flipUp = false,
  onPick,
  onClose,
}: {
  open: boolean;
  // The element's current catalog family, or null when it's the theme/default.
  currentFamily: string | null;
  flipUp?: boolean;
  onPick: (family: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchGoogleFonts(query, { limit: 60 }), [query]);

  // Esc closes. Outside-click is owned by the pill (clicking out deselects the
  // element, unmounting the pill + this popover together).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Batch-load the result set's default weight (one css2 request) so previews
  // render. The browser lazily fetches only the woff2 for visible rows.
  useEffect(() => {
    if (!open || results.length === 0) return;
    let link = document.getElementById(PREVIEW_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = PREVIEW_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = previewCss2Url(results.map((r) => r.f));
  }, [open, results]);

  if (!open) return null;
  return (
    <motion.div
      dir="rtl"
      className={`glass-popover backdrop-blur-glass-boost backdrop-saturate-(--glass-saturation) absolute z-30 overflow-hidden rounded-2xl shadow-2xl ${
        flipUp ? "bottom-full mb-3.5" : "top-full mt-3.5"
      }`}
      style={{ left: 0, width: WIDTH }}
      initial={{ scale: 0.96, y: flipUp ? 4 : -4 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="border-b border-white/[0.08] p-2.5">
        <input
          autoFocus
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن خط…"
          aria-label="ابحث عن خط"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/20"
        />
      </div>
      <ul className="max-h-[300px] overflow-y-auto overscroll-contain py-1">
        <Row
          label="الخط الافتراضي"
          family={null}
          active={currentFamily === null}
          onClick={() => {
            onPick(null);
            onClose();
          }}
        />
        {results.map((r) => (
          <Row
            key={r.f}
            label={r.f}
            family={r.f}
            arabic={r.a === 1}
            active={currentFamily?.toLowerCase() === r.f.toLowerCase()}
            onClick={() => {
              onPick(r.f);
              onClose();
            }}
          />
        ))}
        {results.length === 0 ? (
          <li className="px-3 py-3 text-[12px] text-white/45">لا توجد نتائج</li>
        ) : null}
      </ul>
    </motion.div>
  );
}

function Row({
  label,
  family,
  arabic = false,
  active,
  onClick,
}: {
  label: string;
  family: string | null;
  arabic?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start transition-colors ${
          active ? "bg-white/[0.08] text-white" : "text-white/80 hover:bg-white/[0.04] hover:text-white"
        }`}
        // Preview the row in its own font (default weight from the batch <link>).
        style={family ? { fontFamily: `"${family}", sans-serif` } : undefined}
      >
        <span className="truncate text-[14px]" dir="ltr">
          {label}
        </span>
        {arabic ? (
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[9px] leading-none text-white/50"
            style={{ background: "var(--tq-bg-glass)" }}
          >
            ع
          </span>
        ) : null}
      </button>
    </li>
  );
}
