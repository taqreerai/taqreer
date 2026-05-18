// Shared types for itshover-style animated icons. The on-disk shape
// matches the upstream registry so `npx shadcn@latest add
// https://itshover.com/r/<name>.json` drops new icons into
// components/icons/ with zero rework — they reference these types as
// "./types".

export type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

export type AnimatedIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  // Auto-play the icon's in-animation once when it mounts. Useful
  // for state-driven moments ("extraction succeeded") where there's
  // no hover gesture to trigger the icon. Default: false (hover-only,
  // matching the upstream registry shape).
  playOnMount?: boolean;
};
