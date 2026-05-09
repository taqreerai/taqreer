"use client";

export function Header({ isCollapsed }: { isCollapsed?: boolean }) {
  return (
    <header
      className={`fixed top-0 left-0 z-40 h-20 flex items-center px-8 transition-all duration-300 ease-in-out ${isCollapsed ? "right-[80px]" : "right-[260px]"
        }`}
      style={{
        background: 'rgba(5, 5, 16, 0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(125, 45, 255, 0.12)',
        boxShadow: '0 1px 30px rgba(55, 11, 244, 0.06)',
      }}
    >
      <div className="w-full flex items-center justify-between">

        {/* Right: Greeting */}
        <div className="flex items-center">
          <h2 className="text-[24px] font-semibold text-white">مرحباً، أسامة 👋</h2>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-xl mx-8">
          <div className="relative">
            <span
              className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--tq-muted)' }}
            >
              search
            </span>
            <input
              className="w-full rounded-lg py-2 pr-10 pl-4 text-white focus:outline-none focus:ring-2 focus:ring-[#7D2DFF] focus:border-transparent transition-all"
              placeholder="ابحث في مشاريعك..."
              type="text"
              style={{
                background: 'rgba(26, 20, 35, 0.6)',
                border: '1px solid rgba(42, 36, 59, 0.8)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            />
          </div>
        </div>

        {/* Left: Actions */}
        <div className="flex items-center space-x-reverse space-x-4">
          <button
            className="p-2 transition-colors rounded-full"
            style={{ color: 'var(--tq-muted)' }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--tq-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="btn-gradient px-6 py-2.5 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">add</span>
            مشروع جديد
          </button>
        </div>
      </div>
    </header>
  );
}