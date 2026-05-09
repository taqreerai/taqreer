"use client";

export function PlanUsage() {
  return (
    <section>
      <div className="plan-banner p-8 flex flex-col md:flex-row items-center justify-between relative overflow-hidden">

        {/* Glow orb inside card */}
        <div className="glow-orb absolute" style={{
          top: '-60px', right: '-60px',
          width: '250px', height: '250px',
          background: 'radial-gradient(circle, rgba(55,11,244,0.15) 0%, transparent 70%)',
          filter: 'blur(30px)',
        }} />

        {/* Left */}
        <div className="w-full md:w-1/2 mb-6 md:mb-0 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-[24px] font-bold text-white">الخطة الاحترافية</h3>
            <span className="badge-purple">احترافي</span>
          </div>
          <p className="text-muted mb-4 text-sm">استخدام العروض التقديمية هذا الشهر</p>
          <div className="progress-track mb-2">
            <div className="progress-bar" style={{ width: '10%' }} />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>تم استخدام 10%</span>
            <span>3 / 30 عرضًا</span>
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col items-end space-y-3 relative z-10">
          <button className="btn-gradient px-8 py-3">ترقية الخطة</button>
          <span className="text-muted text-xs">تاريخ التجديد: 12 يونيو</span>
        </div>
      </div>
    </section>
  );
}
