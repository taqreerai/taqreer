"use client";

// Admin > Compare: the original upload and the generated deck side by side.
// Enhance keeps one slide per source page, so each row lines up; Create and
// mimic do not, so there the two columns are simply read next to each other.
// Internal tool: English only, dark only (see the admin layout).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { localizedHref } from "@/lib/i18n/navigation";
import { SLIDE_DIMENSIONS, type SlideManifest } from "@/lib/schema/slide";

const CUID_RE = /[a-z0-9]{20,40}/i;

/** Paste a deck link or id. */
export function CompareLookup() {
  const { locale } = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");
  const id = value.match(CUID_RE)?.[0] ?? null;
  return (
    <form
      className="surface-card flex flex-col gap-3 rounded-xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (id) router.push(localizedHref(`/admin/compare/${id}`, locale));
      }}
    >
      <label htmlFor="compare-deck" className="text-sm font-semibold text-foreground">
        Deck link or id
      </label>
      <input
        id="compare-deck"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://taqreer.ai/en/project/..."
        className="rounded-lg border border-[var(--tq-border-hairline)] bg-transparent px-3 py-2 text-sm text-foreground"
        autoComplete="off"
      />
      <p className="text-xs text-muted">
        Shows the original upload next to the generated slides. Uploads are kept for 7 days, so older decks show the slides only.
      </p>
      <button type="submit" disabled={!id} className="btn-gradient self-start rounded-full px-4 py-2 text-sm font-medium disabled:opacity-40">
        Open comparison
      </button>
    </form>
  );
}

type SourceMeta =
  | { available: true; url: string; fileName: string; mime: string; uploadedAt: string; retentionDays: number }
  | { available: false; reason: "no-upload" | "purged"; uploadedAt?: string; retentionDays?: number };

type CompareProps = {
  projectId: string;
  title: string;
  flow: string;
  owner: string;
  plan: string | null;
  createdAt: string;
  model: string | null;
  jobStatus: string | null;
  lockedCount: number;
  manifest: SlideManifest | null;
};

/** A slide scaled to the width of its column. */
function FittedSlide({ manifest, index }: { manifest: SlideManifest; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dims = SLIDE_DIMENSIONS[manifest.format ?? "16:9"];
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = width > 0 ? width / dims.width : 0;
  return (
    <div ref={ref} style={{ aspectRatio: `${dims.width} / ${dims.height}` }} className="overflow-hidden rounded-lg">
      {scale > 0 ? (
        <SlideRenderer
          slide={manifest.slides[index]}
          theme={manifest.theme}
          direction={manifest.direction}
          language={manifest.language}
          width={dims.width}
          height={dims.height}
          scale={scale}
        />
      ) : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-lg border border-[var(--tq-border-hairline)] p-4 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function CompareClient(props: CompareProps) {
  const { projectId, title, flow, owner, plan, createdAt, model, jobStatus, lockedCount, manifest } = props;
  const { locale } = useLocale();
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [pages, setPages] = useState<string[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagesError, setPagesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/admin/projects/${projectId}/source`, { signal: controller.signal });
        const next = (await res.json()) as SourceMeta;
        setMeta(next);
        if (!next.available) return;
        const rendered = await fetch(`/api/admin/projects/${projectId}/source/pages`, { signal: controller.signal });
        const body = (await rendered.json()) as { pages?: string[]; total?: number; error?: string };
        if (!rendered.ok || !body.pages) {
          setPagesError(body.error ?? "Could not render this file.");
          return;
        }
        setPages(body.pages);
        setTotal(body.total ?? body.pages.length);
      } catch (err) {
        if (!controller.signal.aborted) setPagesError(err instanceof Error ? err.message : "Could not load the file.");
      }
    })();
    return () => controller.abort();
  }, [projectId]);

  const slideCount = manifest?.slides.length ?? 0;
  const rows = Math.max(pages?.length ?? 0, slideCount);
  const lineUp = flow === "enhance";

  const sourceNote = !meta
    ? "Loading the original..."
    : meta.available
      ? pagesError
        ? pagesError
        : pages
          ? null
          : "Rendering the original, this can take a minute..."
      : meta.reason === "no-upload"
        ? "No uploaded file found for this deck."
        : `The original is gone: uploads are deleted after ${meta.retentionDays ?? 7} days.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-foreground">{title}</h1>
          <p className="text-xs text-muted">
            {flow} · {owner} · {plan ?? "free"} · {model ?? "no model"} · {jobStatus ?? "no job"} ·{" "}
            <span suppressHydrationWarning>{new Date(createdAt).toLocaleString("en-GB")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta?.available ? (
            <a href={meta.url} className="btn-pill px-4 py-2 text-sm" title={meta.fileName}>
              Download original
            </a>
          ) : null}
          <Link href={localizedHref(`/project/${projectId}`, locale)} target="_blank" rel="noreferrer" className="btn-pill px-4 py-2 text-sm">
            Open deck
          </Link>
        </div>
      </div>

      {!lineUp && pages ? (
        <p className="text-xs text-muted">
          This flow does not keep one slide per page, so rows may not match.
        </p>
      ) : null}
      {total > (pages?.length ?? 0) ? (
        <p className="text-xs text-muted">Showing the first {pages?.length} of {total} pages.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <p className="text-sm font-semibold text-foreground">Original{pages ? ` (${total} pages)` : ""}</p>
        <p className="text-sm font-semibold text-foreground">
          Generated ({slideCount} slides{lockedCount > 0 ? `, ${lockedCount} still locked` : ""})
        </p>
      </div>

      {sourceNote && slideCount === 0 ? <Empty>{sourceNote}</Empty> : null}
      {!manifest ? <Empty>This deck has no readable slides.</Empty> : null}

      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-2 gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted">Page {i + 1}</span>
            {pages?.[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private page render, not a site image
              <img src={pages[i]} alt={`Original page ${i + 1}`} className="w-full rounded-lg" />
            ) : (
              <Empty>{pages ? "No page here" : (i === 0 ? sourceNote : null)}</Empty>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted">Slide {i + 1}</span>
            {manifest && i < slideCount ? <FittedSlide manifest={manifest} index={i} /> : <Empty>No slide here</Empty>}
          </div>
        </div>
      ))}
    </div>
  );
}
