// The page's primary CTA repeated between sections (user direction 2026-10-01:
// CTAs throughout every marketing page to maximize conversion). Same pill as
// the hero CTA so every repeat reads as the one action of the page.

export function RepeatCta({ href, label }: { href: string; label: string }) {
  return (
    <div className="flex justify-center">
      <a
        href={href}
        className="btn-gradient-anim inline-block rounded-full px-8 py-3 text-sm font-medium"
      >
        {label}
      </a>
    </div>
  );
}
