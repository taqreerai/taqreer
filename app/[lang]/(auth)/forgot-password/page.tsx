"use client";

// Forgot password — sends a recovery link. Organised like the other auth
// screens (eyebrow + title), with Cloudflare Turnstile (Supabase-native
// captcha) gating the request, and a clean message-shape success screen.

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  TurnstileWidget,
  TURNSTILE_ENABLED,
} from "@/components/auth/TurnstileWidget";

export default function ForgotPasswordPage() {
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  const supabase = createClient();

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${localizedHref("/reset-password", locale)}`,
        ...(captchaToken ? { captchaToken } : {}),
      });
      if (resetError) {
        setError(t.errorGeneric);
        setCaptchaToken("");
        setCaptchaReset((n) => n + 1);
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
        className="flex flex-col items-center gap-3 py-2 text-center"
      >
        <span className="material-symbols-outlined text-[52px] text-primary">
          mark_email_unread
        </span>
        <h1 className="text-lg font-semibold">{t.forgot.successTitle}</h1>
        <p className="text-sm text-muted">{t.forgot.successBody}</p>
        <Link
          href={localizedHref("/login", locale)}
          className="mt-1 cursor-pointer text-sm text-muted transition-colors hover:text-foreground"
        >
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
      <div className="text-start">
        <p className="text-sm text-muted">{t.forgot.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold">{t.forgot.title}</h1>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/20 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleResetRequest} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t.emailLabel}</label>
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            required
            className="input-dark cursor-text"
          />
        </div>

        {TURNSTILE_ENABLED ? (
          <TurnstileWidget
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken("")}
            resetKey={captchaReset}
            className="w-full"
          />
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="btn-gradient w-full px-4 py-2.5 text-sm disabled:opacity-50 cursor-pointer"
        >
          {loading ? t.forgot.submitting : t.forgot.submit}
        </button>
      </form>

      <p className="border-t border-[var(--tq-border-hairline)] pt-4 text-center text-sm text-muted">
        {t.forgot.rememberedPassword}
        <Link href={localizedHref("/login", locale)} className="text-foreground hover:underline cursor-pointer">
          {t.forgot.login}
        </Link>
      </p>
    </motion.div>
  );
}
