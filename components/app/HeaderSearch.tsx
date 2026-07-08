"use client";

// Header project search with autocomplete dropdown.
//
// Typing fires a debounced GET to /api/projects/search; results
// render in a portal'd glass popover anchored to the input's
// bounding rect (top + left + width all match the input). Portal
// is non-negotiable: the header itself has ``,
// and a parent backdrop-filter creates a containing block that
// kills any child backdrop-filter — the dropdown's blur would
// render as nothing. createPortal moves the panel to <body> so
// it escapes that stacking context. Same pattern BellDropdown +
// BrandKitActionsMenu use.
//
// Surface = `.in-slide-popover` (rgba(12,12,12,0.45) tint + faint
// border) + `` + `backdrop-saturate`. Together
// these give the actual visible glass — `.surface-popover` alone is
// `background: transparent` and would render invisibly here.
//
// Keyboard: ↑/↓ move focus, Enter opens the focused (or first)
// result, Esc closes. Outside-click + blur also dismiss.

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 4;

type SearchProject = {
  id: string;
  title: string;
  thumbnailUrls: string[];
  format: string;
  createdAt: string; // ISO
};

// Format a date with Arabic month names + Latin digits per the
// "Latin numerals only" project rule. Same locale token the
// brand-kit tile uses for its date label.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ar-u-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type PanelBodyProps = {
  loading: boolean;
  results: SearchProject[];
  trimmed: string;
  activeIndex: number;
  listboxId: string;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  navigateTo: (project: SearchProject) => void;
};

function PanelBody({
  loading,
  results,
  trimmed,
  activeIndex,
  listboxId,
  setActiveIndex,
  navigateTo,
}: PanelBodyProps) {
  const dict = useDict();
  const { dir } = useLocale();
  if (loading && results.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-muted">
        <span
          className="material-symbols-outlined animate-spin"
          style={{ fontSize: 16 }}
          aria-hidden
        >
          progress_activity
        </span>
        {dict.components.search.searching}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted">
        {dict.components.search.noResults.replace("{query}", trimmed)}
      </div>
    );
  }

  return (
    <ul className="flex flex-col p-1.5" dir={dir}>
      {results.map((project, index) => (
        <ResultRow
          key={project.id}
          project={project}
          index={index}
          isActive={index === activeIndex}
          rowId={`${listboxId}-${project.id}`}
          onHover={setActiveIndex}
          onSelect={navigateTo}
        />
      ))}
    </ul>
  );
}

type ResultRowProps = {
  project: SearchProject;
  index: number;
  isActive: boolean;
  rowId: string;
  onHover: Dispatch<SetStateAction<number>>;
  onSelect: (project: SearchProject) => void;
};

function ResultRow({
  project,
  index,
  isActive,
  rowId,
  onHover,
  onSelect,
}: ResultRowProps) {
  const thumbnail = project.thumbnailUrls[0] ?? null;
  const thumbAspect =
    project.format === "9:16"
      ? "h-12 w-[27px]"
      : project.format === "3:4"
        ? "h-12 w-9"
        : "h-9 w-16";
  return (
    <li role="none">
      <button
        type="button"
        id={rowId}
        role="option"
        aria-selected={isActive}
        onMouseEnter={() => onHover(index)}
        // mousedown (not click) so the click fires BEFORE the
        // input's blur — otherwise the outside-click handler
        // closes the panel before the navigation runs.
        onMouseDown={(e) => {
          e.preventDefault();
          onSelect(project);
        }}
        className={`flex w-full items-center gap-3 rounded-xl p-2 text-end transition-colors ${
          isActive ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
        }`}
      >
        {/* Thumbnail — first slide if available, placeholder
            icon otherwise. Aspect mirrors the project's format
            so 9:16 decks don't get squished. */}
        <div
          className={`relative shrink-0 overflow-hidden rounded-md border border-foreground/[0.08] bg-foreground/[0.02] ${thumbAspect}`}
          aria-hidden
        >
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-foreground/30">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                image
              </span>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {project.title}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {formatDate(project.createdAt)}
          </p>
        </div>
      </button>
    </li>
  );
}

export function HeaderSearch({
  autoFocus = false,
  // `palette` (§24): command-palette layout — input + inline results + footer
  // hint rendered as one contiguous panel (used by the ⌘K overlay). The default
  // `input` variant is the bare field + portal'd dropdown (the legacy header).
  variant = "input",
}: {
  autoFocus?: boolean;
  variant?: "input" | "palette";
} = {}) {
  const dict = useDict();
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // `autoFocus` (§20): when the search field is opened from the sidebar
  // profile menu's "بحث" row it lives in a freshly-mounted overlay, so we
  // pull focus to the input on mount. Focusing fires the input's onFocus →
  // setOpen(true), so the results panel is primed once the user types.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Index of the currently-focused result. -1 = nothing focused
  // (Enter falls back to results[0]). Reset on every new fetch +
  // when the user types so arrow-keying always starts fresh.
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  // ─── Debounced fetch ──────────────────────────────────────────
  // Watching `trimmed` directly (not `query`) means leading /
  // trailing whitespace edits don't re-fire the network call.
  // The empty-query branch is handled at READ time via
  // `showDropdown` below, not by syncing setState here.
  useEffect(() => {
    if (!hasQuery) return;
    // The fetch + AbortController is the external subscription;
    // setState calls inside the async work bridge the response
    // back into React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch loading flag
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const body = (await res.json()) as { projects?: SearchProject[] };
        setResults(
          Array.isArray(body.projects)
            ? body.projects.slice(0, MAX_RESULTS)
            : [],
        );
        setActiveIndex(-1);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[header-search] fetch failed:", err);
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, hasQuery]);

  // ─── Outside-click + Esc ───────────────────────────────────────
  // The panel is portal'd to <body>, so `wrapperRef.contains` alone
  // would treat a click on a result row as "outside" and close the
  // dropdown before the row's onMouseDown can navigate. Stamp the
  // panel with `data-header-search-panel` and accept clicks inside
  // EITHER the wrapper (input + icon) OR the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest("[data-header-search-panel]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Whether the dropdown should render right now: input is focused
  // (open=true) AND there's a query the user has typed. Empty
  // query hides the panel entirely so we don't show "no results"
  // before the user even started.
  const showDropdown = open && hasQuery;

  // ─── Anchor rect for the portal'd dropdown ─────────────────────
  // The dropdown lives in document.body, so we need the input's
  // bounding rect to position + size it. Tracked as state so the
  // motion.div re-renders on resize / scroll. Same recipe
  // BrandKitActionsMenu uses for its 3-dots popover.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!showDropdown) return;
    const update = () => {
      const r = wrapperRef.current?.getBoundingClientRect();
      if (r) setAnchorRect(r);
    };
    update();
    window.addEventListener("resize", update);
    // capture: true so we catch scrolls in scrollable ancestors,
    // not just the window's own scroll.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showDropdown]);

  const navigateTo = useCallback(
    (project: SearchProject) => {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      router.push(`/project/${project.id}`);
    },
    [router],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0 && e.key !== "Enter") return;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? results.length - 1 : prev - 1,
        );
        break;
      }
      case "Enter": {
        e.preventDefault();
        const target =
          activeIndex >= 0 && activeIndex < results.length
            ? results[activeIndex]
            : results[0];
        if (target) navigateTo(target);
        break;
      }
    }
  };

  // ─── Palette variant ───────────────────────────────────────────
  // Command-palette layout: search row + inline results + footer hint, all in
  // one panel (the parent overlay supplies the surface/border). Matches the
  // shadcn command-dialog look the user referenced.
  if (variant === "palette") {
    return (
      <div ref={wrapperRef} className="flex flex-col">
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-[var(--tq-border-hairline)] px-4">
          <span
            className="material-symbols-outlined text-muted text-[20px]"
            aria-hidden
          >
            search
          </span>
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-foreground outline-none placeholder:text-muted"
            placeholder={dict.components.search.placeholder}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-expanded={hasQuery}
            aria-controls={hasQuery ? listboxId : undefined}
            aria-activedescendant={
              hasQuery && activeIndex >= 0
                ? `${listboxId}-${results[activeIndex]?.id ?? ""}`
                : undefined
            }
            role="combobox"
          />
        </div>
        {/* Results / empty state */}
        <div
          className="max-h-[52vh] overflow-y-auto hide-scrollbar"
          id={listboxId}
          role="listbox"
          aria-label={dict.components.search.resultsAria}
        >
          {hasQuery ? (
            <PanelBody
              loading={loading}
              results={results}
              trimmed={trimmed}
              activeIndex={activeIndex}
              listboxId={listboxId}
              setActiveIndex={setActiveIndex}
              navigateTo={navigateTo}
            />
          ) : (
            <p className="px-4 py-8 text-center text-xs text-muted">
              {dict.components.search.emptyHint}
            </p>
          )}
        </div>
        {/* Footer hint */}
        <div className="flex items-center gap-1.5 border-t border-[var(--tq-border-hairline)] px-4 py-2.5 text-[11px] text-muted">
          <kbd className="rounded border border-foreground/15 bg-foreground/[0.04] px-1.5 py-0.5 font-sans text-[10px] leading-none">
            ↵
          </kbd>
          <span>{dict.components.search.toOpen}</span>
          <kbd className="ms-3 rounded border border-foreground/15 bg-foreground/[0.04] px-1.5 py-0.5 font-sans text-[10px] leading-none">
            esc
          </kbd>
          <span>{dict.components.search.toClose}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <span className="material-symbols-outlined text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        search
      </span>
      <input
        ref={inputRef}
        className="input-search pr-10"
        placeholder={dict.components.search.placeholder}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && activeIndex >= 0
            ? `${listboxId}-${results[activeIndex]?.id ?? ""}`
            : undefined
        }
        role="combobox"
      />

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {showDropdown && anchorRect ? (
                <motion.div
                  // Portal'd so the dropdown escapes the header's
                  // `` stacking context (parent
                  // backdrop-filter kills child backdrop-filter).
                  // Pinned to the input's bounding rect: same left
                  // + same width, top sits 8 px below the bottom.
                  data-header-search-panel
                  className="in-slide-popover fixed z-[1100] overflow-hidden rounded-2xl"
                  style={{
                    top: anchorRect.bottom + 8,
                    left: anchorRect.left,
                    width: anchorRect.width,
                  }}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  role="listbox"
                  id={listboxId}
                  aria-label={dict.components.search.resultsAria}
                >
                  <PanelBody
                    loading={loading}
                    results={results}
                    trimmed={trimmed}
                    activeIndex={activeIndex}
                    listboxId={listboxId}
                    setActiveIndex={setActiveIndex}
                    navigateTo={navigateTo}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
