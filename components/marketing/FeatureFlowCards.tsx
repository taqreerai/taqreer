"use client";

// ─── Landing feature-flow cards ───────────────────────────────────
//
// The four animated flow cards (Create / Enhance / Mimic / Datasheet)
// in a 2 × 2 grid, plus a wide fifth "templates" card. Each card:
//   • glass-card chrome, content on the LEFT, visual on the RIGHT
//     (DOM order locked LTR so the layout holds under the page's RTL
//     flow; the text block re-anchors RTL).
//   • the four flow cards play their SVG animation on hover.
//   • the templates card shows a live 2-column marquee of REAL recent
//     project thumbnails (same curator-gated source as the auth
//     pages), content on the left.
//
// Lifted from the /labs/feature-cards sandbox; the animation
// components are shared verbatim.

import { useRef } from "react";
import CreateFlowAnimation, {
  type CreateFlowAnimationHandle,
} from "@/components/marketing/feature-animations/CreateFlowAnimation";
import EnhanceFlowAnimation, {
  type EnhanceFlowAnimationHandle,
} from "@/components/marketing/feature-animations/EnhanceFlowAnimation";
import MimicFlowAnimation, {
  type MimicFlowAnimationHandle,
} from "@/components/marketing/feature-animations/MimicFlowAnimation";
import DatasheetFlowAnimation, {
  type DatasheetFlowAnimationHandle,
} from "@/components/marketing/feature-animations/DatasheetFlowAnimation";
import { TemplatesScroll } from "@/components/marketing/TemplatesScroll";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";
import type { MarqueeThumbnail } from "@/lib/auth/marquee-projects";
import Link from "next/link";

export function FeatureFlowCards({
  thumbnails,
}: {
  thumbnails: MarqueeThumbnail[];
}) {
  // Each card gets the landing page's framer-motion fade-up-on-scroll
  // (ScrollReveal), staggered so the grid reveals in a cascade — same
  // treatment as the rest of the landing's sections.
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ScrollReveal direction="up" delay={0.05}>
          <CreateCard />
        </ScrollReveal>
        <ScrollReveal direction="up" delay={0.1}>
          <EnhanceCard />
        </ScrollReveal>
        <ScrollReveal direction="up" delay={0.15}>
          <MimicCard />
        </ScrollReveal>
        <ScrollReveal direction="up" delay={0.2}>
          <DatasheetCard />
        </ScrollReveal>
      </div>
      <ScrollReveal direction="up" delay={0.1} className="mt-6">
        <TemplatesCard thumbnails={thumbnails} />
      </ScrollReveal>
    </>
  );
}

// ─── Shared card chrome (flow cards) ──────────────────────────────

function FlowShell({
  title,
  description,
  onEnter,
  onLeave,
  children,
}: {
  title: string;
  description: string;
  onEnter: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="glass-card max-h-[250px] self-start rounded-2xl px-6"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* `dir="ltr"` locks DOM order so text lands LEFT, animation
          RIGHT regardless of the page's RTL flow; the text block
          re-anchors RTL for natural Arabic reading. */}
      <div dir="ltr" className="flex items-stretch gap-5">
        <div
          dir="rtl"
          className="flex min-w-[160px] flex-1 flex-col justify-center"
        >
          <h3 className="mb-2 text-xl font-medium leading-snug text-white">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-muted">{description}</p>
        </div>
        <div
          className="flex aspect-square w-[250px] min-w-0 items-center justify-center text-white/80"
          aria-hidden
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Flow cards (each owns its own correctly-typed handle ref) ────

function CreateCard() {
  const ref = useRef<CreateFlowAnimationHandle>(null);
  return (
    <FlowShell
      title="إنشاء عرض جديد"
      description="اكتب فكرتك أو ارفع ملفاً، وسيقوم تقرير ببناء عرض تقديمي كامل، بتصميم احترافي يحاكي ذوقك ومراعاة هويتك البصرية."
      onEnter={() => ref.current?.startAnimation()}
      onLeave={() => ref.current?.stopAnimation()}
    >
      <CreateFlowAnimation ref={ref} />
    </FlowShell>
  );
}

function EnhanceCard() {
  const ref = useRef<EnhanceFlowAnimationHandle>(null);
  return (
    <FlowShell
      title="تحسين عرض موجود"
      description="ارفع عرضك الحالي بصيغة PowerPoint أو PDF، وسنعيد تصميمه بهويتك البصرية الجديدة مع الحفاظ على المحتوى الأساسي."
      onEnter={() => ref.current?.startAnimation()}
      onLeave={() => ref.current?.stopAnimation()}
    >
      <EnhanceFlowAnimation ref={ref} />
    </FlowShell>
  );
}

function MimicCard() {
  const ref = useRef<MimicFlowAnimationHandle>(null);
  return (
    <FlowShell
      title="محاكاة أسلوب عرض"
      description="أرفق عرضاً مرجعياً تعجبك ألوانه وخطوطه وتخطيطه، وسنطبّق نفس الأسلوب البصري على محتواك الجديد."
      onEnter={() => ref.current?.startAnimation()}
      onLeave={() => ref.current?.stopAnimation()}
    >
      <MimicFlowAnimation ref={ref} />
    </FlowShell>
  );
}

function DatasheetCard() {
  const ref = useRef<DatasheetFlowAnimationHandle>(null);
  return (
    <FlowShell
      title="إنشاء من بيانات"
      description="حوّل ملف Excel أو CSV إلى عرض احترافي كامل، مع رسوم بيانية مناسبة وتنسيق احترافي لكل شريحة."
      onEnter={() => ref.current?.startAnimation()}
      onLeave={() => ref.current?.stopAnimation()}
    >
      <DatasheetFlowAnimation ref={ref} />
    </FlowShell>
  );
}

// ─── Templates card (wide; content LEFT, thumbnail marquee RIGHT) ──

function TemplatesCard({ thumbnails }: { thumbnails: MarqueeThumbnail[] }) {
  return (
    <div className="templates-host glass-card overflow-hidden rounded-2xl p-6">
      {/* Same LTR-locked layout: content LEFT, thumbnails RIGHT. No
          icon above the title (user direction 2026-05-28). */}
      <div dir="ltr" className="flex flex-col items-stretch gap-8 md:flex-row">
        <div
          dir="rtl"
          className="flex flex-1 flex-col justify-center md:py-4"
        >
          <h3 className="mb-3 text-xl font-medium leading-snug text-white">
            قوالب جاهزة تدعم RTL
          </h3>
          <p className="mb-6 text-sm leading-relaxed text-muted">
            ابدأ من قوالب مصممة للعروض العربية والإنجليزية، مع دعم كامل
            لاتجاه النص من اليمين إلى اليسار، وتنسيق مناسب للعناوين،
            الفقرات، الجداول، والشرائح ثنائية اللغة.
          </p>
          <Link
            href="/signup"
            className="btn-gradient inline-block w-fit px-6 py-2 text-xs"
          >
            ابدأ مجانًا
          </Link>
        </div>
        <div className="w-full md:w-1/2">
          <TemplatesScroll thumbnails={thumbnails} />
        </div>
      </div>
    </div>
  );
}
