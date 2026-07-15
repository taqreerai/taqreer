"use client";

// Login — renders inside the auth-layout modal. Organised like the reference:
// a left-aligned eyebrow + title, an outlined Google OAuth button, an OR
// divider, then email + password. Cloudflare Turnstile (Supabase-native
// captcha) gates the password submit.

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import {
  TurnstileWidget,
  TURNSTILE_ENABLED,
} from "@/components/auth/TurnstileWidget";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { useAuthNext } from "@/components/auth/useAuthNext";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  // Post-auth redirect target (open-redirect guard lives in useAuthNext).
  const { nextUrl, templateId } = useAuthNext();
  const deleted = searchParams.get("deleted") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  const supabase = createClient();

  const mapError = (msg: string): string => {
    if (/Invalid login credentials/i.test(msg)) return t.login.errInvalidCreds;
    if (/Email not confirmed/i.test(msg)) return t.login.errEmailNotConfirmed;
    return t.errorGeneric;
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (signInError) {
        setError(mapError(signInError.message));
        setCaptchaToken("");
        setCaptchaReset((n) => n + 1);
      } else {
        // Sync the Prisma User row from the session. Both a transport error and
        // a non-2xx must block the redirect (otherwise /dashboard 404-cascades).
        let syncOk = false;
        try {
          const res = await fetch("/api/auth/user-sync", { method: "POST" });
          syncOk = res.ok;
          if (!res.ok) console.error("[login] user-sync failed", { status: res.status });
        } catch (err) {
          console.error("[login] user-sync failed", err);
        }
        if (!syncOk) {
          setError(t.accountPrepFailed);
          return;
        }
        router.push(templateId ? `${nextUrl}?template=${templateId}` : nextUrl);
        router.refresh();
      }
    } catch (err) {
      console.error("[login] sign-in error", err);
      setError(t.errorGeneric);
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
      className="space-y-5"
    >
      <div className="text-start">
        <p className="text-sm text-muted">{t.login.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold">{t.login.title}</h1>
      </div>

      {deleted && (
        <div className="status-success">{t.login.deletedSuccess}</div>
      )}
      {error && (
        <div className="status-error">{error}</div>
      )}

      <GoogleAuthButton
        disabled={loading}
        onError={setError}
        onBusyChange={setLoading}
      />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--tq-border-hairline)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="rounded-full border border-[var(--tq-border-hairline)] bg-[var(--tq-surface)] px-3 py-0.5 text-xs text-muted">
            {t.or}
          </span>
        </div>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-4">
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
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t.passwordLabel}</label>
          <input
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
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
          {loading ? t.login.submitting : t.login.submit}
        </button>
      </form>

      <div className="flex flex-col items-center gap-2 border-t border-[var(--tq-border-hairline)] pt-4 text-center text-sm text-muted">
        <span>
          {t.login.noAccount}
          <Link href={localizedHref("/signup", locale)} className="text-foreground hover:underline cursor-pointer">
            {t.login.createAccount}
          </Link>
        </span>
        <Link
          href={localizedHref("/forgot-password", locale)}
          className="text-foreground hover:underline cursor-pointer"
        >
          {t.login.forgotPassword}
        </Link>
      </div>
    </motion.div>
  );
}
