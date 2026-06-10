"use client";

// Landing FAQ — RTL accordion. Single item open at a time; the first is open by
// default. Plain framer height animation, design-system tokens (.glass-card +
// --tq-* + Cairo via the page). No new deps.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const FAQS: { q: string; a: string }[] = [
  {
    q: "ما هو تقرير؟",
    a: "تقرير منصة ذكاء اصطناعي تحوّل محتواك — نصًا أو ملفًا أو فكرة — إلى عرض تقديمي احترافي كامل التصميم بالعربية والإنجليزية خلال دقائق.",
  },
  {
    q: "هل يدعم اللغة العربية بشكل كامل؟",
    a: "نعم، تقرير مصمم للعربية أولًا: اتجاه RTL صحيح، خطوط عربية أنيقة، وتنسيق ثنائي الاتجاه يتعامل مع الكلمات الإنجليزية والأرقام داخل النص العربي بدقة.",
  },
  {
    q: "كيف يعمل نظام الأرصدة؟",
    a: "كل عرض يستهلك أرصدة حسب عدد الشرائح والنموذج المستخدم. تحصل على رصيد شهري مع خطتك، إضافة إلى 400 رصيد مجاني عند التسجيل لتجربة المنصة.",
  },
  {
    q: "هل يمكنني تعديل العرض بعد إنشائه؟",
    a: "بالتأكيد. المحرر يتيح تعديل النصوص والألوان والشرائح وإعادة ترتيبها، مع حفظ تلقائي ونسخ سابقة (checkpoints) للرجوع إليها في أي وقت.",
  },
  {
    q: "هل يمكنني تصدير العرض إلى PowerPoint؟",
    a: "نعم، يمكنك تصدير عروضك بصيغة PPTX قابلة للتعديل في PowerPoint مع الحفاظ على التنسيق العربي واتجاه النص.",
  },
  {
    q: "هل أستطيع تطبيق هويتي البصرية؟",
    a: "نعم، ارفع شعارك وألوانك وخطوطك في قسم الهوية البصرية، ويطبّقها تقرير تلقائيًا على عروضك لتبقى متسقة مع علامتك التجارية.",
  },
  {
    q: "هل يمكنني إلغاء الاشتراك في أي وقت؟",
    a: "نعم، يمكنك الترقية أو التخفيض أو الإلغاء في أي وقت من إعدادات حسابك، دون أي التزام طويل الأجل.",
  },
];

export function FaqAccordion() {
  // Single-open accordion; first item open initially. Clicking the open item
  // closes it.
  const [open, setOpen] = useState<number | null>(0);

  return (
    // shadcn-style: no card pills — each row is just a question + a hairline
    // divider under it, with the answer expanding below.
    <div className="w-full" dir="rtl">
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="border-b border-[var(--tq-border-glass)] px-4 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-5 text-right"
              >
                <span
                  className={`text-base font-medium transition-colors ${
                    isOpen
                      ? "text-[var(--tq-violet)]"
                      : "text-white hover:text-[var(--tq-violet)]"
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
