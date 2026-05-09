"use client";

const cards = [
  { icon: 'add_circle', color: '#370BF4', glow: 'rgba(55,11,244,0.3)', border: 'rgba(55,11,244,0.5)', title: 'إنشاء عرض جديد', subtitle: 'ابدأ من الصفر', btnLabel: 'ابدأ الآن', filled: true },
  { icon: 'auto_fix_high', color: '#E036B8', glow: 'rgba(224,54,184,0.3)', border: 'rgba(224,54,184,0.5)', title: 'تحسين عرض موجود', subtitle: 'ارفع ملفك وحسنه', btnLabel: 'رفع الملف', filled: false },
  { icon: 'content_copy', color: '#9326C9', glow: 'rgba(147,38,201,0.3)', border: 'rgba(147,38,201,0.5)', title: 'استخدام قالب', subtitle: 'اختر من مكتبتنا', btnLabel: 'تصفح', filled: false },
  { icon: 'edit', color: '#7D2DFF', glow: 'rgba(125,45,255,0.3)', border: 'rgba(125,45,255,0.5)', title: 'بناء قالب مخصص', subtitle: 'صمم هويتك الخاصة', btnLabel: 'ابدأ التصميم', filled: false },
];

export function QuickActions() {
  return (
    <section>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, i) => (
          <div
            key={i}
            className="card-dark rounded-xl p-6 flex flex-col items-start group cursor-pointer"
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = card.border;
              e.currentTarget.style.boxShadow = `0 8px 32px ${card.glow}`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(42,36,59,0.8)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div
              className="flex items-center justify-center w-12 h-12 rounded-xl mb-4 flex-shrink-0"
              style={{
                background: `${card.color}25`,
                border: `1px solid ${card.color}40`,
              }}
            >
              <span className="material-symbols-outlined text-white" style={{ fontSize: '22px' }}>
                {card.icon}
              </span>
            </div>

            <h3 className="text-[20px] font-semibold text-white mb-1">{card.title}</h3>
            <p className="text-muted mb-6 text-sm">{card.subtitle}</p>

            {card.filled ? (
              <button className="btn-gradient w-full py-2">{card.btnLabel}</button>
            ) : (
              <button className="btn-outline-dark w-full py-2">{card.btnLabel}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
