"use client";

// Tabbed side-by-side screenshot comparison for "A vs B" pages
// (/gamma-arabic). One pair shows at a time; the other panels stay in the
// HTML (hidden) so their alt text and notes remain crawlable.

import { useId, useState } from "react";
import Image from "next/image";

type Pair = { title: string; note: string };

export function CompareSlideTabs({
  pairs,
  shots,
  labels,
  alt,
  notice,
}: {
  pairs: Pair[];
  /** Screenshot slug per pair: /compare/{taqreer|gamma}-{shot}.webp */
  shots: readonly string[];
  labels: { taqreer: string; gamma: string };
  /** Alt templates with a {title} placeholder. */
  alt: { taqreer: string; gamma: string };
  notice: string;
}) {
  const [active, setActive] = useState(0);
  const baseId = useId();

  return (
    <div>
      <div
        role="tablist"
        className="design-tabs compare-tabs mx-auto mb-6 max-w-xl"
        style={{ "--tab-count": pairs.length } as React.CSSProperties}
      >
        {pairs.map((pair, i) => (
          <button
            key={shots[i]}
            id={`${baseId}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls={`${baseId}-panel-${i}`}
            onClick={() => setActive(i)}
            className={`design-tab ${active === i ? "is-active" : ""}`}
          >
            {pair.title}
          </button>
        ))}
      </div>

      {pairs.map((pair, i) => (
        <div
          key={shots[i]}
          id={`${baseId}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={active !== i}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(["taqreer", "gamma"] as const).map((tool) => (
              <figure
                key={tool}
                className={`m-0 rounded-[18px] p-3 ${
                  tool === "taqreer" ? "compare-pick" : "surface-card"
                }`}
              >
                <figcaption className="mb-3 flex items-center gap-1.5 px-1 text-sm font-semibold">
                  {tool === "taqreer" ? (
                    <>
                      <span
                        className="material-symbols-outlined text-[18px] leading-none text-[var(--tq-violet)]"
                        aria-hidden
                      >
                        check_circle
                      </span>
                      <span className="text-[var(--tq-violet)]">{labels.taqreer}</span>
                    </>
                  ) : (
                    <span className="text-muted">{labels.gamma}</span>
                  )}
                </figcaption>
                <Image
                  src={`/compare/${tool}-${shots[i]}.webp`}
                  alt={alt[tool].replace("{title}", pair.title)}
                  width={1280}
                  height={720}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="h-auto w-full rounded-[10px] border border-[var(--tq-border-hairline)]"
                />
              </figure>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-center text-[15px] leading-7 text-muted">
            <span className="font-semibold text-foreground">{notice}</span> {pair.note}
          </p>
        </div>
      ))}
    </div>
  );
}
