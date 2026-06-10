"use client";

// BiDi feature band — asymmetric (RTL): a single big title on the RIGHT with an
// inline on/off switch wired INTO the heading (Laravel "AI-enabled ⬤ framework"
// style), and the controlled BiDi demo on the LEFT. Flipping the switch drives
// the demo's extraction fix and reveals a one-line subtitle. Direction-aware
// reveals: the right title slides in from the right, the left demo from the left.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BidiExtractionDemo } from "@/components/marketing/BidiExtractionDemo";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";

export function BidiSection() {
  const [fixed, setFixed] = useState(false);
  return (
    <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12">
      {/* Title — right column (order-1 = right in RTL). */}
      <ScrollReveal direction="right" className="order-1 lg:col-span-5">
        <h2 className="text-balance text-4xl font-medium leading-tight md:text-5xl">
          تقنية Taqreer{" "}
          <InlineSwitch on={fixed} onToggle={() => setFixed((f) => !f)} />{" "}
          لتحسين الاستخراج
        </h2>
        {/* Subtitle — only when the tech is toggled ON. */}
        <AnimatePresence>
          {fixed && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="overflow-hidden text-lg leading-relaxed text-muted"
            >
              <span className="mt-5 block">
                نفس النص الذي تدخله للتصميم يصدر إلى
                <br />
                PowerPoint بدون مشاكل في الاتجاه
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </ScrollReveal>

      {/* Demo — left column (order-2 = left in RTL). */}
      <ScrollReveal direction="left" className="order-2 lg:col-span-7">
        <BidiExtractionDemo fixed={fixed} hideToggle align="left" />
      </ScrollReveal>
    </div>
  );
}

// Inline knob switch sized in `em` so it scales with the heading. Default (OFF)
// rests the knob on the RIGHT; switching it LEFT turns it ON (brand gradient +
// glow). Off-state fill is --tq-card (#111) + a hairline border so it stays
// visible on the panel bg.
function InlineSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="تفعيل تقنية الاستخراج"
      onClick={onToggle}
      className="relative mx-1 inline-block h-[0.72em] w-[1.4em] shrink-0 rounded-full transition-colors duration-300"
      style={{
        verticalAlign: "-0.06em",
        background: on ? "var(--tq-gradient-brand)" : "var(--tq-card)",
        border: "1px solid var(--tq-border-glass)",
        boxShadow: on ? "0 0 18px rgba(var(--tq-violet-rgb),0.5)" : "none",
      }}
    >
      <span
        className="absolute top-1/2 h-[0.5em] w-[0.5em] -translate-y-1/2 rounded-full bg-white transition-[left] duration-300"
        style={{ left: on ? "0.11em" : "calc(100% - 0.5em - 0.11em)" }}
      />
    </button>
  );
}
