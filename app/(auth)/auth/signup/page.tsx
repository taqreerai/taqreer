"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 8) {
      setError("يجب أن تكون كلمة المرور 8 أحرف على الأقل");
      setLoading(false);
      return;
    }

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      } else {
        // Attempt to sync user (in case email is auto-confirmed)
        try {
          await fetch("/api/auth/user-sync", { method: "POST" });
        } catch (err) {
          console.error("User sync error:", err);
        }
        setSuccess(true);
      }
    } catch (err) {
      setError("حدث خطأ. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    setError(null);

    try {
      const { error: signUpError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      }
    } catch (err) {
      setError("حدث خطأ. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">✓ تم إنشاء الحساب</h1>
          <p className="text-[#9A94A8]">شكراً لك على التسجيل</p>
        </div>

        <div className="bg-green-500/20 border border-green-500/40 rounded-lg p-4">
          <p className="text-green-200">
            تحقق من بريدك الإلكتروني لتأكيد حسابك. قد يستغرق وصول رسالة البريد بضع دقائق.
          </p>
        </div>

        <Link href="/auth/login" className="text-[#370BF4] hover:text-[#E036B8] transition">
          العودة إلى تسجيل الدخول
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">إنشاء حساب جديد</h1>
        <p className="text-[#9A94A8]">انضم إلى تقرير الآن</p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleEmailSignup} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">الاسم الكامل</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="أحمد محمد"
            required
            className="w-full bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-lg px-4 py-3 text-white placeholder-[#9A94A8] focus:outline-none focus:border-[#370BF4] transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            required
            className="w-full bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-lg px-4 py-3 text-white placeholder-[#9A94A8] focus:outline-none focus:border-[#370BF4] transition"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">كلمة المرور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-lg px-4 py-3 text-white placeholder-[#9A94A8] focus:outline-none focus:border-[#370BF4] transition"
          />
          <p className="text-xs text-[#9A94A8] mt-1">8 أحرف على الأقل</p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#370BF4] to-[#E036B8] hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-3 transition"
        >
          {loading ? "جاري الإنشاء..." : "إنشاء الحساب"}
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[rgba(42,36,59,0.8)]"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-[#03030D] text-[#9A94A8]">أو</span>
        </div>
      </div>

      <button
        onClick={handleGoogleSignup}
        disabled={loading}
        className="w-full bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] hover:bg-[#0F0B1E]/80 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-3 transition flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        التسجيل بجوجل
      </button>

      <p className="text-sm text-center text-[#9A94A8]">
        هل لديك حساب بالفعل؟{" "}
        <Link href="/auth/login" className="text-[#370BF4] hover:text-[#E036B8] transition">
          تسجيل الدخول
        </Link>
      </p>
    </div>
  );
}
