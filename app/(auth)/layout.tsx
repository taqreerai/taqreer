import Image from "next/image";
import Link from "next/link";
import { AuthAnimations } from "./AuthAnimations";

export const metadata = {
  title: "تقرير - المصادقة",
  description: "تسجيل الدخول أو إنشاء حساب جديد",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[var(--tq-bg)]">
      <Link href="/" className="mb-12 flex-shrink-0 cursor-pointer">
        <Image
          src="/logo-light.svg"
          alt="Taqreer"
          width={140}
          height={40}
          className="h-10 w-auto"
        />
      </Link>
      <div className="w-full max-w-md">
        <AuthAnimations>{children}</AuthAnimations>
      </div>
    </div>
  );
}
