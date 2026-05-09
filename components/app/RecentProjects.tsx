"use client";

import Link from "next/link";

export function RecentProjects() {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-headline-lg text-[32px] font-bold text-on-surface">أحدث المشاريع</h2>
        <Link className="text-primary hover:text-primary-container font-label-lg transition-colors" href="/projects">
          عرض الكل
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Project 1 */}
        <div className="glass-card rounded-xl overflow-hidden group glow-hover transition-all duration-300">
          <div className="relative h-48 bg-surface-container-high">
            <img
              alt="Project thumbnail"
              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCl5VMf180mDb2sjckyPt-1FVHNBzwBlQ7A4d0yln8_BigGsNEaoqhPD8da4W1-jFGVDuxOpYgmzShhfXcaxHCpgLPYx905t1ooDdKNbHqFz_sownMz20zxA_nVif1bh5FxglhnYSv6ZImR7G2a4xmxzuWxFFXt_JEUJQK6SxmKXrbL_yC34pS8kRn-P-taWyExVTTqlusGBrjTbVlHnwGnqdHYAhQG7yQNHf9t0tOCP31IY7P8BH8dSWIRehOvalfVPUSNMMRi6Vw"
            />
            <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur px-2 py-1 rounded text-xs font-label-sm text-primary border border-primary/20">
              عرض تقديمي
            </div>
          </div>
          <div className="p-4">
            <h4 className="font-headline-md text-[18px] font-semibold text-on-surface mb-1 truncate">تقرير الأداء الربع سنوي</h4>
            <p className="text-xs text-on-surface-variant mb-4">منذ ساعتين</p>
            <div className="flex items-center justify-between border-t border-outline-variant/30 pt-3">
              <div className="flex space-x-reverse space-x-2">
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">download</span>
                </button>
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">edit</span>
                </button>
              </div>
              <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">more_vert</span>
              </button>
            </div>
          </div>
        </div>

        {/* Project 2 */}
        <div className="glass-card rounded-xl overflow-hidden group glow-hover transition-all duration-300">
          <div className="relative h-48 bg-surface-container-high">
            <img
              alt="Project thumbnail"
              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDWBUutmjq51ZdX94fxHZLEGi4uv-X_HIglpNT3eA3Iqu0xla04J7cIf-sW7-QNU8OYo7OEYCd9-2JGbqaP0aDjZsd3rhHw-a_tUF01qlXnAr3gSPm2ITKLoVBrYyTSaMLFk1rT-IuZKnhchyZeZXyN7E7DdESDsxNrbmcrVaFpYF5w_mBxI5Wm3qwzoVCzH27TjwARyVttclokTq_cdm5SqgAtZjqiRjrkN4rfCLp-ESUGpW14QzAXnvPw9d6p9FvuMs-zRN6qk9s"
            />
            <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur px-2 py-1 rounded text-xs font-label-sm text-tertiary border border-tertiary/20">
              تقرير
            </div>
          </div>
          <div className="p-4">
            <h4 className="font-headline-md text-[18px] font-semibold text-on-surface mb-1 truncate">تحليل السوق 2024</h4>
            <p className="text-xs text-on-surface-variant mb-4">منذ يومين</p>
            <div className="flex items-center justify-between border-t border-outline-variant/30 pt-3">
              <div className="flex space-x-reverse space-x-2">
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">download</span>
                </button>
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">edit</span>
                </button>
              </div>
              <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">more_vert</span>
              </button>
            </div>
          </div>
        </div>

        {/* Project 3 */}
        <div className="glass-card rounded-xl overflow-hidden group glow-hover transition-all duration-300">
          <div className="relative h-48 bg-surface-container-high">
            <div className="w-full h-full flex items-center justify-center bg-surface-variant">
              <span className="material-symbols-outlined text-4xl text-outline-variant">image</span>
            </div>
            <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur px-2 py-1 rounded text-xs font-label-sm text-primary border border-primary/20">
              عرض تقديمي
            </div>
          </div>
          <div className="p-4">
            <h4 className="font-headline-md text-[18px] font-semibold text-on-surface mb-1 truncate">خطة التسويق</h4>
            <p className="text-xs text-on-surface-variant mb-4">الأسبوع الماضي</p>
            <div className="flex items-center justify-between border-t border-outline-variant/30 pt-3">
              <div className="flex space-x-reverse space-x-2">
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">download</span>
                </button>
                <button className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-lg">edit</span>
                </button>
              </div>
              <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-lg">more_vert</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
