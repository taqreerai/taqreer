"use client";

import { useRef } from "react";
import CreateFlowAnimation, {
  type CreateFlowAnimationHandle,
} from "@/components/marketing/feature-animations/CreateFlowAnimation";
import MimicFlowAnimation, {
  type MimicFlowAnimationHandle,
} from "@/components/marketing/feature-animations/MimicFlowAnimation";
import EnhanceFlowAnimation, {
  type EnhanceFlowAnimationHandle,
} from "@/components/marketing/feature-animations/EnhanceFlowAnimation";
import DatasheetFlowAnimation, {
  type DatasheetFlowAnimationHandle,
} from "@/components/marketing/feature-animations/DatasheetFlowAnimation";

// ─── Feature cards testing sandbox ─────────────────────────────────
// Standalone route for iterating on the 4 flow-explanation cards
// (Create / Enhance / Mimic / Datasheet). Each card splits horizontally:
//
//   • Visual LEFT  → title + description (Arabic copy)
//   • Visual RIGHT → empty animation slot (user will drop animated SVGs
//                    in here as a follow-up; this page is the test bed
//                    for that work)
//
// 2 × 2 grid, centered in a viewport-filling dark page. No header,
// no footer — just the cards so the animation tuning has no other
// chrome competing for visual attention.
//
// Reuses the canonical `.glass-card` chrome + brand tokens (no
// hardcoded colors). RTL set explicitly on the cards so Arabic text
// reads correctly; the layout's `flex` ordering puts the animation
// slot on the visual right regardless of `dir` (via `dir="ltr"` on
// the card's inner flex row to lock its DOM order to "text · slot",
// then the page's outer RTL flow keeps Arabic reading natural).

type FlowCard = {
  /** Arabic display title — what the user sees on the card. */
  title: string;
  /** One-paragraph Arabic description of what the flow does. */
  description: string;
  /** Slug for the SVG animation slot — used as a hook for the
   *  upcoming animated SVG components (e.g. `data-slot="create"`). */
  slot: "create" | "enhance" | "mimic" | "datasheet";
};

const CARDS: FlowCard[] = [
  {
    slot: "create",
    title: "إنشاء عرض جديد",
    description:
      "اكتب فكرتك أو ارفع ملفاً، وسيقوم تقرير ببناء عرض تقديمي كامل، بتصميم احترافي يحاكي ذوقك ومراعاة هويتك البصرية.",
  },
  {
    slot: "enhance",
    title: "تحسين عرض موجود",
    description:
      "ارفع عرضك الحالي بصيغة PowerPoint أو PDF، وسنعيد تصميمه بهويتك البصرية الجديدة مع الحفاظ على المحتوى الأساسي.",
  },
  {
    slot: "mimic",
    title: "محاكاة أسلوب عرض",
    description:
      "أرفق عرضاً مرجعياً تعجبك ألوانه وخطوطه وتخطيطه، وسنطبّق نفس الأسلوب البصري على محتواك الجديد.",
  },
  {
    slot: "datasheet",
    title: "إنشاء من بيانات",
    description:
      "حوّل ملف Excel أو CSV إلى عرض احترافي كامل، مع رسوم بيانية مناسبة وتنسيق احترافي لكل شريحة.",
  },
];

export default function FeatureCardsSandbox() {
  return (
    <main
      dir="rtl"
      className="min-h-screen w-full px-6 py-16"
      style={{ backgroundColor: "var(--tq-bg)" }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 text-center">
          <h1 className="tq-h1">سَنْدبوكس بطاقات الميزات</h1>
          <p className="tq-subhead mt-2">
            بيئة اختبار لتطوير الرسوم المتحركة لكل تدفّق. المربع الفارغ
            على يمين كل بطاقة هو الفتحة المخصصة للـ SVG القادم.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {CARDS.map((card) => (
            <FeatureCard key={card.slot} card={card} />
          ))}
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ card }: { card: FlowCard }) {
  // Each card owns its animation ref so hovering the WHOLE card (not
  // just the slot) drives the inner SVG. Same pattern the dashboard
  // QuickActions cards use to drive the animated icons.
  const createRef = useRef<CreateFlowAnimationHandle>(null);
  const mimicRef = useRef<MimicFlowAnimationHandle>(null);
  const enhanceRef = useRef<EnhanceFlowAnimationHandle>(null);
  const datasheetRef = useRef<DatasheetFlowAnimationHandle>(null);

  const handleEnter = () => {
    if (card.slot === "create") createRef.current?.startAnimation();
    if (card.slot === "mimic") mimicRef.current?.startAnimation();
    if (card.slot === "enhance") enhanceRef.current?.startAnimation();
    if (card.slot === "datasheet") datasheetRef.current?.startAnimation();
  };
  const handleLeave = () => {
    if (card.slot === "create") createRef.current?.stopAnimation();
    if (card.slot === "mimic") mimicRef.current?.stopAnimation();
    if (card.slot === "enhance") enhanceRef.current?.stopAnimation();
    if (card.slot === "datasheet") datasheetRef.current?.stopAnimation();
  };

  return (
    <div
      // Cap the card height to the slot's full size (250 px square).
      // No vertical padding — the SVG already has built-in empty
      // space top and bottom, so the slot's 250 px IS the card's
      // height. Horizontal padding (px-6) stays to inset the text
      // and SVG from the side edges. `self-start` opts the card out
      // of the grid's default row-stretch so the cap actually takes.
      className="glass-card max-h-[250px] self-start rounded-2xl px-6"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* `dir="ltr"` on the inner flex row locks the DOM order so the
          text block (first child) always lands on the visual LEFT and
          the animation slot (second child) always lands on the visual
          RIGHT — regardless of the page's outer RTL flow. User
          direction 2026-05-28: "leave the right area empty for our
          animations". */}
      <div dir="ltr" className="flex items-stretch gap-5">
        {/* Text block — title + description. `dir="rtl"` re-anchors
            the Arabic content so it reads right-to-left within its
            own column. */}
        <div
          dir="rtl"
          className="flex min-w-[160px] flex-1 flex-col justify-center"
        >
          <h3 className="mb-2 text-xl font-medium leading-snug text-white">
            {card.title}
          </h3>
          <p className="text-sm leading-relaxed text-[var(--tq-text-muted)]">
            {card.description}
          </p>
        </div>

        {/* Animation slot — currently wired only for `create`; the
            other three render the dashed placeholder until their
            animations are built. `text-white/80` on the slot for the
            animated path's `currentColor` to inherit a muted-white
            stroke. */}
        {/* Slot's flex-basis is 250 px (its full size). With grow:0
            shrink:1, it sits at exactly 250 px whenever the card is
            wide enough, and only shrinks below that when the row runs
            out of room — at which point the text column's
            `min-w-[160px]` floor forces the slot to give way instead
            of crushing the text. `aspect-square` keeps height locked
            to the resolved width so the SVG scales uniformly. */}
        <div
          data-slot={card.slot}
          className="flex aspect-square w-[250px] min-w-0 items-center justify-center text-white/80"
          aria-hidden
        >
          {card.slot === "create" ? (
            <CreateFlowAnimation ref={createRef} />
          ) : card.slot === "mimic" ? (
            <MimicFlowAnimation ref={mimicRef} />
          ) : card.slot === "enhance" ? (
            <EnhanceFlowAnimation ref={enhanceRef} />
          ) : card.slot === "datasheet" ? (
            <DatasheetFlowAnimation ref={datasheetRef} />
          ) : (
            <span className="text-[10px] text-[var(--tq-text-muted)]">
              {card.slot}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
