"use client";

const cards: Array<{
  icon: string;
  title: string;
  desc: string;
  path: string;
  comingSoon?: boolean;
}> = [
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
    icon: 'grid_view',
    title: 'إنشاء من قالب',
    desc: 'اختر قالباً جاهزاً وأضف محتواك',
    path: '/templates',
  },
  {
    icon: 'dataset',
    title: 'إنشاء من بيانات',
    desc: 'حوّل ملف Excel إلى عرض احترافي',
    path: '/datasheet',
    comingSoon: true,
  },
];

export function QuickActions() {
  return (
    <section>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((card) => (
          <a
            key={card.path}
            href={card.path}
            className="qa-card relative p-4 flex flex-col gap-3 cursor-pointer no-underline group transition-all duration-200"
            dir="rtl"
          >
            {card.comingSoon && (
              <span className="absolute top-3 left-3 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                قريباً
              </span>
            )}
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
