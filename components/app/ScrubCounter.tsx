// Scrub counter chip — "{index+1} / {total}" pinned to the bottom-end
// (left in RTL) of a slide-scrub surface. Shared by ProjectThumbnail +
// TemplateTile; render it only while actively scrubbing. The parent must
// be `position: relative` (both tile surfaces are).

export function ScrubCounter({
  index,
  total,
}: {
  index: number;
  total: number;
}) {
  return (
    <span
      dir="ltr"
      className="pointer-events-none absolute bottom-2 end-2 z-10 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground"
    >
      {index + 1} / {total}
    </span>
  );
}
