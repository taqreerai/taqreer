"use client";

// Admin > Decks (client). Read-only list of the most recent completed decks
// across all users, fed by the server page. Client-side search / filters /
// pagination over the fixed 50-row window. Rows open the normal viewer in a
// new tab (admin has a view-only bypass in resolveProjectAccess).
// English-only, dark-only, LTR.

import { useState } from "react";
import Link from "next/link";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { formatRelativeTime } from "@/lib/util/relative-time";
import { localizedHref } from "@/lib/i18n/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { DECK_FLOW_LABEL, type DeckFlow } from "@/lib/project/flow";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

export type AdminDeck = {
  id: string;
  title: string;
  type: DeckFlow;
  language: "ar" | "en";
  format: string;
  tone: string | null;
  slideCount: number | null;
  thumbnail: string | null;
  createdAt: string; // ISO
  userName: string;
  userEmail: string;
};

type LangFilter = "all" | "ar" | "en";
type TypeFilter = "all" | DeckFlow;

const PAGE_SIZE = 10;

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: PRIMARY, background: "var(--tq-overlay-soft)" }}
    >
      {children}
    </span>
  );
}

export function DecksClient({ initialDecks }: { initialDecks: AdminDeck[] }) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1); // 1-based

  const filtered = initialDecks.filter((d) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      d.title.toLowerCase().includes(q) ||
      d.userName.toLowerCase().includes(q) ||
      d.userEmail.toLowerCase().includes(q);
    const matchesLang = langFilter === "all" || d.language === langFilter;
    const matchesType = typeFilter === "all" || d.type === typeFilter;
    return matchesQuery && matchesLang && matchesType;
  });

  // Clamp instead of an effect-reset so a filter that shrinks the result set
  // while on a late page never renders a blank page (set-state-in-effect is
  // a lint error in this repo).
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 220 }}>
          <span
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
            placeholder="Search title, user, or email"
            className="h-10 w-full rounded-full ps-10 pe-4 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        <select
          value={langFilter}
          onChange={(e) => {
            setLangFilter(e.target.value as LangFilter);
            setPage(1);
          }}
          className="h-10 rounded-full px-4 text-sm outline-none"
          style={inputStyle}
        >
          <option value="all">All languages</option>
          <option value="ar">Arabic</option>
          <option value="en">English</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as TypeFilter);
            setPage(1);
          }}
          className="h-10 rounded-full px-4 text-sm outline-none"
          style={inputStyle}
        >
          <option value="all">All types</option>
          <option value="create">Create</option>
          <option value="enhance">Enhance</option>
          <option value="mimic">Mimic</option>
          <option value="datasheet">Datasheet</option>
          <option value="social">Social</option>
        </select>
      </div>

      {/* List */}
      <div className="surface-card rounded-xl px-4">
        {pageRows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: MUTED }}>
            No decks match these filters.
          </p>
        ) : (
          pageRows.map((d, i) => (
            <Link
              key={d.id}
              href={localizedHref(`/project/${d.id}`, locale)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 py-3"
              style={{
                borderBottom:
                  i === pageRows.length - 1
                    ? "none"
                    : "1px solid var(--tq-border-hairline)",
              }}
            >
              {/* Cover thumb (per-slide thumbs only exist after Save) */}
              {d.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.thumbnail}
                  alt=""
                  className="h-12 w-[85px] flex-shrink-0 rounded-md object-cover"
                  style={{ background: "var(--tq-overlay-soft)" }}
                />
              ) : (
                <span
                  className="grid h-12 w-[85px] flex-shrink-0 place-items-center rounded-md"
                  style={{ background: "var(--tq-overlay-soft)" }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: MUTED }}
                  >
                    imagesmode
                  </span>
                </span>
              )}

              <div className="min-w-0 flex-1">
                {/* dir="auto" keeps Arabic titles reading + truncating from the
                    correct end; inline-block shrink-wraps the box so the title
                    still anchors LEFT with the rest of the LTR row instead of
                    jumping to the far right edge. */}
                <div
                  className="inline-block max-w-full truncate align-bottom text-sm font-medium"
                  style={{ color: PRIMARY }}
                  dir="auto"
                >
                  {d.title}
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                  <span
                    className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold"
                    style={{ background: avatarGradientForSeed(d.userEmail), color: "#fff" }}
                  >
                    {d.userName.charAt(0)}
                  </span>
                  <span className="truncate">
                    {d.userName} · {d.userEmail}
                  </span>
                </div>
              </div>

              <div className="hidden flex-shrink-0 items-center gap-1 sm:flex">
                <Badge>{d.language === "ar" ? "AR" : "EN"}</Badge>
                <Badge>{DECK_FLOW_LABEL[d.type] ?? "Create"}</Badge>
              </div>

              <div className="hidden w-16 flex-shrink-0 text-end md:block">
                <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                  {d.slideCount ?? "-"}
                </div>
                <div className="text-xs" style={{ color: MUTED }}>
                  slides
                </div>
              </div>

              <div
                className="hidden w-24 flex-shrink-0 text-end text-xs md:block"
                style={{ color: MUTED }}
              >
                <span suppressHydrationWarning>
                  {formatRelativeTime(d.createdAt, "en")}
                </span>
              </div>

              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{ fontSize: 18, color: MUTED }}
              >
                open_in_new
              </span>
            </Link>
          ))
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
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
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
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              chevron_right
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
