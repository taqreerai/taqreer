"use client";

// Cloudflare Turnstile (explicit rendering). Loads the API script once, renders
// a managed widget, and reports the verification token via `onVerify`. The token
// is single-use, so bump `resetKey` after a failed submit to fetch a fresh one.
// Theme follows the app's chrome (`.light` class), not the OS.
//
// Self-disables (renders nothing, reports an empty token) when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so local dev without the key isn't
// blocked. The SECRET key is configured in the Supabase Auth dashboard (native
// captcha) and never ships in the client bundle.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  onVerify,
  onExpire,
  resetKey,
  className,
}: {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  // Change this value to force a fresh challenge (token is single-use).
  resetKey?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  // Keep the latest callbacks in refs so the render effect can run once without
  // capturing stale closures (and without re-rendering the widget every keypress).
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!SITE_KEY || !el) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || !el) return;
        widgetId.current = window.turnstile.render(el, {
          sitekey: SITE_KEY,
          theme: document.documentElement.classList.contains("light")
            ? "light"
            : "dark",
          size: "flexible",
          callback: (token: string) => onVerifyRef.current(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => onExpireRef.current?.(),
        });
      })
      .catch(() => {
        /* offline / blocked — leave the gate closed (no token). */
      });
    return () => {
      cancelled = true;
      if (window.turnstile && widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
        widgetId.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (resetKey === undefined) return;
    if (window.turnstile && widgetId.current) {
      try {
        window.turnstile.reset(widgetId.current);
      } catch {
        /* nothing to reset yet */
      }
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className={className} />;
}

// Whether the captcha gate is active. When the site key is absent (local dev),
// callers should NOT block submission on a token.
export const TURNSTILE_ENABLED = Boolean(SITE_KEY);
