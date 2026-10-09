"use client";

// The email / Google sign-up form, shared by the /signup page (inside the
// auth-layout modal, which owns the wordmark + legal fine print) and the
// creation tools' sign-up window (GuestSignupDialog, 2026-10-07 owner
// direction: one design, one copy, one flow). In the window the whole sign-up,
// confirmation code included, happens without leaving the tool, so the
// visitor's setup is never left behind.
//
// Single-step email signup (user direction 2026-06-16): name + email + password
// with a LIVE requirements checklist. Cloudflare Turnstile (Supabase-native
// captcha) gates the submit + the resend. A "Continue with Google" button
// (shared GoogleAuthButton, same OAuth flow as login) sits above the email form;
// the /callback route creates the account on first Google sign-in. Left-aligned
// eyebrow + title, then the fields.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import {
  TurnstileWidget,
  TURNSTILE_ENABLED,
} from "@/components/auth/TurnstileWidget";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm({
  nextUrl,
  templateId,
  loginHref,
  title,
  googleNextUrl,
  hardRedirect = false,
}: {
  // Where to land once signed in (already guarded by the caller).
  nextUrl: string;
  templateId: string | null;
  loginHref: string;
  // Step-1 heading override (the creation-tool window); the /signup page keeps
  // the default.
  title?: string;
  // GoogleAuthButton target when the host is not an auth page.
  googleNextUrl?: string;
  // Full page load on finish: the window's tool page must remount to read
  // its saved draft (a same-route push keeps the stale guest page).
  hardRedirect?: boolean;
}) {
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

  // Confirm-screen code entry (2026-10-07, owner direction): the confirmation
  // email also carries a one-time code, so the user finishes HERE, in the tab
  // that holds their unsaved work (a /create guest draft), even when they read
  // the email on another device. `finishing` guards the one-time redirect
  // (code submit and the cross-tab poll below can race).
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const finishing = useRef(false);

  const supabase = createClient();
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

  // Signed in (session just created): sync the Prisma row, then go back to
  // where the sign-up started. Both a transport error and a non-2xx block the
  // redirect (otherwise /dashboard 404-cascades). Returns false on a failed
  // sync so the caller can show it.
  const completeSignIn = async (): Promise<boolean> => {
    if (finishing.current) return true;
    finishing.current = true;
    let syncOk = false;
    try {
      const res = await fetch("/api/auth/user-sync", { method: "POST" });
      syncOk = res.ok;
      if (!res.ok) console.error("[signup] user-sync failed", { status: res.status });
    } catch (err) {
      console.error("[signup] user-sync failed", err);
    }
    if (!syncOk) {
      finishing.current = false;
      return false;
    }
    const target = templateId ? `${nextUrl}?template=${templateId}` : nextUrl;
    if (hardRedirect) {
      window.location.assign(target);
    } else {
      router.push(target);
      router.refresh();
    }
    return true;
  };

  // The code from the confirmation email (6 digits by default; Supabase lets
  // the project set 6 to 10).
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying || code.length < 6) return;
    setCodeError(null);
    setVerifying(true);
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (otpError) {
        setCodeError(t.signup.codeInvalid);
        return;
      }
      if (!(await completeSignIn())) setCodeError(t.accountPrepFailed);
    } catch (err) {
      console.error("[signup] code verify failed", err);
      setCodeError(t.errorGeneric);
    } finally {
      setVerifying(false);
    }
  };

  // Confirmed in ANOTHER tab of this browser (the email link): that tab's
  // /confirm set the session cookie, so this tab sees a session and carries
  // on by itself instead of sitting on "check your email". Checked every few
  // seconds and whenever the tab regains focus. setState only runs in the
  // async callbacks (no synchronous set in the effect).
  useEffect(() => {
    if (!success) return;
    let stopped = false;
    const check = async () => {
      if (stopped || finishing.current) return;
      const { data } = await supabase.auth.getSession();
      if (!stopped && data.session && !(await completeSignIn())) {
        setCodeError(t.accountPrepFailed);
      }
    };
    const id = window.setInterval(() => void check(), 4000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
    // supabase / completeSignIn are recreated each render; the poll only
    // needs to restart when the confirm screen appears or goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success]);

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
          // resume_to: where /confirm sends the emailed link back to (e.g.
          // /create?resume=generate). Kept on the account, not in the email
          // link: a URL nested in a link reads as phishing to Outlook.
          data: {
            full_name: name,
            name,
            lang: locale,
            resume_to: templateId ? `${nextUrl}?template=${templateId}` : nextUrl,
          },
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
        // Email confirmation disabled - session returned immediately.
        if (!(await completeSignIn())) setError(t.accountPrepFailed);
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
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) {
      setError(t.signup.invalidEmail);
      return;
    }
    // Throwaway inboxes are refused up front (2026-10-02). Fail-open on a
    // network error: the signup-grant guard still withholds free credits.
    try {
      const res = await fetch("/api/auth/email-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok && ((await res.json()) as { disposable?: boolean }).disposable) {
        setError(t.signup.disposableEmail);
        return;
      }
    } catch {
      /* fail-open */
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
        <p className="text-sm text-muted">{t.signup.codeBody}</p>

        {/* The code from the email: finishes sign-up in this tab. */}
        <form onSubmit={handleVerifyCode} className="mt-1 flex w-full max-w-[300px] flex-col gap-2.5">
          <label htmlFor="signup-code" className="sr-only">
            {t.signup.codeLabel}
          </label>
          <input
            id="signup-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            maxLength={10}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 10));
              setCodeError(null);
            }}
            placeholder="000000"
            className="input-dark cursor-text text-center text-xl font-semibold tracking-[0.4em] tabular-nums"
          />
          <button
            type="submit"
            disabled={verifying || code.length < 6}
            className="btn-gradient w-full px-4 py-2.5 text-sm disabled:opacity-50 cursor-pointer"
          >
            {verifying ? t.signup.codeVerifying : t.signup.codeSubmit}
          </button>
          {codeError ? (
            <p className="text-xs text-red-400" role="alert">
              {codeError}
            </p>
          ) : null}
        </form>

        <p className="text-xs text-muted">{t.signup.codeOrLink}</p>
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
          href={loginHref}
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
            <h1 className="text-2xl font-bold">{title ?? t.signup.title}</h1>
          </div>

          <GoogleAuthButton
            disabled={loading}
            onError={setError}
            onBusyChange={setLoading}
            nextUrl={googleNextUrl}
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
            <Link href={loginHref} className="text-foreground hover:underline cursor-pointer">
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
