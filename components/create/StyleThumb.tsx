"use client";

// Illustrated deck-style thumbnails (2026-10-05, replacing the monochrome
// block sketches): each style is a small 16:9 mini slide in its OWN colour
// mood with a sample headline, so the gallery reads like real slides (as
// inviting as the template thumbnails). These colours are preview content,
// like a template screenshot, not app chrome; the generated deck always uses
// the user's brand palette.
//
// Logical insets (insetInlineStart/End) + the locale dir mirror every layout
// for Arabic. Type is sized in cqw (container query width) so one markup
// scales from the small tile to the large "show all" card.

import type { CSSProperties, ReactNode } from "react";
import type { DeckStyleKey } from "@/lib/design-styles";

type Pos = {
  top?: string;
  bottom?: string;
  s?: string; // inset-inline-start
  e?: string; // inset-inline-end
  w?: string;
  h?: string;
};

function box(p: Pos, extra: CSSProperties = {}): CSSProperties {
  return {
    position: "absolute",
    top: p.top,
    bottom: p.bottom,
    insetInlineStart: p.s,
    insetInlineEnd: p.e,
    width: p.w,
    height: p.h,
    ...extra,
  };
}

function B(p: Pos & { c: string; r?: number | string; style?: CSSProperties }) {
  return <div style={box(p, { background: p.c, borderRadius: p.r, ...p.style })} />;
}

// A text-line placeholder (rounded bar).
function L(p: Pos & { c: string }) {
  return <div style={box({ h: "3%", ...p }, { background: p.c, borderRadius: 999 })} />;
}

function T(
  p: Pos & { c: string; size: number; weight?: number; children: ReactNode; style?: CSSProperties },
) {
  return (
    <div
      style={box(p, {
        color: p.c,
        fontSize: `${p.size}cqw`,
        fontWeight: p.weight ?? 800,
        lineHeight: 1.05,
        whiteSpace: "nowrap",
        ...p.style,
      })}
    >
      {p.children}
    </div>
  );
}

// Eight-point star (two overlapping squares) for the heritage ornament.
function Star({ size, color, style }: { size: string; color: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" style={{ position: "absolute", width: size, height: size, ...style }}>
      <rect x="4" y="4" width="12" height="12" fill="none" stroke={color} strokeWidth="1.2" />
      <rect x="4" y="4" width="12" height="12" fill="none" stroke={color} strokeWidth="1.2" transform="rotate(45 10 10)" />
    </svg>
  );
}

export function StyleThumb({
  k,
  title,
  dir,
}: {
  k: DeckStyleKey | "auto";
  title: string;
  dir: "rtl" | "ltr";
}) {
  return (
    <div
      dir={dir}
      className="relative w-full overflow-hidden rounded-md border border-[var(--tq-border-hairline)]"
      style={{ aspectRatio: "16/9", containerType: "inline-size" }}
      aria-hidden
    >
      {render(k, title, dir)}
    </div>
  );
}

function render(k: DeckStyleKey | "auto", title: string, dir: "rtl" | "ltr"): ReactNode {
  switch (k) {
    case "auto":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(135deg,#3b82f6,#8b5cf6 55%,#ec4899)" />
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <span className="material-symbols-outlined" style={{ fontSize: "16cqw" }}>
              auto_awesome
            </span>
          </div>
        </>
      );
    case "swiss":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F4F1EA" />
          {[33, 66].map((x) => (
            <B key={x} top="6%" bottom="6%" s={`${x}%`} w="1px" c="#11111133" />
          ))}
          <B top="50%" s="6%" e="6%" h="1px" c="#11111133" />
          <T top="12%" s="7%" c="#111" size={9}>{title}</T>
          <L top="30%" s="7%" w="20%" c="#11111155" />
          <L top="58%" s="38%" w="22%" c="#11111166" />
          <L top="66%" s="38%" w="16%" c="#11111144" />
          <B top="58%" s="7%" w="9%" h="16%" c="#E63B2E" />
          <T bottom="8%" e="6%" c="#111" size={4} weight={700}>01</T>
        </>
      );
    case "corporate":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="100%" h="22%" c="#1E3A5F" />
          <T top="6%" s="6%" c="#fff" size={6.5}>{title}</T>
          {[
            [26, "#CBD5E1"],
            [44, "#14B8A6"],
            [36, "#CBD5E1"],
            [58, "#1E3A5F"],
          ].map(([h, c], i) => (
            <B key={i} bottom="14%" s={`${8 + i * 11}%`} w="8%" h={`${h}%`} c={c as string} />
          ))}
          <B bottom="13%" s="6%" w="48%" h="1px" c="#94A3B8" />
          <B top="32%" e="6%" w="34%" h="22%" c="#F1F5F9" r={3} />
          <T top="35%" e="10%" c="#14B8A6" size={7}><span dir="ltr">+24%</span></T>
          <B top="60%" e="6%" w="34%" h="22%" c="#F1F5F9" r={3} />
          <T top="63%" e="10%" c="#1E3A5F" size={7}>1.2M</T>
        </>
      );
    case "minimal":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#111111" />
          <T top="26%" s="10%" c="#FFFFFF" size={24} weight={800}>86%</T>
          <B top="74%" s="11%" w="10%" h="2.5%" c="#F5B700" />
          <L top="82%" s="11%" w="30%" c="#ffffff55" />
        </>
      );
    case "editorial":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FAF7F2" />
          <B top="0" e="0" w="34%" h="100%" c="linear-gradient(160deg,#D9A066,#8C5A3C)" />
          <T top="12%" s="6%" c="#C0392B" size={3.6} weight={700}>FEATURE</T>
          <T top="20%" s="6%" c="#1A1A1A" size={8.5}>{title}</T>
          <B top="40%" s="6%" w="54%" h="1px" c="#1A1A1A55" />
          {[48, 56, 64, 72].map((t) => (
            <L key={t} top={`${t}%`} s="6%" w={t === 72 ? "30%" : "54%"} c="#1A1A1A33" />
          ))}
        </>
      );
    case "bold":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FF4D2E" />
          <T top="26%" s="-3%" c="#FFFFFF" size={21} weight={900}>{title}</T>
          <L bottom="14%" s="6%" w="28%" c="#ffffffaa" />
          <T bottom="10%" e="5%" c="#fff" size={4} weight={700}>03</T>
        </>
      );
    case "duotone":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(135deg,#2B1055,#D53A9D)" />
          <B top="12%" e="10%" w="34%" h="60%" c="#2B105588" r="50% 50% 8% 8%" />
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(to top,#000000cc,transparent 60%)" />
          <T bottom="20%" s="7%" c="#fff" size={10}>{title}</T>
          <L bottom="11%" s="7%" w="30%" c="#ffffffaa" />
        </>
      );
    case "playful":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFF4D6" />
          <B top="10%" e="8%" w="16%" h="28%" c="#6C63FF" r="50%" />
          <B bottom="-10%" s="-4%" w="22%" h="38%" c="#FFC94D" r="50%" />
          <B top="16%" s="8%" w="56%" h="34%" c="#FF7AB6" r={10} style={{ boxShadow: "4px 4px 0 #1B1B1B" }} />
          <T top="25%" s="12%" c="#1B1B1B" size={8}>{title}</T>
          <B top="58%" s="22%" w="24%" h="28%" c="#FFFFFF" r={8} style={{ boxShadow: "3px 3px 0 #1B1B1B" }} />
          <B top="58%" s="50%" w="24%" h="28%" c="#6C63FF" r={8} style={{ boxShadow: "3px 3px 0 #1B1B1B" }} />
        </>
      );
    case "brutalist":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F2F2F2" />
          <B top="8%" s="6%" w="58%" h="36%" c="#FFE600" style={{ border: "2px solid #111" }} />
          <T top="16%" s="10%" c="#111" size={9} weight={900}>{title}</T>
          <B top="8%" s="66%" e="6%" h="36%" c="#111" />
          <B top="50%" s="6%" e="6%" h="40%" c="transparent" style={{ border: "2px solid #111" }} />
          <L top="60%" s="10%" w="40%" c="#111" />
          <L top="70%" s="10%" w="28%" c="#11111188" />
          <B top="58%" e="10%" w="20%" h="24%" c="#111" style={{ boxShadow: "3px 3px 0 #FFE600" }} />
        </>
      );
    case "classroom":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F0F7FF" />
          <B top="0" s="0" w="100%" h="18%" c="#2F80ED" />
          <T top="4.5%" s="6%" c="#fff" size={6}>{title}</T>
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <B top={`${28 + i * 20}%`} s="6%" w="7%" h="13%" c="#F2994A" r="50%" />
              <T top={`${30 + i * 20}%`} s="8.3%" c="#fff" size={4.5}>{i + 1}</T>
              <L top={`${32 + i * 20}%`} s="16%" w="34%" c="#2F80ED55" />
            </div>
          ))}
          <B top="28%" e="6%" w="34%" h="54%" c="#FFFFFF" r={6} style={{ border: "2px solid #2F80ED" }} />
          <span className="material-symbols-outlined" style={box({ top: "34%", e: "26%" }, { fontSize: "7cqw", color: "#F2994A" })}>
            lightbulb
          </span>
          <L top="58%" e="10%" w="26%" c="#2F80ED44" />
          <L top="66%" e="10%" w="18%" c="#2F80ED44" />
        </>
      );
    case "earlyyears":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFF7E6" />
          <B top="0" s="0" w="100%" h="100%" c="transparent" r={10} style={{ border: "4px solid #4FC3F7" }} />
          <B top="10%" e="8%" w="18%" h="32%" c="#FFC93C" r="50%" style={{ boxShadow: "0 0 0 6px #FFC93C55" }} />
          <B bottom="-34%" s="-6%" w="70%" h="70%" c="transparent" r="50%" style={{ border: "8px solid #FF7A7A", boxShadow: "inset 0 0 0 8px #FFD166, inset 0 0 0 16px #7BD389" }} />
          <T top="20%" s="10%" c="#FF6B6B" size={16} weight={900} style={{ letterSpacing: dir === "ltr" ? "0.05em" : undefined }}>
            {dir === "rtl" ? "أ ب ت" : "A B C"}
          </T>
          <span className="material-symbols-outlined" style={box({ bottom: "12%", e: "14%" }, { fontSize: "12cqw", color: "#7B61FF" })}>
            pets
          </span>
          <span className="material-symbols-outlined" style={box({ top: "52%", e: "34%" }, { fontSize: "7cqw", color: "#FFC93C" })}>
            star
          </span>
        </>
      );
    case "primary":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#E8F7FF" />
          <B top="0" s="0" w="100%" h="20%" c="#FF6B6B" r="0 0 14px 14px" />
          <T top="5%" s="6%" c="#fff" size={6.5}>{title}</T>
          {[
            ["#4CC9F0", "science"],
            ["#80ED99", "calculate"],
            ["#FFB703", "menu_book"],
          ].map(([c, icon], i) => (
            <div key={i}>
              <B top="30%" s={`${6 + i * 20}%`} w="17%" h="32%" c="#FFFFFF" r={8} style={{ border: `2px solid ${c}` }} />
              <span
                className="material-symbols-outlined"
                style={box({ top: "36%", s: `${9.5 + i * 20}%` }, { fontSize: "8cqw", color: c })}
              >
                {icon}
              </span>
            </div>
          ))}
          <L top="70%" s="6%" w="54%" c="#0B486B44" />
          <L top="78%" s="6%" w="40%" c="#0B486B33" />
          <B top="30%" e="5%" w="28%" h="56%" c="#FFE066" r={8} style={{ transform: "rotate(2deg)" }} />
          <T top="38%" e="9%" c="#7A4E00" size={7} weight={900}>?</T>
          <L top="60%" e="9%" w="18%" c="#7A4E0066" />
        </>
      );
    case "middleschool":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="5%" h="100%" c="#7C3AED" />
          <T top="9%" s="10%" c="#1F1147" size={8.5} weight={900}>{title}</T>
          <svg viewBox="0 0 100 56" style={box({ top: "30%", s: "10%", w: "56%", h: "62%" })}>
            <g stroke="#C4B5FD" strokeWidth="1.2">
              <line x1="50" y1="28" x2="16" y2="10" />
              <line x1="50" y1="28" x2="16" y2="46" />
              <line x1="50" y1="28" x2="86" y2="12" />
              <line x1="50" y1="28" x2="86" y2="44" />
            </g>
            <circle cx="50" cy="28" r="11" fill="#7C3AED" />
            <circle cx="16" cy="10" r="7" fill="#22D3EE" />
            <circle cx="16" cy="46" r="7" fill="#F472B6" />
            <circle cx="86" cy="12" r="7" fill="#FACC15" />
            <circle cx="86" cy="44" r="7" fill="#34D399" />
          </svg>
          <B top="30%" e="5%" w="24%" h="24%" c="#22D3EE" r={6} />
          <B top="60%" e="5%" w="24%" h="24%" c="#F472B6" r={6} />
          <span className="material-symbols-outlined" style={box({ top: "35%", e: "13%" }, { fontSize: "8cqw", color: "#fff" })}>
            bolt
          </span>
        </>
      );
    case "highschool":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F8FAFC" />
          <B top="0" s="0" w="100%" h="10%" c="#0F766E" />
          <T top="16%" s="6%" c="#0F172A" size={7.5}>{title}</T>
          <B top="38%" s="6%" w="46%" h="26%" c="#E6FFFA" style={{ borderInlineStart: "4px solid #0F766E" }} />
          <T top="44%" s="10%" c="#0F766E" size={7} weight={700} style={{ fontFamily: "Georgia, serif" }}>
            <span dir="ltr">E = mc²</span>
          </T>
          <L top="72%" s="6%" w="40%" c="#0F172A33" />
          <L top="80%" s="6%" w="30%" c="#0F172A22" />
          <svg viewBox="0 0 40 30" style={box({ top: "28%", e: "6%", w: "34%", h: "56%" })}>
            <path d="M3 2 V27 H38" fill="none" stroke="#334155" strokeWidth="1" />
            <path d="M5 24 C 12 22, 18 12, 24 10 S 33 4, 37 3" fill="none" stroke="#F97316" strokeWidth="1.6" />
          </svg>
        </>
      );
    case "university":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <T top="12%" s="7%" c="#1E293B" size={8} weight={700} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{title}</T>
          <B top="30%" s="7%" w="12%" h="1.5%" c="#9F1239" />
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <T top={`${40 + i * 13}%`} s="7%" c="#9F1239" size={4} weight={700}>{i + 1}</T>
              <L top={`${41 + i * 13}%`} s="12%" w={i === 2 ? "26%" : "36%"} c="#1E293B44" />
            </div>
          ))}
          <B top="24%" e="7%" w="34%" h="56%" c="#F8F7F4" style={{ border: "1px solid #E2E8F0" }} />
          {[30, 52, 40, 64].map((h, i) => (
            <B key={i} bottom="26%" e={`${10 + i * 7.5}%`} w="5%" h={`${h * 0.5}%`} c={i === 3 ? "#9F1239" : "#94A3B8"} />
          ))}
          <B bottom="7%" s="7%" e="7%" h="1px" c="#CBD5E1" />
          <L bottom="3%" s="7%" w="20%" c="#94A3B8" />
        </>
      );
    case "official":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="100%" h="24%" c="#0B3D2E" />
          <B top="24%" s="0" w="100%" h="2%" c="#C8A951" />
          <T top="7%" s="6%" c="#fff" size={6}>{title}</T>
          <B top="5%" e="5%" w="9%" h="16%" c="transparent" r="50%" style={{ border: "1.5px solid #C8A951" }} />
          {[36, 52, 68].map((t, i) => (
            <div key={t}>
              <T top={`${t}%`} s="6%" c="#0B3D2E" size={4} weight={700}>{i + 1}</T>
              <L top={`${t + 1}%`} s="12%" w="40%" c="#0B3D2E44" />
              <B top={`${t + 10}%`} s="6%" w="50%" h="1px" c="#0B3D2E22" />
            </div>
          ))}
          <B top="36%" e="6%" w="30%" h="44%" c="#F5F1E3" style={{ borderTop: "2px solid #C8A951" }} />
          <T top="48%" e="12%" c="#0B3D2E" size={7}>2030</T>
        </>
      );
    case "heritage":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0F3B3A" />
          <B top="5%" s="4%" e="4%" bottom="5%" c="transparent" style={{ border: "1px solid #D4A64A88" }} />
          <Star size="12%" color="#D4A64A" style={{ top: "7%", insetInlineStart: "5%" }} />
          <Star size="12%" color="#D4A64A" style={{ bottom: "7%", insetInlineEnd: "5%" }} />
          <B top="16%" e="12%" w="28%" h="70%" c="linear-gradient(180deg,#D4A64A,#8A5A2B)" r="50% 50% 0 0 / 30% 30% 0 0" />
          <T top="34%" s="10%" c="#F3E3BF" size={9}>{title}</T>
          <B top="56%" s="10%" w="22%" h="1px" c="#D4A64A" />
          <L top="64%" s="10%" w="30%" c="#F3E3BF66" />
        </>
      );
    case "luxury":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0D0D0D" />
          <B top="7%" s="5%" e="5%" bottom="7%" c="transparent" style={{ border: "1px solid #C9A96E" }} />
          <T top="20%" s="12%" c="#C9A96E" size={3.2} weight={500} style={{ letterSpacing: "0.3em" }}>PRIVATE</T>
          <T top="32%" s="12%" c="#F5EFE3" size={10} weight={300}>{title}</T>
          <B top="56%" s="12%" w="14%" h="1px" c="#C9A96E" />
          <B top="22%" e="12%" w="26%" h="56%" c="radial-gradient(circle at 40% 35%,#5a4a32,#141414 70%)" />
        </>
      );
    case "techglass":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0A0F2C" />
          <B top="-20%" e="-6%" w="50%" h="90%" c="radial-gradient(circle,#7B5CFFcc,transparent 65%)" />
          <B bottom="-30%" s="-8%" w="50%" h="90%" c="radial-gradient(circle,#00D1FFaa,transparent 65%)" />
          <T top="14%" s="7%" c="#E6F1FF" size={8.5}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B
              key={i}
              top="46%"
              s={`${7 + i * 30}%`}
              w="26%"
              h="38%"
              c="rgba(255,255,255,0.08)"
              r={6}
              style={{ border: "1px solid rgba(255,255,255,0.25)" }}
            />
          ))}
          <T top="54%" s="11%" c="#00D1FF" size={6}>99.9%</T>
          <L top="72%" s="11%" w="16%" c="#ffffff55" />
        </>
      );
    case "startup":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="16%" s="6%" w="30%" h="17%" c="#C6F432" r={4} />
          <T top="17%" s="7.5%" c="#111" size={9}>{title}</T>
          <L top="40%" s="7%" w="36%" c="#11111133" />
          <B top="52%" s="7%" w="14%" h="9%" c="#6C47FF22" r={999} />
          <B top="52%" s="23%" w="14%" h="9%" c="#6C47FF22" r={999} />
          <B top="16%" e="6%" w="36%" h="70%" c="#F6F5FF" r={10} style={{ boxShadow: "0 4px 12px rgba(17,17,17,0.08)" }} />
          <B top="26%" e="12%" w="10%" h="18%" c="#6C47FF" r="50%" />
          <L top="54%" e="12%" w="24%" c="#6C47FF55" />
          <L top="64%" e="12%" w="18%" c="#6C47FF33" />
        </>
      );
    case "infographic":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F7FAFC" />
          <T top="10%" s="6%" c="#0F172A" size={7.5}>{title}</T>
          {[
            ["#14B8A6", "groups", "12K"],
            ["#F59E0B", "trending_up", "48%"],
            ["#6366F1", "public", "30"],
          ].map(([c, icon, n], i) => (
            <div key={i}>
              <B top="38%" s={`${6 + i * 22}%`} w="14%" h="25%" c={c} r="50%" />
              <span
                className="material-symbols-outlined"
                style={box({ top: "42.5%", s: `${8.8 + i * 22}%` }, { fontSize: "7cqw", color: "#fff" })}
              >
                {icon}
              </span>
              <T top="68%" s={`${7 + i * 22}%`} c={c} size={5}>{n}</T>
            </div>
          ))}
          <B top="30%" e="7%" w="22%" h="40%" c="conic-gradient(#14B8A6 0 65%,#E2E8F0 65% 100%)" r="50%" />
          <B top="38%" e="12.5%" w="11%" h="20%" c="#F7FAFC" r="50%" />
        </>
      );
    case "sketch":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFDF5" />
          <B top="22%" s="6%" w="40%" h="12%" c="#FFE57F" r={3} style={{ transform: "rotate(-1.5deg)" }} />
          <T top="18%" s="7%" c="#2B2B2B" size={9}>{title}</T>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={box({ top: "38%", s: "6%", w: "44%", h: "6%" })}>
            <path d="M1 6 Q 12 1, 25 6 T 50 6 T 75 6 T 99 5" fill="none" stroke="#FF6B6B" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <L top="54%" s="7%" w="34%" c="#2B2B2B44" />
          <L top="63%" s="7%" w="26%" c="#2B2B2B44" />
          <B top="22%" e="10%" w="24%" h="42%" c="transparent" r="50%" style={{ border: "2px solid #4D96FF", transform: "rotate(-8deg)" }} />
          <span className="material-symbols-outlined" style={box({ top: "35%", e: "19%" }, { fontSize: "8cqw", color: "#4D96FF" })}>
            star
          </span>
          <svg viewBox="0 0 40 20" style={box({ bottom: "12%", e: "36%", w: "14%", h: "16%" })}>
            <path d="M2 4 C 14 18, 26 18, 36 8 M30 6 L36 8 L34 14" fill="none" stroke="#2B2B2B" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </>
      );
    case "organic":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F1EDE4" />
          <B top="-18%" s="-10%" w="40%" h="70%" c="#DAD7CD" r="60% 40% 55% 45%" />
          <B top="12%" e="8%" w="32%" h="76%" c="linear-gradient(180deg,#A3B18A,#3A5A40)" r="999px 999px 14px 14px" />
          <T top="34%" s="8%" c="#344E41" size={9} weight={600}>{title}</T>
          <L top="56%" s="8%" w="34%" c="#344E4155" />
          <L top="64%" s="8%" w="24%" c="#344E4133" />
          <B bottom="8%" s="8%" w="10%" h="16%" c="#588157" r="0 100% 0 100%" />
        </>
      );
    case "retro":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F4E3C1" />
          <B bottom="-50%" e="-12%" w="60%" h="120%" c="repeating-conic-gradient(#E76F51 0 10deg,#F4A261 10deg 20deg)" r="50%" />
          <B top="58%" s="0" w="100%" h="6%" c="#E76F51" />
          <B top="66%" s="0" w="100%" h="6%" c="#F4A261" />
          <B top="74%" s="0" w="100%" h="6%" c="#2A9D8F" />
          <T top="18%" s="7%" c="#5A3E2B" size={10} weight={900}>{title}</T>
          <B top="40%" s="7%" w="16%" h="10%" c="#2A9D8F" r={999} />
        </>
      );
    case "collage":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#EFE9E1" />
          <B top="10%" e="8%" w="30%" h="50%" c="linear-gradient(135deg,#F6A96B,#C0603E)" style={{ border: "3px solid #fff", boxShadow: "0 3px 8px rgba(0,0,0,0.18)", transform: "rotate(4deg)" }} />
          <B top="36%" e="30%" w="26%" h="46%" c="linear-gradient(135deg,#7FB7BE,#3D5A80)" style={{ border: "3px solid #fff", boxShadow: "0 3px 8px rgba(0,0,0,0.18)", transform: "rotate(-5deg)" }} />
          <B top="6%" e="20%" w="12%" h="8%" c="#F6D365cc" style={{ transform: "rotate(-8deg)" }} />
          <T top="20%" s="6%" c="#2D2A26" size={9}>{title}</T>
          <B top="44%" s="6%" w="26%" h="12%" c="#FFFFFF" r={4} style={{ boxShadow: "0 2px 5px rgba(0,0,0,0.12)" }} />
          <L top="48.5%" s="9%" w="18%" c="#2D2A2666" />
        </>
      );
  }
}
