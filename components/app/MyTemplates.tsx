"use client";

const templates = [
  {
    title: 'قالب الشركة الرسمي',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCeUELy4bYNHYFx6B9BYfqCO6E0w6fDccFQZCzdz7JtVZ6O2oXJs5FtpsBdkQJx2C-N1pPoE0aN82JoM_QOPGeIkGoz0cMgZGmOOWNwmcPD66UKKCVU7LRygVot4BxJEC0SndagOVeSQt4gXd9ZL_aHcGs4T3GqWAOkYp_Fuqs5-2xXlRnIbjrkXZZOKEHN6Iy4z-4Qf4s6-7ScBXznLre3-N7w5tortqYSJBz7cZvLp6GnF5uBgN3sElR_cLEnPPw3eMiFI7ANG80',
  },
  {
    title: 'قالب العروض البيعية',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCE8xL--CyYiHtcXCIDjH6On8uB_ZceiVrljRIPmIuQqpkYWw9UPaF60fG0U5hhYIvaTwdxifxJOEH2vpR_IF7m9tprUvWyN-PM4lIm4THc1QjVRRrUWYfP1foHZqYYaXrqSofv4xljBueHqx4l3MOT1dp0H__-RRdkv9k8jCgMpIDJHYQ2pK-cdqE-oA8f1WgFbDhAuYYJunIQFm9nIjNeZzwG_Rpm7UoLu5Ejf70V0zjuKB826pRPZPrR5vDA8PR8maGluSbc6SI',
  },
  {
    title: 'قالب التقارير الشهرية',
    img: null,
  },
];

export function MyTemplates() {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[32px] font-bold text-white">قوالبي</h2>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4 snap-x">
        {templates.map((template, i) => (
          <div key={i} className="min-w-[300px] card-dark rounded-xl overflow-hidden group relative snap-start">

            {/* Thumbnail */}
            <div className="h-40 relative" style={{ background: 'rgba(26, 20, 35, 0.8)' }}>
              {template.img ? (
                <img
                  alt="Template thumbnail"
                  className="w-full h-full object-cover opacity-60 group-hover:opacity-90 transition-opacity duration-300"
                  src={template.img}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-4xl" style={{ color: 'rgba(154, 148, 168, 0.4)' }}>
                    add_photo_alternate
                  </span>
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm"
                style={{ background: 'rgba(3, 3, 13, 0.75)' }}
              >
                <button className="btn-gradient px-6 py-2">
                  استخدم
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 divider-dark border-t">
              <h4 className="text-[16px] font-semibold text-white">{template.title}</h4>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}