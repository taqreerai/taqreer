"use client";

import { useEffect, useState } from "react";
import { sampleManifest } from "@/lib/test/sample-manifest";
import { SlideManifestSchema } from "@/lib/schema/slide";
import { SlideManifest, SlideType, SlideElementType } from "@/lib/schema/slide";

// ─── Slide Renderer ───────────────────────────────────────────────────────────

function SlideElement({ el }: { el: SlideElementType }) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity ?? 1,
  };

  if (el.type === "text") {
    return (
      <div
        style={{
          ...base,
          fontFamily: `'${el.fontFamily}', Cairo, sans-serif`,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight ?? 400,
          color: el.color,
          textAlign: el.textAlign,
          direction: el.direction,
          lineHeight: el.lineHeight ?? 1.5,
          fontStyle: el.italic ? "italic" : "normal",
          textDecoration: el.underline ? "underline" : "none",
          backgroundColor: el.background ?? "transparent",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {el.content}
      </div>
    );
  }

  if (el.type === "shape") {
    let background = "transparent";
    if (el.fill?.type === "color") {
      background = el.fill.value;
    } else if (el.fill?.type === "gradient") {
      const { stops, angle } = el.fill.gradient;
      background = `linear-gradient(${angle}deg, ${stops[0].color} ${stops[0].position}%, ${stops[1].color} ${stops[1].position}%)`;
    }

    const borderRadius =
      el.kind === "circle" || el.kind === "ellipse" ? "50%" :
      el.border?.radius ? `${el.border.radius}px` : undefined;

    return (
      <div
        style={{
          ...base,
          background,
          borderRadius,
          border: el.border
            ? `${el.border.width}px ${el.border.style} ${el.border.color}`
            : undefined,
        }}
      />
    );
  }

  if (el.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={el.src}
        alt=""
        style={{
          ...base,
          objectFit: el.objectFit ?? "contain",
        }}
      />
    );
  }

  return null;
}

function SlideRenderer({
  slide,
  manifest,
  scale = 1,
}: {
  slide: SlideType;
  manifest: SlideManifest;
  scale?: number;
}) {
  // Load custom fonts via @font-face
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @font-face {
        font-family: '${manifest.fonts.heading.name}';
        src: url('${manifest.fonts.heading.url}') format('woff2');
        font-display: swap;
      }
      @font-face {
        font-family: '${manifest.fonts.body.name}';
        src: url('${manifest.fonts.body.url}') format('woff2');
        font-display: swap;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, [manifest.fonts]);

  let background = slide.background.type === "color"
    ? slide.background.value
    : `linear-gradient(${slide.background.gradient.angle}deg, ${slide.background.gradient.stops[0].color}, ${slide.background.gradient.stops[1].color})`;

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        position: "relative",
        background,
        transformOrigin: "top right", // RTL: always top right
        transform: `scale(${scale})`,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {slide.elements.map((el) => (
        <SlideElement key={el.id} el={el} />
      ))}
    </div>
  );
}

// ─── Test Page ────────────────────────────────────────────────────────────────

export default function PipelineTestPage() {
  const [validation, setValidation] = useState<{
    success: boolean;
    errors?: string[];
  } | null>(null);

  useEffect(() => {
    const result = SlideManifestSchema.safeParse(sampleManifest);
    if (result.success) {
      setValidation({ success: true });
    } else {
      setValidation({
        success: false,
        errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      });
    }
  }, []);

  const PREVIEW_SCALE = 0.35;
  const THUMB_SCALE = 0.15;

  return (
    <div
      style={{
        background: "#03030D",
        minHeight: "100vh",
        padding: "40px",
        fontFamily: "Cairo, sans-serif",
        direction: "rtl",
        color: "#FFFFFF",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>
        🔍 Taqreer Pipeline Validation Test
      </h1>
      <p style={{ color: "#9A94A8", marginBottom: 40 }}>
        This page validates the full JSON → HTML/CSS rendering pipeline with Arabic fonts.
      </p>

      {/* Zod Validation Result */}
      <div
        style={{
          background: validation?.success ? "#0a2a0a" : "#2a0a0a",
          border: `1px solid ${validation?.success ? "#22c55e" : "#ef4444"}`,
          borderRadius: 8,
          padding: "16px 24px",
          marginBottom: 40,
        }}
      >
        <strong>Zod Schema Validation:</strong>{" "}
        {validation === null
          ? "جارٍ التحقق..."
          : validation.success
          ? "✅ JSON manifest is valid"
          : `❌ Validation failed: ${validation.errors?.join(", ")}`}
      </div>

      {/* Full Preview Slides */}
      <h2 style={{ fontSize: 24, marginBottom: 16 }}>Preview (scale {PREVIEW_SCALE}x)</h2>
      <p style={{ color: "#9A94A8", fontSize: 14, marginBottom: 24 }}>
        Verify: Arabic letters are connected • Font is Cairo • RTL alignment is correct
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 60, marginBottom: 80 }}>
        {sampleManifest.slides.map((slide) => (
          <div key={slide.slideId}>
            <p style={{ color: "#9A94A8", fontSize: 14, marginBottom: 8 }}>
              {slide.slideId} — {slide.role}
            </p>
            <div
              style={{
                width: 1920 * PREVIEW_SCALE,
                height: 1080 * PREVIEW_SCALE,
                overflow: "hidden",
                borderRadius: 8,
                border: "1px solid rgba(42,36,59,0.8)",
              }}
            >
              <SlideRenderer
                slide={slide}
                manifest={sampleManifest}
                scale={PREVIEW_SCALE}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Thumbnails */}
      <h2 style={{ fontSize: 24, marginBottom: 16 }}>Thumbnails (scale {THUMB_SCALE}x)</h2>
      <p style={{ color: "#9A94A8", fontSize: 14, marginBottom: 24 }}>
        Verify: text is readable • no blurry or jumpy text • scaling origin is correct (top right)
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {sampleManifest.slides.map((slide) => (
          <div key={slide.slideId}>
            <div
              style={{
                width: 1920 * THUMB_SCALE,
                height: 1080 * THUMB_SCALE,
                overflow: "hidden",
                borderRadius: 4,
                border: "1px solid rgba(42,36,59,0.8)",
              }}
            >
              <SlideRenderer
                slide={slide}
                manifest={sampleManifest}
                scale={THUMB_SCALE}
              />
            </div>
            <p style={{ color: "#9A94A8", fontSize: 11, marginTop: 4, textAlign: "center" }}>
              {slide.slideId}
            </p>
          </div>
        ))}
      </div>

      {/* Checklist */}
      <div
        style={{
          marginTop: 80,
          background: "#0F0B1E",
          border: "1px solid rgba(42,36,59,0.8)",
          borderRadius: 8,
          padding: "24px 32px",
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>Validation Checklist</h2>
        <ul style={{ listStyle: "none", padding: 0, lineHeight: 2.2, color: "#9A94A8" }}>
          <li>☐ Arabic text is connected (مرحباً — not broken letters)</li>
          <li>☐ Font is Cairo (not a system fallback)</li>
          <li>☐ RTL direction is correct (text starts from the right)</li>
          <li>☐ Colors match the palette (#03030D background, #370BF4 blue)</li>
          <li>☐ Thumbnails scale correctly without blurry text</li>
          <li>☐ Gradient shapes render correctly</li>
          <li>☐ Zod validation shows ✅ above</li>
        </ul>
      </div>
    </div>
  );
}
