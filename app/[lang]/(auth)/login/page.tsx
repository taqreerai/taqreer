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

const googleIcon = (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const oauthBtn =
  "flex w-full items-center justify-center gap-2 rounded-full border border-[var(--tq-border-hairline)] bg-overlay-soft px-4 py-2.5 text-sm font-medium transition-colors hover:bg-overlay disabled:opacity-50 cursor-pointer";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  // `next` is user-controlled; only honour internal relative paths (one leading
  // slash, never "//" or absolute) to avoid open-redirects.
  const rawNext = searchParams.get("next");
  const nextUrl =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : localizedHref("/dashboard", locale);
  const templateId = searchParams.get("template");
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

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/callback?next=${encodeURIComponent(nextUrl)}${templateId ? `&template=${templateId}` : ""}`,
        },
      });
      if (signInError) setError(mapError(signInError.message));
    } catch {
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

      <button type="button" onClick={handleGoogleLogin} disabled={loading} className={oauthBtn}>
        {googleIcon}
        {t.continueWithGoogle}
      </button>

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
