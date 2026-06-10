// Landing top nav — STATIC (Swiss-grid redesign): no scroll-reveal motion, no
// background fill, just a bottom hairline. `absolute` so it sits at the top of
// the hero and scrolls away (no sticky reveal). RTL: logo on the right (reading
// start), nav links centred, auth CTAs on the left.

import Link from "next/link";
import Image from "next/image";

const NAV_LINKS = [
  { label: "الرئيسية", href: "#" },
  { label: "المميزات", href: "#features" },
  { label: "الأسعار", href: "#pricing" },
  { label: "القوالب", href: "#templates" },
];

export function LandingNav({ isAuthed }: { isAuthed: boolean }) {
  return (
    <nav className="absolute top-0 right-0 left-0 z-50">
      <div className="mx-auto max-w-7xl border-b border-[var(--tq-border-glass)] px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <Link href="/" className="flex flex-shrink-0 items-center gap-2">
            <Image
              src="/logo-light.svg"
              alt="Taqreer Logo"
              width={140}
              height={32}
              className="h-8 w-auto object-contain"
            />
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="cursor-pointer text-sm text-muted transition-colors hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            {isAuthed ? (
              <Link href="/dashboard" className="btn-gradient px-5 py-2 text-xs">
                لوحة التحكم
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-pill px-4 py-2 text-xs">
                  تسجيل الدخول
                </Link>
                <Link href="/signup" className="btn-gradient px-5 py-2 text-xs">
                  إنشاء حساب
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
