// Browser-side manager for the Realtime authorization token.
//
// One token per tab covers every private channel: the `topics` claim
// always carries the signed-in user's `user:{supabaseUserId}` topic and,
// while a project is open, that `project:{id}` topic too. The manager
//
//   - fetches /api/realtime/token (lazily, deduped, cached until ~5 min
//     before expiry, auto-refreshed after),
//   - feeds the realtime socket via the client's `accessToken` callback
//     (see supabase-browser.ts), and
//   - pushes fresh tokens to ALREADY-JOINED channels with
//     `realtime.setAuth()` so re-mints (refresh, project open/close)
//     re-run the server-side policies without re-subscribing.
//
// When the server reports `enabled: false` (SUPABASE_JWT_SECRET not
// configured yet) the manager remembers that for the tab's lifetime and
// every channel falls back to PUBLIC mode - the pre-hardening status
// quo - so the rollout switch lives entirely server-side.

type MintedToken = {
  token: string;
  expiresAt: number;
  topics: string[];
};

// Refresh this long before expiry so a token never goes stale mid-join.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let enabled: boolean | null = null;
let current: MintedToken | null = null;
let activeProjectId: string | null = null;
let inFlight: Promise<MintedToken | null> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// supabase-browser.ts registers the socket's setAuth here at client
// creation. A callback (not an import) to avoid a module cycle - the
// client's accessToken option already imports this module.
let pushAuth: ((token: string) => void) | null = null;

export function bindRealtimeAuthPush(fn: (token: string) => void): void {
  pushAuth = fn;
}

function isFresh(token: MintedToken | null): token is MintedToken {
  return token !== null && Date.now() < token.expiresAt - REFRESH_MARGIN_MS;
}

function scheduleRefresh(token: MintedToken): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(30_000, token.expiresAt - REFRESH_MARGIN_MS - Date.now());
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void mint();
  }, delay);
}

async function mint(): Promise<MintedToken | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const qs = activeProjectId
        ? `?projectId=${encodeURIComponent(activeProjectId)}`
        : "";
      const res = await fetch(`/api/realtime/token${qs}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        enabled: boolean;
        token: string | null;
        expiresAt: number | null;
        topics: string[];
      };
      enabled = data.enabled;
      if (!data.enabled || !data.token || !data.expiresAt) return null;
      current = {
        token: data.token,
        expiresAt: data.expiresAt,
        topics: data.topics,
      };
      scheduleRefresh(current);
      pushAuth?.(current.token);
      return current;
    } catch {
      // Network blip - callers fall back to whatever token they have;
      // a stale token fails closed at the socket, and the app's status
      // polls cover the gap.
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Whether private-channel mode is on. Forces one mint round-trip the
 * first time it's called in a tab.
 */
export async function realtimePrivateMode(): Promise<boolean> {
  if (enabled === null) await mint();
  return enabled === true;
}

/**
 * The `accessToken` callback for the realtime client. Returns the
 * cached minted token (refreshing when stale); null when private mode
 * is off or minting is unavailable - the socket then runs with the
 * anon key exactly as before the hardening.
 */
export async function getRealtimeAccessToken(): Promise<string | null> {
  if (enabled === false) return null;
  if (isFresh(current)) return current.token;
  const minted = await mint();
  return minted?.token ?? null;
}

/**
 * Ensure the tab's token covers `project:{projectId}` BEFORE the
 * project channel subscribes. Returns false when the server refused
 * the topic (no access) while private mode is on.
 */
export async function ensureProjectTopic(projectId: string): Promise<boolean> {
  activeProjectId = projectId;
  const minted = await mint();
  if (enabled === false) return true; // public mode - nothing to ensure
  return minted?.topics.includes(`project:${projectId}`) ?? false;
}

/**
 * Stop including the project topic in future re-mints (DeckView
 * unmount). The current token keeps it until natural expiry - access
 * revocation mid-session is handled by share.revoked + the next mint.
 */
export function releaseProjectTopic(projectId: string): void {
  if (activeProjectId === projectId) activeProjectId = null;
}
