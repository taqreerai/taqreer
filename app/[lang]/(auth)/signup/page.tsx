"use client";

// Signup — renders inside the auth-layout modal (the page wordmark + legal
// fine-print live in `(auth)/layout.tsx`; this file owns the form).
//
// Single-step email signup (user direction 2026-06-16): name + email + password
// with a LIVE requirements checklist. Cloudflare Turnstile (Supabase-native
// captcha) gates the submit + the resend. A "Continue with Google" button
// (shared GoogleAuthButton, same OAuth flow as login) sits above the email form;
// the /callback route creates the account on first Google sign-in. Left-aligned
// eyebrow + title, then the fields.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage() {
  const router = useRouter();
  const { locale, dir } = useLocale();
  const dict = useDict();
  const t = dict.auth;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Two-step signup: step 1 = email OR Google; step 2 = name + password. Google
  // sign-in skips step 2 entirely (the account + profile come from the OAuth
  // callback), so the name/password fields only exist on the email path.
  const [step, setStep] = useState<1 | 2>(1);

  // Cloudflare Turnstile token + a reset counter (token is single-use, so a
  // failed submit / resend bumps it to fetch a fresh challenge).
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  // Resend-confirmation cooldown (seconds). Armed to 60 when the success screen
  // appears (an email was just sent) and after each resend, so it can't be
  // spammed. `resending`/`resent` drive its label + feedback.
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const supabase = createClient();
  // Post-auth redirect target (open-redirect guard lives in useAuthNext). The
  // Google button (GoogleAuthButton) resolves the SAME target, so email and
  // Google signup land in the same place, matching the login email flow.
  const { nextUrl, templateId } = useAuthNext();
  // Callback URL for the email-confirmation / resend links, forwarding
  // next + template. Called only inside handlers, so window is defined.
  const buildCallbackUrl = () =>
    `${window.location.origin}/callback?next=${encodeURIComponent(nextUrl)}${
      templateId ? `&template=${encodeURIComponent(templateId)}` : ""
    }`;

  // Tick the resend cooldown down to 0 (setTimeout keeps the setState in an
  // async callback, not a mount effect — avoids the set-state-in-effect rule).
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Live password requirements (user direction 2026-06-15).
  const pwReqs = [
    { key: "len", label: t.signup.pwReqLength, met: password.length >= 8 },
    { key: "num", label: t.signup.pwReqNumber, met: /[0-9]/.test(password) },
    {
      key: "spec",
      label: t.signup.pwReqSpecial,
      // A real symbol: NOT a letter (any script, so Arabic letters don't count),
      // NOT a digit, NOT whitespace. Avoids the `[^A-Za-z0-9]` trap that accepted
      // Arabic letters + spaces as "special".
      met: /[^\p{L}\p{N}\s]/u.test(password),
    },
    {
      key: "space",
      label: t.signup.pwReqNoSpace,
      met: password.length > 0 && password === password.trim(),
    },
  ];
  const pwAllMet = pwReqs.every((r) => r.met);

  const mapError = (msg: string): string => {
    if (/already registered|already exists|User already registered/i.test(msg))
      return t.signup.errEmailInUse;
    if (/Password should be at least|weak password/i.test(msg)) return t.passwordMin;
    return t.errorGeneric;
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) {
      setError(t.signup.invalidEmail);
      return;
    }
    if (!pwAllMet) return;
    setLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name, name, lang: locale },
          emailRedirectTo: buildCallbackUrl(),
          ...(captchaToken ? { captchaToken } : {}),
        },
      });

      if (signUpError) {
        setError(mapError(signUpError.message));
        // Token is spent on a failed attempt — fetch a fresh challenge.
        setCaptchaToken("");
        setCaptchaReset((n) => n + 1);
      } else if (data.session) {
        // Email confirmation disabled — session returned immediately. Sync the
        // Prisma row before redirecting (both transport AND non-2xx must block).
        let syncOk = false;
        try {
          const res = await fetch("/api/auth/user-sync", { method: "POST" });
          syncOk = res.ok;
          if (!res.ok) console.error("[signup] user-sync failed", { status: res.status });
        } catch (err) {
          console.error("[signup] user-sync failed", err);
        }
        if (!syncOk) {
          setError(t.accountPrepFailed);
          return;
        }
        router.push(templateId ? `${nextUrl}?template=${templateId}` : nextUrl);
        router.refresh();
      } else {
        // Email confirmation required - show the confirm screen and arm the
        // resend cooldown (an email was just sent). Reset the captcha so the
        // resend action gets a fresh token.
        setSuccess(true);
        setCooldown(60);
        setCaptchaToken("");
        setCaptchaReset((n) => n + 1);
      }
    } catch (err) {
      console.error("[signup] sign-up error", err);
      setError(t.errorGeneric);
    } finally {
      setLoading(false);
    }
  };

  // Step 1 → step 2. Validate the email format only (existence is checked by
  // the real signUp on step 2 submit); advancing reveals the name/password.
  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) {
      setError(t.signup.invalidEmail);
      return;
    }
    setStep(2);
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setResent(false);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: buildCallbackUrl(),
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (!resendError) {
        setResent(true);
        setCooldown(60);
      }
    } catch (err) {
      console.error("[signup] resend failed", err);
    } finally {
      setResending(false);
      setCaptchaToken("");
      setCaptchaReset((n) => n + 1);
    }
  };

  // ─── Confirm-email success screen ───────────────────────────────────
  if (success) {
    const resendLabel = resending
      ? t.signup.resending
      : cooldown > 0
        ? t.signup.resendIn.replace(
            "{seconds}",
            `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}`,
          )
        : t.signup.resend;
    return (
      <motion.div
        key="signup-success"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col items-center gap-3 py-2 text-center"
      >
        {/* Canonical message shape (see /ar/brand, Modals): thin icon, semibold
            title, muted body. Icon tinted blue per user direction. */}
        <span className="material-symbols-outlined text-[52px] text-primary">
          mark_email_unread
        </span>
        <h1 className="text-lg font-semibold">{t.signup.successTitle}</h1>
        <p className="text-sm text-muted">{t.signup.successBody}</p>
        <p className="text-xs text-muted">{t.junkHint}</p>

        {TURNSTILE_ENABLED && cooldown === 0 ? (
          <TurnstileWidget
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken("")}
            resetKey={captchaReset}
            className="my-1 w-full max-w-[300px]"
          />
        ) : null}
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || resending}
          className="btn-pill mt-1 px-4 py-1.5"
        >
          {resendLabel}
        </button>
        {resent && cooldown > 0 ? (
          <p className="text-xs" style={{ color: "var(--tq-status-ok-text)" }}>
            {t.signup.resentOk}
          </p>
        ) : null}

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
      key="signup"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      {error && <div className="status-error">{error}</div>}

      {step === 1 ? (
        /* ─── Step 1: email OR Google ─────────────────────────────── */
        <>
          <div className="text-start">
            <p className="text-sm text-muted">{t.signup.eyebrow}</p>
            <h1 className="mt-1 text-2xl font-bold">{t.signup.title}</h1>
          </div>

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

          <form onSubmit={handleContinue} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.emailLabel}</label>
              <input
                type="email"
                dir="ltr"
                autoFocus
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
              className="btn-gradient w-full px-4 py-2.5 text-sm disabled:opacity-50 cursor-pointer"
            >
              {t.signup.continue}
            </button>
          </form>

          <div className="border-t border-[var(--tq-border-hairline)] pt-4 text-center text-sm text-muted">
            {t.signup.haveAccount}
            <Link href={localizedHref("/login", locale)} className="text-foreground hover:underline cursor-pointer">
              {t.signup.login}
            </Link>
          </div>
        </>
      ) : (
        /* ─── Step 2: name + password (email path only) ───────────── */
        <>
          <button
            type="button"
            // Disabled while a submit is in flight — same as the other controls.
            // Otherwise Back could return to step 1 (and let the email be
            // edited) while signUp is still pending, so the resolving request
            // flips to the confirm screen / navigates with a now-stale email.
            disabled={loading}
            onClick={() => {
              setStep(1);
              setError(null);
            }}
            className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${dir === "rtl" ? "rotate-180" : ""}`}
              aria-hidden
            >
              arrow_back
            </span>
            {t.signup.back}
          </button>

          <div className="text-start">
            <h1 className="text-2xl font-bold">{t.signup.detailsTitle}</h1>
            {/* The email chosen in step 1. No dir override, so it aligns with
                the headline (start of the page direction — right in RTL); a
                Latin address still reads left-to-right via the bidi algorithm
                since it sits alone in its element. */}
            <p className="mt-1 text-sm text-muted">{email}</p>
          </div>

          <form onSubmit={handleEmailSignup} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.signup.nameLabel}</label>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.signup.namePlaceholder}
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
              {/* Live requirements checklist. */}
              <div className="mt-2 space-y-1.5 rounded-xl border border-[var(--tq-border-hairline)] bg-overlay-soft p-3">
                <p className={`text-xs font-medium ${pwAllMet ? "text-foreground" : "text-muted"}`}>
                  {pwAllMet ? t.signup.pwReqMet : t.signup.pwReqTitle}
                </p>
                {pwReqs.map((r) => (
                  <div
                    key={r.key}
                    className={`flex items-center gap-2 text-xs transition-colors ${
                      r.met ? "text-foreground" : "text-foreground/30"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    <span>{r.label}</span>
                  </div>
                ))}
              </div>
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
              disabled={loading || !pwAllMet}
              className="btn-gradient w-full px-4 py-2.5 text-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? t.signup.submitting : t.signup.submit}
            </button>
          </form>
        </>
      )}
    </motion.div>
  );
}
