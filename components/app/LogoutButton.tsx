"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 text-[#9A94A8] hover:text-white transition w-full h-[44px] mx-[18px] rounded-xl px-[12px]"
      aria-label="تسجيل الخروج"
    >
      <div className="flex items-center justify-center w-[44px] h-[44px] flex-shrink-0">
        <span className="material-symbols-outlined text-[20px]">logout</span>
      </div>
      <span className="font-medium text-sm">تسجيل الخروج</span>
    </button>
  );
}
