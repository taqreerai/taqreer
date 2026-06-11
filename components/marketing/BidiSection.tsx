"use client";

// BiDi feature band — asymmetric (RTL): a single big title on the RIGHT with an
// inline on/off switch wired INTO the heading (Laravel "AI-enabled ⬤ framework"
// style), and the controlled BiDi demo on the LEFT. Flipping the switch drives
// the demo's extraction fix and reveals a one-line subtitle. Direction-aware
// reveals: the right title slides in from the right, the left demo from the left.

import { useState } from "react";
import { motion } from "framer-motion";
import { BidiExtractionDemo } from "@/components/marketing/BidiExtractionDemo";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function BidiSection() {
  const [fixed, setFixed] = useState(false);
  const dict = useDict();
  const { dir } = useLocale();
  const b = dict.landing.bidi;
  return (
    <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12">
      {/* Title — order-1 = the reading-start column (right in RTL, left in LTR). */}
      <ScrollReveal direction="right" className="order-1 lg:col-span-5">
        <h2 className="text-balance text-4xl font-medium leading-tight md:text-5xl">
          {b.headingPre}{" "}
          <InlineSwitch on={fixed} onToggle={() => setFixed((f) => !f)} ariaLabel={b.toggleAria} />{" "}
          {b.headingPost}
        </h2>
        {/* Subtitle — fades in when the tech is toggled ON. Its space is
            ALWAYS reserved (no height animation): the grid is `items-center`, so
            growing the column on toggle would re-center it and slide the
            in-heading switch up under the cursor. Locking the height keeps the
            heading + switch put; only the description's opacity changes. */}
        <motion.p
          aria-hidden={!fixed}
          initial={false}
          animate={{ opacity: fixed ? 1 : 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-lg leading-relaxed text-muted"
        >
          <span className="mt-5 block whitespace-pre-line">{b.subtitle}</span>
        </motion.p>
      </ScrollReveal>

      {/* Demo — order-2 = the reading-end column. The window hugs the OUTER edge
          (away from the title): left in RTL, right in LTR. */}
      <ScrollReveal direction="left" className="order-2 lg:col-span-7">
        <BidiExtractionDemo fixed={fixed} hideToggle align={dir === "rtl" ? "left" : "right"} />
      </ScrollReveal>
    </div>
  );
}

// Inline knob switch sized in `em` so it scales with the heading. The knob rests
// at the inline-START when OFF and slides to the inline-END when ON — so it
// mirrors with the chrome direction (start=right in RTL, left in LTR). Off-state
// fill is --tq-card (#111) + a hairline border so it stays visible on the panel.
function InlineSwitch({
  on,
  onToggle,
  ariaLabel,
}: {
  on: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      className="relative mx-1 inline-block h-[0.72em] w-[1.4em] shrink-0 rounded-full transition-colors duration-300"
      style={{
        verticalAlign: "-0.06em",
        background: on ? "var(--tq-gradient-brand)" : "var(--tq-card)",
        border: "1px solid var(--tq-border-hairline)",
        boxShadow: on ? "0 0 18px rgba(var(--tq-violet-rgb),0.5)" : "none",
      }}
    >
      <span
        className="absolute top-1/2 h-[0.5em] w-[0.5em] -translate-y-1/2 rounded-full bg-white transition-[inset-inline-start] duration-300"
        style={{
          insetInlineStart: on ? "calc(100% - 0.5em - 0.11em)" : "0.11em",
          // Always white — matches the canonical Toggle knob. The shadow lifts it
          // off both the accent track (ON) and the near-white OFF track (light).
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}
