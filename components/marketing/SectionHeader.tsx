// Centered (or start-aligned) marketing section header: optional eyebrow + h2 +
// optional subtitle. Shared by the landing and the marketing spoke pages so the
// section-heading rhythm stays identical. Pure/presentational (server-safe).

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "right";
}) {
  const isCenter = align === "center";
  return (
    <div className={isCenter ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {eyebrow ? (
        <span className="mb-3 block text-sm font-semibold text-[var(--tq-violet)]">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="mb-4 text-balance text-3xl font-medium md:text-4xl">{title}</h2>
      {subtitle ? (
        <p className="text-lg leading-relaxed text-muted">{subtitle}</p>
      ) : null}
    </div>
  );
}
