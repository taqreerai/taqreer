"use client";

const cards = [
  {
    icon: 'add_circle',
    title: 'إنشاء عرض جديد',
    desc: 'ابدأ من الصفر بمحتواك',
    path: '/create/content',
  },
  {
    icon: 'auto_fix_high',
    title: 'تحسين عرض موجود',
    desc: 'ارفع ملفك واحصل على نسخة محسّنة',
    path: '/enhance/upload',
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
            className="qa-card p-4 flex flex-col gap-3 cursor-pointer no-underline group transition-all duration-200"
            dir="rtl"
          >
            <div className="text-right">
              <span className="material-symbols-outlined text-[18px] text-muted group-hover:text-white transition-colors">
                {card.icon}
              </span>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-white leading-snug mb-0.5">{card.title}</h3>
              <p className="text-[11px] text-muted leading-relaxed">{card.desc}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
