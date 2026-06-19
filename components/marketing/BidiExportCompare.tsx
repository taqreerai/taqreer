"use client";

// ─── Arabic BiDi export demos (/arabic-presentations) ─────────────────────────
// The product's core differentiator, shown the same way as the landing BiDi band
// (BidiExtractionDemo) but WITHOUT the extraction flow-lines/dots stream: one
// slide window per failure mode, each with its OWN toggle that "fixes" that
// issue. Flip the toggle and the tokens reflow (framer `layout` spring) from the
// broken order into correct RTL, and the affected run (40%, 2026, taqreer.ai, ؟)
// lights up violet.
//
// Faithful, not faked: the SAME logical-order tokens render with dir=ltr (broken)
// or dir=rtl (fixed) — the browser's BiDi with the base direction flipped is
// exactly what PowerPoint's resolver does WITHOUT rtlCol / pPr rtl / rPr
// lang=ar-SA. The `run` token is the neutral/number/Latin run whose placement
// jumps; the violet pill just lets the eye track it.
//
// Tokens only, no section panels (flat like the landing). Slide chrome is always
// RTL (an Arabic slide); only the BODY direction is what's broken or fixed.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { InlineSwitch } from "@/components/marketing/BidiSection";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { useDict } from "@/components/i18n/LocaleProvider";

// One token list per fix, index-matched to dict.arabicPresentations.compare.modes.
// Logical (reading) order; `run` flags the run that visibly jumps. Subject matter
// stays Arabic in both locales (like BidiExtractionDemo). Tashkeel-free, Latin
// numerals.
const FIXES: { t: string; run?: boolean }[][] = [
  [{ t: "ملخص" }, { t: "العرض" }, { t: "التقديمي" }],
  [
    { t: "نمو" },
    { t: "الإيرادات" },
    { t: "بنسبة" },
    { t: "40%", run: true },
    { t: "خلال" },
    { t: "2026", run: true },
  ],
  [{ t: "نستخدم" }, { t: "taqreer.ai", run: true }, { t: "لتصميم" }, { t: "العروض" }],
  [
    { t: "هل" },
    { t: "أنت" },
    { t: "جاهز" },
    { t: "لعرض" },
    { t: "النتائج" },
    { t: "؟", run: true },
  ],
];

type CompareLabels = { tryIt: string; windowTitle: string; slideHeader: string };

export function BidiExportCompare() {
  const dict = useDict();
  const c = dict.arabicPresentations.compare;
  const labels: CompareLabels = {
    tryIt: c.tryIt,
    windowTitle: c.windowTitle,
    slideHeader: c.slideHeader,
  };
  return (
    <div className="flex flex-col gap-16 lg:gap-24">
      {c.modes.map((mode, i) => (
        <FixRow
          key={i}
          index={i}
          name={mode.name}
          desc={mode.desc}
          tokens={FIXES[i] ?? FIXES[0]}
          labels={labels}
        />
      ))}
    </div>
  );
}

function FixRow({
  index,
  name,
  desc,
  tokens,
  labels,
}: {
  index: number;
  name: string;
  desc: string;
  tokens: { t: string; run?: boolean }[];
  labels: CompareLabels;
}) {
  const [fixed, setFixed] = useState(false);
  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
      {/* Text + toggle — reading-start column (right in RTL). */}
      <ScrollReveal direction="up" className="order-1">
        <span className="mb-3 block text-sm font-semibold tabular-nums text-[var(--tq-violet)]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="mb-3 text-center text-2xl font-medium md:text-3xl lg:text-start">
          {name}
        </h3>
        <p className="mx-auto mb-6 max-w-md text-center text-base leading-relaxed text-muted lg:mx-0 lg:text-start">
          {desc}
        </p>
        {/* Inline label + knob switch, mirroring the landing BiDi heading: the
            switch is em-based with vertical-align:middle, so it centers on the
            text the way it does in the heading. (A flex items-center row
            mis-centered it against Cairo's low glyph box on mobile.) The em
            size comes from the container's text-[30px]; the label overrides to
            text-sm and also rides vertical-align:middle, so the two share a
            center. */}
        <div className="text-center text-[30px] leading-none lg:text-start">
          <span className="align-middle text-sm font-medium text-foreground/65">
            {labels.tryIt}
          </span>{" "}
          <InlineSwitch on={fixed} onToggle={() => setFixed((f) => !f)} ariaLabel={name} />
        </div>
      </ScrollReveal>

      {/* Demo window — reading-end column (left in RTL). */}
      <ScrollReveal direction="up" delay={0.06} className="order-2">
        <SlideWindow fixed={fixed} tokens={tokens} labels={labels} />
      </ScrollReveal>
    </div>
  );
}

function SlideWindow({
  fixed,
  tokens,
  labels,
}: {
  fixed: boolean;
  tokens: { t: string; run?: boolean }[];
  labels: CompareLabels;
}) {
  return (
    // dir=ltr so the window chrome (traffic lights left) reads LTR while the slide
    // content stays RTL. No shadow, matching the landing demo.
    <div
      dir="ltr"
      className="mx-auto w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--tq-border-hairline)] bg-[var(--tq-card)]"
    >
      <TitleBar title={labels.windowTitle} />

      <div className="relative aspect-video w-full overflow-hidden">
        <div className="relative flex h-full flex-col p-6" dir="rtl">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1.5 rounded-full bg-[var(--tq-violet)]" />
            <span className="text-[14px] font-semibold text-foreground/90">
              {labels.slideHeader}
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center">
            <Sentence fixed={fixed} tokens={tokens} />
          </div>

          <div className="text-end text-[11px] font-medium tracking-wide text-foreground/45">
            01 / 12
          </div>
        </div>

        {/* Soft scan-line sweep on each toggle — same feedback as the landing
            demo (this is the sweep, not the removed flow-lines/dots). */}
        <AnimatePresence>
          <motion.div
            key={fixed ? "f" : "w"}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/2"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(var(--tq-violet-rgb),0.12), transparent)",
            }}
            initial={{ x: "-160%", opacity: 0 }}
            animate={{ x: "300%", opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.2, ease: "easeInOut", opacity: { times: [0, 0.2, 0.7, 1] } }}
          />
        </AnimatePresence>
      </div>
    </div>
  );
}

function Sentence({ fixed, tokens }: { fixed: boolean; tokens: { t: string; run?: boolean }[] }) {
  return (
    // Same logical-order tokens both ways; dir=rtl (fixed) lays them out
    // correctly, dir=ltr shows the broken order. framer `layout` springs each
    // token to its new position when the direction flips.
    <div
      dir={fixed ? "rtl" : "ltr"}
      className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2"
    >
      {tokens.map((tok, i) => (
        <motion.span
          key={i}
          layout
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="whitespace-nowrap rounded-lg px-1 py-0.5 text-[16px] leading-snug font-semibold sm:px-2 sm:text-[22px]"
          style={
            tok.run
              ? {
                  color: fixed ? "var(--tq-violet)" : "var(--tq-text-muted)",
                  background: fixed ? "rgba(var(--tq-violet-rgb),0.14)" : "transparent",
                  // Flip-aware hairline (the landing demo's white-alpha dashed
                  // border is dark-only); visible in light + dark.
                  border: fixed
                    ? "1px solid rgba(var(--tq-violet-rgb),0.4)"
                    : "1px dashed var(--tq-border-hairline)",
                }
              : { color: "var(--tq-text-primary)", border: "1px solid transparent" }
          }
        >
          {tok.t}
        </motion.span>
      ))}
    </div>
  );
}

function TitleBar({ title }: { title: string }) {
  return (
    <div className="relative flex h-11 items-center border-b border-[var(--tq-border-hairline)] bg-[var(--tq-card)] px-4">
      {/* macOS traffic lights (universal OS chrome colors, like the landing demo). */}
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
      </div>
      <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium text-[var(--tq-text-muted)]">
        {title}
      </span>
      <div className="ml-auto flex items-center gap-3 text-foreground/25">
        <Glyph d="M4 12h16M4 6h16M4 18h16" />
        <Glyph d="M12 5v14M5 12h14" />
      </div>
    </div>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
