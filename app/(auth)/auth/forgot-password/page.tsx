"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }
      );

      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccess(true);
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
          <h1 className="text-3xl font-bold mb-2">✓ تحقق من بريدك</h1>
          <p className="text-[#9A94A8]">أرسلنا لك رابط لاستعادة كلمة المرور</p>
        </div>

        <div className="bg-blue-500/20 border border-blue-500/40 rounded-lg p-4">
          <p className="text-blue-200 text-sm">
            تحقق من بريدك الإلكتروني لتلقي رابط استعادة كلمة المرور. قد يستغرق وصول الرسالة بضع دقائق.
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
        <h1 className="text-3xl font-bold mb-2">استعادة كلمة المرور</h1>
        <p className="text-[#9A94A8]">أدخل بريدك الإلكتروني لاستعادة كلمة المرور</p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleResetRequest} className="space-y-4">
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

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#370BF4] to-[#E036B8] hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-3 transition"
        >
          {loading ? "جاري الإرسال..." : "إرسال رابط الاستعادة"}
        </button>
      </form>

      <p className="text-sm text-center text-[#9A94A8]">
        تذكرت كلمة المرور؟{" "}
        <Link href="/auth/login" className="text-[#370BF4] hover:text-[#E036B8] transition">
          تسجيل الدخول
        </Link>
      </p>
    </div>
  );
}
