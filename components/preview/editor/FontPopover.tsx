"use client";

// I2.3 — the font-family picker. A search field over the FULL Google Fonts catalog
// (bundled, no API key) presented like a real type picker (Figma/Canva): each row
// previews the family in ITS OWN font, left-anchored for scannability, with an
// Arabic specimen on the trailing edge for Arabic-capable families so you can judge
// the شكل — the point of an Arabic-first tool. Picking applies + lazy-loads the
// face; "الخط الافتراضي" resets to the deck's theme font.
//
// Same glass recipe + motion as MorePopover: a child of the pill, animating scale+y
// only (never opacity — would suppress the backdrop-filter) and unmounting with the
// pill on outside-click.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  searchGoogleFonts,
  previewCss2Url,
  type GoogleFontEntry,
} from "@/lib/editor/font-search";

const WIDTH = 268;
// One shared <link> in the parent doc, reused across opens — swapped to the
// current result set so each visible row renders in its own font (the browser
// only downloads the woff2 for rows it actually paints).
const PREVIEW_LINK_ID = "tq-font-preview-link";
// A short Arabic specimen — distinct letterforms (initial/medial/final) so the
// family's Arabic shaping is legible at a glance.
const AR_SPECIMEN = "أبجد";

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

  // Section split: with no query the catalog is Arabic-first, so show عربية /
  // لاتينية headers. While searching, a flat ranked list reads better.
  const sectioned = query.trim() === "";
  const arabic = sectioned ? results.filter((r) => r.a === 1) : [];
  const latin = sectioned ? results.filter((r) => r.a === 0) : [];

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
      {/* Search — magnifier on the leading (right) edge. */}
      <div className="p-2.5 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            autoFocus
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن خط…"
            aria-label="ابحث عن خط"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] py-2 pr-8 pl-3 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/20"
          />
        </div>
      </div>

      <ul className="max-h-[316px] overflow-y-auto overscroll-contain pb-1.5">
        {/* Reset to the deck's theme font. */}
        <li>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              onClose();
            }}
            className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-[13px] transition-colors ${
              currentFamily === null
                ? "text-white"
                : "text-white/70 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            <span>الخط الافتراضي</span>
            {currentFamily === null ? <CheckIcon /> : null}
          </button>
        </li>

        {sectioned ? (
          <>
            {arabic.length ? <SectionLabel>عربية</SectionLabel> : null}
            {arabic.map((r) => (
              <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={onPick} onClose={onClose} />
            ))}
            {latin.length ? <SectionLabel>لاتينية</SectionLabel> : null}
            {latin.map((r) => (
              <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={onPick} onClose={onClose} />
            ))}
          </>
        ) : results.length ? (
          results.map((r) => (
            <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={onPick} onClose={onClose} />
          ))
        ) : (
          <li className="px-3.5 py-3 text-[12px] text-white/45">لا توجد نتائج</li>
        )}
      </ul>
    </motion.div>
  );
}

function isActive(current: string | null, family: string): boolean {
  return current?.toLowerCase() === family.toLowerCase();
}

// One catalog row. LTR-anchored (a list of Latin names scans best left-to-right):
// a leading check for the active font, the family name in ITS OWN font, and — for
// Arabic-capable families — an Arabic specimen on the trailing edge.
function FontRow({
  entry,
  active,
  onPick,
  onClose,
}: {
  entry: GoogleFontEntry;
  active: boolean;
  onPick: (family: string | null) => void;
  onClose: () => void;
}) {
  const stack = `"${entry.f}", sans-serif`;
  return (
    <li>
      <button
        type="button"
        dir="ltr"
        onClick={() => {
          onPick(entry.f);
          onClose();
        }}
        className={`flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left transition-colors ${
          active ? "bg-white/[0.08] text-white" : "text-white/85 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <span className="flex w-4 shrink-0 justify-center">{active ? <CheckIcon /> : null}</span>
        <span className="min-w-0 flex-1 truncate text-[16px] leading-tight" style={{ fontFamily: stack }}>
          {entry.f}
        </span>
        {entry.a === 1 ? (
          <span className="shrink-0 text-[16px] leading-tight text-white/45" dir="rtl" style={{ fontFamily: stack }}>
            {AR_SPECIMEN}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-3.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-white/35">
      {children}
    </li>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
