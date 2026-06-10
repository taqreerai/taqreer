"use client";

// I2.3 — the font-family control on the style pill. A pill that shows the SELECTED
// element's current font name; clicking it morphs the pill ITSELF into a search
// field (width springs open), revealing the full Google Fonts catalog (Arabic-
// first, each row previewing in its own font + an Arabic specimen). Picking a font
// collapses the pill back to fit the new name — all on the 500/35 spring.
//
// Results dropdown uses the glass recipe + animates scale+y ONLY (never opacity —
// that suppresses the backdrop-filter mid-fade).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  searchGoogleFonts,
  previewCss2Url,
  type GoogleFontEntry,
} from "@/lib/editor/font-search";

const WIDTH = 252;
const PREVIEW_LINK_ID = "tq-font-preview-link";
const AR_SPECIMEN = "أبجد";
const SPRING = { type: "spring", stiffness: 500, damping: 34 } as const;

export function FontControl({
  open,
  onOpenChange,
  currentFamily,
  label,
  flipUp = false,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The element's current catalog family (inline), or null for the theme default.
  currentFamily: string | null;
  // The name shown on the collapsed pill — the element's actually-rendered font.
  label: string;
  flipUp?: boolean;
  onPick: (family: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchGoogleFonts(query, { limit: 60 }), [query]);

  // Width morph: animate the pill's REAL width (collapsed name-fit ⇄ search width)
  // rather than a framer `layout` transform — `layout` snaps the box to its final
  // size at once, so the rest of the toolbar jumps; animating the width makes the
  // flex row reflow every frame, so the siblings glide along. Measure the collapsed
  // name button so we have a concrete value to spring from.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [collapsedW, setCollapsedW] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (open) return;
    const w = btnRef.current?.offsetWidth;
    if (w) setCollapsedW(w);
  }, [open, label]);
  // The very first width (max-content → the measured integer) must SNAP in, not
  // spring — otherwise the pill visibly shrinks a hair as it appears. Spring only
  // kicks in for open/close after that first application has painted.
  const [widthInited, setWidthInited] = useState(false);
  useEffect(() => {
    if (collapsedW == null || widthInited) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidthInited(true);
  }, [collapsedW, widthInited]);

  // Fresh query + autofocus the field each time it opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc collapses. (Outside-click closes the whole pill via the parent.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Batch-load the result set's default weight (one css2 request) for previews.
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

  const pick = (family: string | null) => {
    onPick(family);
    onOpenChange(false);
  };

  const sectioned = query.trim() === "";
  const arabic = sectioned ? results.filter((r) => r.a === 1) : [];
  const latin = sectioned ? results.filter((r) => r.a === 0) : [];

  return (
    <div style={{ position: "relative" }}>
      {/* The morphing pill: its REAL width springs between the name-fit and the
          search width (overflow-hidden clips the content mid-morph), so the rest
          of the toolbar reflows smoothly alongside it. */}
      <motion.div
        className="flex h-8 items-center overflow-hidden rounded-full"
        style={{
          background: "var(--tq-surface)",
          border: "1px solid var(--tq-border-hairline)",
          width: collapsedW == null ? "max-content" : undefined,
        }}
        animate={collapsedW == null ? undefined : { width: open ? WIDTH : collapsedW }}
        transition={widthInited ? SPRING : { duration: 0 }}
      >
        {open ? (
          <div dir="rtl" className="flex items-center gap-1.5 px-2.5" style={{ width: WIDTH }}>
            <SearchIcon className="shrink-0 text-white/40" />
            <input
              ref={inputRef}
              dir="rtl"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن خط…"
              aria-label="ابحث عن خط"
              className="min-w-0 flex-1 bg-transparent text-right text-[13px] text-white outline-none placeholder:text-white/40"
            />
          </div>
        ) : (
          <button
            ref={btnRef}
            type="button"
            aria-label={`Font family: ${label}`}
            onClick={() => onOpenChange(true)}
            className="flex h-full items-center gap-1 whitespace-nowrap px-2.5 text-[12px] text-white/85 transition-colors hover:text-white"
          >
            <span className="max-w-[124px] truncate" dir="ltr">
              {label}
            </span>
            <Chevron />
          </button>
        )}
      </motion.div>

      {/* Results dropdown — opens on the opposite side from the element (flipUp). */}
      {open ? (
        <motion.div
          dir="rtl"
          className={`surface-popover absolute z-30 overflow-hidden rounded-2xl ${
            flipUp ? "bottom-full mb-2.5" : "top-full mt-2.5"
          }`}
          style={{ left: 0, width: WIDTH }}
          initial={{ scale: 0.96, y: flipUp ? 4 : -4 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          <ul className="max-h-[300px] overflow-y-auto overscroll-contain py-1.5">
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
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
                  <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={pick} />
                ))}
                {latin.length ? <SectionLabel>لاتينية</SectionLabel> : null}
                {latin.map((r) => (
                  <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={pick} />
                ))}
              </>
            ) : results.length ? (
              results.map((r) => (
                <FontRow key={r.f} entry={r} active={isActive(currentFamily, r.f)} onPick={pick} />
              ))
            ) : (
              <li className="px-3.5 py-3 text-[12px] text-white/45">لا توجد نتائج</li>
            )}
          </ul>
        </motion.div>
      ) : null}
    </div>
  );
}

function isActive(current: string | null, family: string): boolean {
  return current?.toLowerCase() === family.toLowerCase();
}

// One catalog row. LTR-anchored (Latin names scan best left→right): a leading check
// for the active font, the family name in ITS OWN font, and — for Arabic-capable
// families — an Arabic specimen on the trailing edge.
function FontRow({
  entry,
  active,
  onPick,
}: {
  entry: GoogleFontEntry;
  active: boolean;
  onPick: (family: string | null) => void;
}) {
  const stack = `"${entry.f}", sans-serif`;
  return (
    <li>
      <button
        type="button"
        dir="ltr"
        onClick={() => onPick(entry.f)}
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

function Chevron() {
  return (
    <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 1l4 4 4-4" />
    </svg>
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
