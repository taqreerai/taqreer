"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (resetError) {
        setError("حدث خطأ. يرجى المحاولة مرة أخرى");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("حدث خطأ. يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <motion.div
        key="forgot-success"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-6 text-center"
      >
        <div>
          <h1 className="text-3xl font-bold mb-2">✓ تحقق من بريدك</h1>
          <p className="text-[#9A94A8]">أرسلنا لك رابط لاستعادة كلمة المرور</p>
        </div>
        <div className="bg-blue-500/20 border border-blue-500/40 rounded-xl p-4">
          <p className="text-blue-200 text-sm">
            تحقق من بريدك الإلكتروني لتلقي رابط استعادة كلمة المرور. قد يستغرق وصول الرسالة بضع دقائق.
          </p>
        </div>
        <Link href="/auth/login" className="text-white hover:text-cyan-400 transition-colors cursor-pointer">
          العودة إلى تسجيل الدخول
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="forgot"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-3xl font-bold mb-2">استعادة كلمة المرور</h1>
        <p className="text-[#9A94A8]">أدخل بريدك الإلكتروني لاستعادة كلمة المرور</p>
      </motion.div>

      {error && (
        <motion.div {...fadeUp(0.05)} className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-200 text-sm">
          {error}
        </motion.div>
      )}

      <motion.form {...fadeUp(0.1)} onSubmit={handleResetRequest} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            required
            className="w-full bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-xl px-4 py-3 text-white placeholder-[#9A94A8] focus:outline-none focus:border-[#370BF4] transition cursor-text"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#370BF4] to-[#E036B8] hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-xl px-4 py-3 transition cursor-pointer"
        >
          {loading ? "جاري الإرسال..." : "إرسال رابط الاستعادة"}
        </button>
      </motion.form>

      <motion.p {...fadeUp(0.2)} className="text-sm text-center">
        تذكرت كلمة المرور؟{" "}
        <Link href="/auth/login" className="text-white hover:text-cyan-400 transition-colors cursor-pointer">
          تسجيل الدخول
        </Link>
      </motion.p>
    </motion.div>
  );
}
