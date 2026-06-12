"use client";

// The avatar disc + credit ring - extracted from Sidebar (2026-06-12) so
// the studio header renders the IDENTICAL avatar (ring included). Pure
// visual: the consumer wraps it in its own button/anchor.

import Image from "next/image";
import { useUser } from "@/hooks/useUser";
import { useCreditBalance, formatCredits } from "@/lib/credits/store";
import { useDict } from "@/components/i18n/LocaleProvider";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { CreditRing } from "@/components/app/CreditRing";

export function ProfileAvatar() {
  const dict = useDict();
  const { user, loading: userLoading, avatarUrl, name, email } = useUser();
  const credits = useCreditBalance();
  const creditFraction =
    credits && credits.capacity > 0
      ? credits.balance.total / credits.capacity
      : null;

  return (
    <div className="relative w-[40px] h-[40px] flex justify-center items-center flex-shrink-0">
      {/* Credit ring - at-a-glance used-vs-remaining around the avatar.
          Same store as the menu breakdown + settings card; hidden until
          the first balance fetch lands. */}
      {creditFraction !== null && credits ? (
        <CreditRing
          fraction={creditFraction}
          label={dict.components.credits.ringLabel
            .replace("{remaining}", formatCredits(credits.balance.total))
            .replace("{total}", formatCredits(credits.capacity))}
        />
      ) : null}
      {userLoading ? (
        // Neutral placeholder until the auth user lands - no letter, no
        // per-user gradient, so there's no "U" → avatar swap flash on
        // reload (user direction 2026-06-11).
        <div className="w-[36px] h-[36px] rounded-full bg-[var(--tq-surface)]" />
      ) : avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name}
          width={36}
          height={36}
          // `no-referrer` for Google profile pics - without it
          // lh3.googleusercontent.com 403s in incognito (hotlink defence
          // vs our global Referrer-Policy). Same fix as common/Avatar.
          referrerPolicy="no-referrer"
          className="w-[36px] h-[36px] rounded-full object-cover tq-avatar-ring"
        />
      ) : (
        <div
          // Per-user gradient via hash(seed) - same picker the presence
          // avatars use, so dashboard + editor render the same person
          // the same colour.
          className="w-[36px] h-[36px] rounded-full tq-avatar-fallback text-sm"
          style={{
            backgroundImage: avatarGradientForSeed(user?.id ?? email ?? name),
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}
