"use client";

import posthog from "posthog-js";

const cards = [
  {
    icon: 'add_circle',
    title: 'إنشاء عرض جديد',
    desc: 'ابدأ من الصفر بمحتواك',
    path: '/create',
  },
  {
    icon: 'auto_fix_high',
    title: 'تحسين عرض موجود',
    desc: 'ارفع ملفك واحصل على نسخة محسّنة',
    path: '/enhance',
  },
  {
    icon: 'content_copy',
    title: 'محاكاة أسلوب عرض',
    desc: 'انسخ أسلوب عرض آخر وطبّقه',
    path: '/mimic',
  },
  {
    icon: 'edit',
    title: 'بناء قالب مخصص',
    desc: 'صمم هويتك البصرية الخاصة',
    path: '/custom',
  },
];

export function QuickActions() {
  return (
    <section>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <a
            key={card.path}
            href={card.path}
            onClick={() => posthog.capture("quick_action_clicked", { action: card.path.replace("/", ""), title: card.title })}
            className="plan-banner p-6 flex flex-col gap-4 cursor-pointer hover:scale-[1.02] transition-transform duration-200 relative overflow-hidden no-underline"
            dir="rtl"
          >
            <div className="absolute top-[-40px] right-[-40px] w-[160px] h-[160px] pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(55,11,244,0.15) 0%, transparent 70%)', filter: 'blur(20px)' }} />
            <div className="text-right relative z-10">
              <span className="material-symbols-outlined text-white font-thin text-[26px]">
                {card.icon}
              </span>
            </div>
            <div className="relative z-10">
              <h3 className="text-white font-bold text-[20px] leading-snug mb-1">{card.title}</h3>
              <p className="text-[#9A94A8] text-sm leading-relaxed">{card.desc}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
