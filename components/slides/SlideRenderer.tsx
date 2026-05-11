"use client";

import type { SlideType, SlideElementType } from "@/lib/schema/slide";

type Background =
  | { type: "color"; value: string }
  | { type: "gradient"; gradient: { type: "linear"; angle: number; stops: [{ color: string; position: number }, { color: string; position: number }] } };

function backgroundToCss(bg: Background | undefined): string {
  if (!bg) return "transparent";
  if (bg.type === "color") return bg.value;
  const [s0, s1] = bg.gradient.stops;
  return `linear-gradient(${bg.gradient.angle}deg, ${s0.color} ${s0.position}%, ${s1.color} ${s1.position}%)`;
}

function shapeClipPath(kind: string): string | undefined {
  switch (kind) {
    case "triangle":
      return "polygon(50% 0%, 0% 100%, 100% 100%)";
    default:
      return undefined;
  }
}

function shapeBorderRadius(kind: string): string | undefined {
  switch (kind) {
    case "circle":
    case "ellipse":
      return "50%";
    default:
      return undefined;
  }
}

function ElementView({ element }: { element: SlideElementType }) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    opacity: element.opacity ?? 1,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
  };

  if (element.type === "text") {
    return (
      <div
        style={{
          ...baseStyle,
          color: element.color,
          fontFamily: `"${element.fontFamily}", "Cairo", "Poppins", system-ui, sans-serif`,
          fontSize: `${element.fontSize}px`,
          fontWeight: element.fontWeight ?? 400,
          fontStyle: element.italic ? "italic" : "normal",
          textDecoration: element.underline ? "underline" : "none",
          textAlign: element.textAlign,
          direction: element.direction,
          lineHeight: element.lineHeight ?? 1.5,
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
          backgroundColor: element.background,
        }}
      >
        {element.content}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={element.src}
        alt=""
        style={{
          ...baseStyle,
          objectFit: element.objectFit ?? "contain",
        }}
      />
    );
  }

  // shape
  const fillCss = backgroundToCss(element.fill);
  return (
    <div
      style={{
        ...baseStyle,
        background: fillCss,
        borderRadius: shapeBorderRadius(element.kind),
        clipPath: shapeClipPath(element.kind),
      }}
    />
  );
}

export function SlideRenderer({
  slide,
  width = 1920,
  height = 1080,
  scale = 1,
}: {
  slide: SlideType;
  width?: number;
  height?: number;
  scale?: number;
}) {
  const isRtl = slide.elements.some(
    (e) => e.type === "text" && e.direction === "rtl",
  );
  return (
    <div
      style={{
        width: `${width * scale}px`,
        height: `${height * scale}px`,
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          position: "relative",
          transform: `scale(${scale})`,
          transformOrigin: isRtl ? "top right" : "top left",
          background: backgroundToCss(slide.background),
        }}
      >
        {slide.elements.map((element) => (
          <ElementView key={element.id} element={element} />
        ))}
      </div>
    </div>
  );
}
