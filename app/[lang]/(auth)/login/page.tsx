"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";

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
  const { locale } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  // `next` is user-controlled query input, so only honour internal relative
  // paths (one leading slash, never "//" or an absolute URL) to avoid
  // open-redirects; anything else falls back to the localized dashboard. The
  // proxy-supplied `next` is already a locale-prefixed internal path.
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

  const supabase = createClient();

  // Map Supabase's English error strings to localized copy.
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
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(mapError(signInError.message));
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
          // `/callback` (unlocalized) is re-prefixed by the proxy, so Supabase's
          // allowed-redirect list doesn't need a per-locale entry. `next` carries
          // the (already locale-prefixed) post-login destination.
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
      <motion.div {...fadeUp(0)} className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t.login.title}</h1>
        <p className="text-sm text-muted">{t.login.subtitle}</p>
      </motion.div>

      {deleted && (
        <motion.div {...fadeUp(0.03)} className="bg-green-500/20 border border-green-500/40 rounded-xl p-3 text-green-200 text-sm">
          {t.login.deletedSuccess}
        </motion.div>
      )}

      {error && (
        <motion.div {...fadeUp(0.05)} className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-200 text-sm">
          {error}
        </motion.div>
      )}

      {/* Google primary — top of the form for Gamma-style single-CTA
          hierarchy. Email/password sits below the divider. */}
      <motion.button
        {...fadeUp(0.1)}
        onClick={handleGoogleLogin}
        disabled={loading}
        className="btn-gradient w-full px-4 py-3 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
      >
        {googleIcon}
        {t.continueWithGoogle}
      </motion.button>

      <motion.div {...fadeUp(0.15)} className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[var(--tq-border-hairline)]" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-3 py-0.5 rounded-full bg-[var(--tq-surface)] border border-[var(--tq-border-hairline)] text-xs text-muted">
            {t.or}
          </span>
        </div>
      </motion.div>

      <motion.form {...fadeUp(0.2)} onSubmit={handleEmailLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">{t.emailLabel}</label>
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
          <label className="block text-sm font-medium mb-2">{t.passwordLabel}</label>
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
        <button
          type="submit"
          disabled={loading}
          className="btn-gradient w-full px-4 py-3 disabled:opacity-50 cursor-pointer"
        >
          {loading ? t.login.submitting : t.login.submit}
        </button>
      </motion.form>

      {/* Footer cluster — signup CTA centered, forgot-password stacked
          directly under it at the same text size. */}
      <motion.div
        {...fadeUp(0.3)}
        className="flex flex-col items-center gap-2 text-center text-sm text-muted"
      >
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
      </motion.div>
    </motion.div>
  );
}
