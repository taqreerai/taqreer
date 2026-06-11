"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

export default function ForgotPasswordPage() {
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

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
        // Supabase verifies the recovery token, creates a recovery session, then
        // redirects to this URL with the session in the hash. `/reset-password`
        // (unlocalized) is re-prefixed by the proxy to the user's locale.
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(t.errorGeneric);
      } else {
        setSuccess(true);
      }
    } catch {
      setError(t.errorGeneric);
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
          <h1 className="text-3xl font-bold mb-2">{t.forgot.successTitle}</h1>
          <p className="text-muted">{t.forgot.successSubtitle}</p>
        </div>
        <div className="bg-blue-500/20 border border-blue-500/40 rounded-xl p-4">
          <p className="text-blue-200 text-sm">{t.forgot.successBody}</p>
        </div>
        <Link href={localizedHref("/login", locale)} className="text-foreground hover:underline cursor-pointer">
          {t.signup.backToLogin}
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
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t.forgot.title}</h1>
        <p className="text-sm text-muted">{t.forgot.subtitle}</p>
      </motion.div>

      {error && (
        <motion.div {...fadeUp(0.05)} className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-200 text-sm">
          {error}
        </motion.div>
      )}

      <motion.form {...fadeUp(0.1)} onSubmit={handleResetRequest} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">{t.emailLabel}</label>
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
          {loading ? t.forgot.submitting : t.forgot.submit}
        </button>
      </motion.form>

      <motion.p {...fadeUp(0.2)} className="text-sm text-muted">
        {t.forgot.rememberedPassword}
        <Link href={localizedHref("/login", locale)} className="text-foreground hover:underline cursor-pointer">
          {t.forgot.login}
        </Link>
      </motion.p>
    </motion.div>
  );
}
