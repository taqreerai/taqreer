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
        // Supabase verifies the recovery token, creates a recovery
        // session, then redirects to this URL with the session in the
        // URL hash. `/reset-password` renders a form that calls
        // `auth.updateUser({ password })` against the recovery session.
        // Path was `/auth/reset-password` before the auth-URL
        // migration — corrected 2026-05-28.
        redirectTo: `${window.location.origin}/reset-password`,
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
          <p className="text-muted">أرسلنا لك رابط لاستعادة كلمة المرور</p>
        </div>
        <div className="bg-blue-500/20 border border-blue-500/40 rounded-xl p-4">
          <p className="text-blue-200 text-sm">
            تحقق من بريدك الإلكتروني لتلقي رابط استعادة كلمة المرور. قد يستغرق وصول الرسالة بضع دقائق.
          </p>
        </div>
        <Link href="/login" className="text-white hover:underline cursor-pointer">
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
      className="space-y-5"
    >
      {/* Heading + subtitle — same hierarchy as signup/login forms,
          center-aligned, `text-2xl` per user direction 2026-05-28. */}
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-2xl font-bold mb-2">استعادة كلمة المرور</h1>
        <p className="text-sm text-muted">سنرسل لك رابط استعادة على بريدك الإلكتروني.</p>
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
            className="input-dark cursor-text"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-gradient w-full px-4 py-3 disabled:opacity-50 cursor-pointer"
        >
          {loading ? "جاري الإرسال..." : "إرسال رابط الاستعادة"}
        </button>
      </motion.form>

      <motion.p {...fadeUp(0.2)} className="text-sm text-muted">
        تذكرت كلمة المرور؟{" "}
        <Link href="/login" className="text-white hover:underline cursor-pointer">
          تسجيل الدخول
        </Link>
      </motion.p>
    </motion.div>
  );
}
