// Disposable / throwaway inbox detection (2026-10-02). Backed by the
// community-maintained `disposable-email-domains` list (~120k domains +
// wildcard roots). SERVER-ONLY: the list is large, so it never ships to the
// client; the signup form asks POST /api/auth/email-check instead.

import "server-only";
import domains from "disposable-email-domains";
import wildcards from "disposable-email-domains/wildcard.json";

let exact: Set<string> | null = null;
let roots: Set<string> | null = null;

/** True when the address's domain (or any parent domain) is a throwaway. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  exact ??= new Set(domains as string[]);
  roots ??= new Set(wildcards as string[]);
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (exact.has(candidate)) return true;
    if (i > 0 && roots.has(candidate)) return true;
  }
  return roots.has(domain);
}
