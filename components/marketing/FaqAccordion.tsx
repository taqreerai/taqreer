"use client";

// Landing FAQ — RTL accordion. Single item open at a time; the first is open by
// default. Plain framer height animation, design-system tokens (.surface-card +
// --tq-* + Cairo via the page). No new deps.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

export function FaqAccordion() {
  const dict = useDict();
  const { dir } = useLocale();

  // Single-open accordion; first item open initially. Clicking the open item
  // closes it.
  const [open, setOpen] = useState<number | null>(0);

  return (
    // shadcn-style: no card pills — each row is just a question + a hairline
    // divider under it, with the answer expanding below.
    <div className="w-full" dir={dir}>
        {dict.landing.faq.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="border-b border-[var(--tq-border-hairline)] px-4 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-5 text-end"
              >
                <span
                  className={`text-base font-medium transition-colors ${
                    isOpen
                      ? "text-[var(--tq-violet)]"
                      : "text-foreground hover:text-[var(--tq-violet)]"
                  }`}
                >
                  {item.q}
                </span>
                <span
                  className="material-symbols-outlined shrink-0 text-[var(--tq-text-muted)] transition-transform duration-300"
                  style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                  aria-hidden
                >
                  expand_more
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="pb-5 text-sm leading-relaxed text-muted">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
    </div>
  );
}
