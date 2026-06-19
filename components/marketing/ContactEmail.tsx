"use client";

import { useSyncExternalStore } from "react";

// Contact email that never exposes a plaintext address (or a mailto: link) in
// the static HTML — spam harvesters scrape page source for both. The literal
// address is assembled CLIENT-side only: SSR / pre-hydration ships an obfuscated
// "support [at] taqreer.ai" (no "@", no mailto, still human-usable with JS off),
// and after hydration it becomes a real clickable mailto. useSyncExternalStore
// (not a mount effect) keeps it hydration-safe and satisfies the project's
// set-state-in-effect lint rule. Brand stays "taqreer.ai" in both locales.

const USER = "support";
const DOMAIN = "taqreer.ai";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ContactEmail({ className }: { className?: string }) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) {
    return (
      <span className={className} dir="ltr">
        {USER} [at] {DOMAIN}
      </span>
    );
  }

  const email = `${USER}@${DOMAIN}`;
  return (
    <a className={className} href={`mailto:${email}`} dir="ltr">
      {email}
    </a>
  );
}
