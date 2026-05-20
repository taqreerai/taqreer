"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

function toArabicError(msg: string): string {
  if (/Invalid login credentials/i.test(msg))
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (/Email not confirmed/i.test(msg))
    return "يرجى تأكيد بريدك الإلكتروني أولاً";
  return "حدث خطأ. يرجى المحاولة مرة أخرى";
}

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

const googleIcon = (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/dashboard";
  const templateId = searchParams.get("template");

  const deleted = searchParams.get("deleted") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(toArabicError(signInError.message));
      } else {
        // user-sync upserts the Prisma User row from the Supabase
        // session. Both branches matter:
        //   - Transport error (offline, DNS, abort) → catch fires.
        //   - Non-2xx response (500 from /api/auth/user-sync) → fetch
        //     resolves normally; we MUST inspect response.ok.
        // Previously only the transport branch was guarded, so a 500
        // silently let the user reach /dashboard with no Prisma row,
        // surfacing later as 404s on dashboard/preview routes (the
        // inline comment below has been calling this out for a while).
        let syncOk = false;
        try {
          const res = await fetch("/api/auth/user-sync", { method: "POST" });
          syncOk = res.ok;
          if (!res.ok) {
            console.error("[login] user-sync failed", { status: res.status });
          }
        } catch (err) {
          // Sync failure leaves the user without a Prisma row →
          // surfaces later as 404s on dashboard/preview. Log so the
          // root cause is traceable when those reports come in.
          console.error("[login] user-sync failed", err);
        }
        if (!syncOk) {
          setError("تعذر تجهيز الحساب. يرجى المحاولة مرة أخرى");
          return;
        }
        router.push(templateId ? `${nextUrl}?template=${templateId}` : nextUrl);
        router.refresh();
      }
    } catch (err) {
      console.error("[login] sign-in error", err);
      setError("حدث خطأ. يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}${templateId ? `&template=${templateId}` : ""}`,
        },
      });
      if (signInError) setError(toArabicError(signInError.message));
    } catch {
      setError("حدث خطأ. يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      key="login"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-3xl font-bold mb-2">تسجيل الدخول</h1>
        <p className="text-muted">مرحباً بك في تقرير</p>
      </motion.div>

      {deleted && (
        <motion.div {...fadeUp(0.03)} className="bg-green-500/20 border border-green-500/40 rounded-xl p-3 text-green-200 text-sm text-center">
          تم حذف حسابك بنجاح
        </motion.div>
      )}

      {error && (
        <motion.div {...fadeUp(0.05)} className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-200 text-sm">
          {error}
        </motion.div>
      )}

      <motion.form {...fadeUp(0.1)} onSubmit={handleEmailLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            required
            className="input-dark cursor-text"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">كلمة المرور</label>
            <Link href="/auth/forgot-password" className="text-xs text-white hover:text-cyan-400 transition-colors cursor-pointer">
              نسيت كلمة المرور؟
            </Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input-dark cursor-text"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-gradient w-full px-4 py-3 disabled:opacity-50 cursor-pointer"
        >
          {loading ? "جاري الدخول..." : "تسجيل الدخول"}
        </button>
      </motion.form>

      <motion.div {...fadeUp(0.2)} className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/[var(--glass-border-opacity)]" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-[var(--tq-bg)] text-muted">أو</span>
        </div>
      </motion.div>

      <motion.button
        {...fadeUp(0.25)}
        onClick={handleGoogleLogin}
        disabled={loading}
        className="input-dark hover:bg-white/5 disabled:opacity-50 text-white font-medium px-4 py-3 transition-colors flex items-center justify-center gap-2 cursor-pointer"
      >
        {googleIcon}
        تسجيل الدخول بجوجل
      </motion.button>

      <motion.p {...fadeUp(0.3)} className="text-sm text-center">
        ليس لديك حساب؟{" "}
        <Link href="/auth/signup" className="text-white hover:text-cyan-400 transition-colors cursor-pointer">
          إنشاء حساب جديد
        </Link>
      </motion.p>
    </motion.div>
  );
}
