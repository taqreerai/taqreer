// Shared user-avatar atom.
//
// Two render modes, picked by whether `image` is set:
//   • Image avatar  → <img> at `size × size`, rounded full, object-cover.
//                     Used when User.image is populated (Google OAuth
//                     signups get this for free).
//   • Initial avatar → first letter of `name` (or "?" if missing) on a
//                     deterministic per-user gradient. Used for
//                     email/password signups who never set an image,
//                     and for anonymous public-view callers.
//
// The gradient is picked from a 4-token rotation in globals.css via
// `lib/util/avatar-gradient.ts` — same seed always yields the same
// gradient, so a user is visually stable across CommentsPanel rows,
// presence avatars in SlideNavSidebar, and any future bell-row author
// chips.
//
// `inactive` (used by presence) drops opacity to 0.4 with no transition
// — the dim should snap on/off as soon as visibilitychange fires.

import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";

type Props = {
  // Display name. First letter is used for the initial fallback;
  // falls back to "?" if absent / whitespace-only.
  name: string | null;
  // Image URL. When set, an <img> is rendered instead of the gradient
  // + initial. null = no image, render the fallback.
  image: string | null;
  // Stable id used as the gradient seed (prefer prisma User.id).
  // Falls back to `name` when omitted — same user with name but no id
  // still gets a deterministic gradient.
  seedId?: string | null;
  // Display size in pixels. 24 matches CommentsPanel's row chip; 20
  // matches the presence-stack chip on slide thumbnails.
  size?: number;
  // Reduce opacity to 40 %. Drives the "tab inactive" dim on presence
  // avatars. No transition — visibilitychange should feel instant.
  inactive?: boolean;
  // Optional ring colour (e.g. white/40 separator when stacking).
  ringColor?: string;
};

export function Avatar({
  name,
  image,
  seedId,
  size = 24,
  inactive = false,
  ringColor,
}: Props) {
  const dim = inactive ? { opacity: 0.4 } : null;
  const ring = ringColor
    ? { boxShadow: `0 0 0 1px ${ringColor}` }
    : null;
  // Combine inline styles — fixed pixel size (so consumers can mix
  // 20/24/28 freely without writing six wrapper components).
  const sizeStyle = { width: size, height: size, flexShrink: 0 } as const;

  if (image) {
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        // `no-referrer` so `lh3.googleusercontent.com` (Google profile
        // pics) and other privacy-sensitive image hosts don't 403 the
        // request. Our next.config sets a `Referrer-Policy: origin-
        // when-cross-origin` header for the whole site, which Google's
        // CDN sometimes flags as a hotlink in incognito (no Google
        // session cookie → strict mode). The user's profile pic IS
        // public when they sign in with Google, so removing the
        // referrer is the correct way to load it.
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={{ ...sizeStyle, ...dim, ...ring }}
      />
    );
  }
  // Initial is derived ONLY from `name` (never from `seedId`) — a
  // prisma cuid like `cmphc9dwh0008zbs08vphcafc` would otherwise
  // surface a meaningless "C" or "1" as the chip's letter. When
  // name is missing we fall back to "?" so the chip still has
  // something to render; the gradient still differentiates rows
  // visually even when the letter is the same fallback.
  // Gradient picker still consumes `seedId ?? name` so two users
  // with the same fallback "?" letter get different colours.
  const initial = name?.trim()?.charAt(0).toUpperCase() || "?";
  const gradient = avatarGradientForSeed(seedId ?? name ?? null);
  return (
    <div
      aria-hidden
      // `inline-flex` (not `flex`) — block-level `display: flex` would
      // make the chip grow to fill its parent's inline-size when the
      // parent has no explicit width (e.g. SlidePresenceStack's per-
      // viewer wrapper div). That pulled the left edge of the chip
      // out to the parent's start and made the `start-1` offset on
      // the stack disappear. Inline-flex keeps the chip sized to its
      // explicit `width` style and the inset position holds.
      className="inline-flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        ...sizeStyle,
        ...dim,
        ...ring,
        // Font size scales roughly with the chip — 10/24 ≈ 0.42, so
        // a 20-px chip lands at ~8.5 px, a 28-px chip at ~12 px.
        fontSize: Math.round(size * 0.42),
        // Literal `linear-gradient(...)` string from
        // `avatarGradientForSeed` — bypasses the CSS-var indirection
        // that silently failed to paint as a background-image in
        // some Chrome paint paths (the symptom: chip rendered with
        // a transparent fill, only the white ring + initial showed).
        // Longhand `backgroundImage` (not `background` shorthand)
        // keeps any future `backgroundColor` override predictable.
        backgroundImage: gradient,
      }}
    >
      {initial}
    </div>
  );
}
