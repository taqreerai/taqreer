import Image from "next/image";

// App wordmark that flips with the theme. `/logo-light.svg` is the all-white
// mark (reads on dark surfaces); `/logo-dark.svg` is the brand-coloured mark
// (reads on light surfaces). Both are rendered and the right one is shown via
// CSS keyed on `:root.light` (see globals.css `.logo-on-dark` / `.logo-on-light`)
// — SSR-safe, no hydration flash, no client theme read.
export function ThemeLogo({
  width,
  height,
  className = "",
  priority = false,
  alt = "taqreer.ai logo",
}: {
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  return (
    <>
      <Image
        src="/logo-light.svg"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={`logo-on-dark ${className}`}
      />
      <Image
        src="/logo-dark.svg"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={`logo-on-light ${className}`}
      />
    </>
  );
}
