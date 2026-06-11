"use client";

// Reset-password landing — terminus of the password-recovery flow.
// User clicks the link in the reset email → Supabase verifies the
// recovery token, creates a short-lived recovery session, then 302
// redirects here with the session in the URL hash. The Supabase JS
// client auto-detects the hash on mount and surfaces a
// `PASSWORD_RECOVERY` auth event; from that point we can call
// `auth.updateUser({ password })` to set the new password.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

export default function ResetPasswordPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Tracks whether the recovery session is actually present. If the
  // user lands here without coming from a valid reset email (e.g. a
  // direct URL paste, or an expired link), we surface that up-front
  // instead of letting them fill the form and fail on submit.
  const [hasRecoverySession, setHasRecoverySession] = useState<
    boolean | null
  >(null);

  const supabase = createClient();

  useEffect(() => {
    // Supabase parses the URL hash on init and creates the recovery
    // session; `getSession()` returns it once parsed. We also listen
    // for the `PASSWORD_RECOVERY` event in case the hash parses
    // slightly after first paint.
    void supabase.auth.getSession().then(({ data }) => {
      setHasRecoverySession(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setHasRecoverySession(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t.passwordMin);
      return;
    }
    if (password !== confirmPw) {
      setError(t.reset.passwordMismatch);
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        // Most common cause: the recovery session expired or was
        // never established (stale link, manual URL paste).
        setError(t.reset.updateFailed);
      } else {
        setSuccess(true);
        // Brief affirmation, then land them on the dashboard. The
        // user's recovery session was upgraded to a full session by
        // `updateUser`, so /dashboard reads them as signed-in.
        setTimeout(() => router.push(localizedHref("/dashboard", locale)), 1500);
      }
    } catch (err) {
      console.error("[reset-password] update error", err);
      setError(t.errorGeneric);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <motion.div
        key="reset-success"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-6 text-center"
      >
        <div>
          <h1 className="text-2xl font-bold mb-2">{t.reset.successTitle}</h1>
          <p className="text-sm text-muted">{t.reset.successSubtitle}</p>
        </div>
      </motion.div>
    );
  }

  // Direct hit without a recovery session — most often an expired or
  // re-used reset link. Keep the form rendered (in case the session
  // is still arriving) but surface a stale-link banner explicitly.
  const showStaleLinkBanner = hasRecoverySession === false;

  return (
    <motion.div
      key="reset-password"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t.reset.title}</h1>
        <p className="text-sm text-muted">{t.reset.subtitle}</p>
      </motion.div>

      {showStaleLinkBanner && (
        <motion.div
          {...fadeUp(0.03)}
          className="bg-yellow-500/15 border border-yellow-500/40 rounded-xl p-3 text-yellow-200 text-sm"
        >
          {t.reset.staleLinkPrefix}
          <Link href={localizedHref("/forgot-password", locale)} className="text-foreground hover:underline">
            {t.reset.staleLinkLink}
          </Link>
          .
        </motion.div>
      )}

      {error && (
        <motion.div
          {...fadeUp(0.05)}
          className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-200 text-sm"
        >
          {error}
        </motion.div>
      )}

      <motion.form
        {...fadeUp(0.1)}
        onSubmit={handleResetSubmit}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium mb-2">
            {t.reset.newPasswordLabel}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input-dark cursor-text"
          />
          <p className="text-xs text-muted mt-1">{t.passwordMinHint}</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">
            {t.reset.confirmPasswordLabel}
          </label>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="••••••••"
            required
            className="input-dark cursor-text"
          />
        </div>
        <button
          type="submit"
          disabled={loading || hasRecoverySession === false}
          className="btn-pill w-full px-4 py-3 disabled:opacity-50 cursor-pointer"
        >
          {loading ? t.reset.submitting : t.reset.submit}
        </button>
      </motion.form>

      <motion.p {...fadeUp(0.2)} className="text-sm text-muted text-center">
        {t.reset.rememberedPassword}
        <Link
          href={localizedHref("/login", locale)}
          className="text-foreground hover:underline cursor-pointer"
        >
          {t.reset.login}
        </Link>
      </motion.p>
    </motion.div>
  );
}
