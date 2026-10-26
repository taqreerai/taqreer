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
    case "whiteboard":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="radial-gradient(#C7CDD6 1px,transparent 1.4px) 0 0/5% 8.9% #F6F7F9" />
          <T top="7%" s="6%" c="#1F2937" size={8}>{title}</T>
          <B top="22%" s="5%" w="24%" h="8%" c="#E4E8EE" r="3px 3px 0 0" />
          <L top="25%" s="7%" w="14%" c="#6B728066" />
          <B top="29%" s="5%" e="5%" h="62%" c="#FFFFFF" r={3} style={{ border: "1px solid #D5DAE1" }} />
          <B top="38%" s="9%" w="19%" h="30%" c="#FFE27A" r={2} style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }} />
          <B top="38%" s="34%" w="19%" h="30%" c="#FFB3C7" r={2} style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }} />
          <B top="38%" s="59%" w="19%" h="30%" c="#9BD1FF" r={2} style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }} />
          <L top="46%" s="11%" w="13%" c="#1F293755" />
          <L top="54%" s="11%" w="9%" c="#1F293755" />
          <L top="46%" s="36%" w="13%" c="#1F293755" />
          <L top="46%" s="61%" w="13%" c="#1F293755" />
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={box({ top: "76%", s: "9%", w: "70%", h: "8%" }, dir === "rtl" ? { transform: "scaleX(-1)" } : {})}>
            <path d="M2 5H92" fill="none" stroke="#6B7280" strokeWidth="1.6" />
            <path d="M85 1L97 5L85 9" fill="none" stroke="#6B7280" strokeWidth="1.6" />
          </svg>
        </>
      );
    case "fintech":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <T top="9%" s="7%" c="#0F172A" size={6.5}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B key={i} top="34%" s={`${7 + i * 30}%`} w="26%" h="44%" c="#F8FAFC" r="3cqw" style={{ border: "1px solid #E2E8F0" }} />
          ))}
          {[0, 1, 2].map((i) => (
            <T key={`n${i}`} top="44%" s={`${10 + i * 30}%`} c="#0F172A" size={7}>{["24", "8.5", "92"][i]}</T>
          ))}
          {[0, 1, 2].map((i) => (
            <B key={`d${i}`} top="64%" s={`${10 + i * 30}%`} w="9%" h="6%" c={i === 1 ? "#FEE2E2" : "#DCFCE7"} r={999} />
          ))}
        </>
      );
    case "clinical":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F0FAF8" />
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={{ position: "absolute", top: "6%", insetInlineStart: "7%", width: "86%", height: "8%" }}>
            <polyline points="0,5 35,5 40,1 45,9 50,5 100,5" fill="none" stroke="#14B8A6" strokeWidth="0.8" />
          </svg>
          <T top="20%" s="7%" c="#0F3D3A" size={6.5} weight={700}>{title}</T>
          {[0, 1].map((i) => (
            <B key={i} top="44%" s={`${7 + i * 45}%`} w="41%" h="40%" c="#FFFFFF" r="3cqw" style={{ border: "1px solid #D5EEEA" }} />
          ))}
          {[0, 1].map((i) => (
            <B key={`c${i}`} top="52%" s={`${11 + i * 45}%`} w="9%" h="16%" c="#CCF2EC" r={999} />
          ))}
          {[0, 1].map((i) => (
            <L key={`l${i}`} top="74%" s={`${11 + i * 45}%`} w="26%" c="#0F3D3A44" />
          ))}
        </>
      );
    case "architectural":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#EEEBE5" />
          <B top="10%" e="6%" w="52%" h="80%" c="linear-gradient(160deg,#9CA3AF,#4B5563)" />
          <B top="10%" s="6%" w="34%" h="1px" c="#111" />
          <B top="8%" s="6%" w="1px" h="5%" c="#111" />
          <B top="8%" s="40%" w="1px" h="5%" c="#111" />
          <T top="22%" s="6%" c="#111" size={6} weight={500}>{title}</T>
          <L top="44%" s="6%" w="28%" c="#11111155" />
          <L top="52%" s="6%" w="22%" c="#11111144" />
          <T bottom="10%" s="6%" c="#111" size={3.2} weight={600}>A-02 · 1,200 m2</T>
        </>
      );
    case "annualreport":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <T top="8%" s="6%" c="#1D4ED8" size={18} weight={800}>01</T>
          <T top="40%" s="6%" c="#111" size={6}>{title}</T>
          <L top="56%" s="6%" w="30%" c="#11111144" />
          <L top="63%" s="6%" w="24%" c="#11111133" />
          <B top="8%" e="6%" w="44%" h="70%" c="linear-gradient(150deg,#CBD5E1,#64748B)" />
          <B bottom="10%" s="6%" e="6%" h="1px" c="#11111133" />
          <T bottom="4%" e="6%" c="#111" size={3} weight={600}>2026</T>
        </>
      );
    case "mihrab":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#123B36" />
          <B top="6%" s="3%" e="3%" bottom="6%" c="transparent" style={{ border: "1px solid #D9B86A66" }} />
          <B top="16%" s="34%" w="32%" h="72%" c="#1B4D46" r="50% 50% 0 0 / 30% 30% 0 0" style={{ border: "1px solid #D9B86A" }} />
          <Star size="7%" color="#D9B86A" style={{ top: "8%", insetInlineStart: "46.5%" }} />
          <T top="48%" s="34%" w="32%" c="#F5E9C8" size={5} style={{ textAlign: "center" }}>{title}</T>
          <L top="62%" s="40%" w="20%" c="#F5E9C866" />
        </>
      );
    case "festive":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#1E1B4B" />
          <B top="0" s="0" w="100%" h="12%" c="#312E81" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Star key={i} size="8%" color="#FBBF24" style={{ top: "2%", insetInlineStart: `${4 + i * 14}%` }} />
          ))}
          <B top="12%" e="14%" w="1px" h="14%" c="#FBBF24" />
          <B top="26%" e="11.5%" w="6%" h="14%" c="#FBBF24" r="1cqw" />
          <T top="44%" s="8%" c="#FDE68A" size={8}>{title}</T>
          <L top="64%" s="8%" w="34%" c="#FDE68A66" />
        </>
      );
    case "impact":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFF7ED" />
          <B top="0" e="0" w="46%" h="100%" c="linear-gradient(160deg,#FDBA74,#9A3412)" />
          <T top="12%" s="6%" c="#9A3412" size={16} weight={800}>12K</T>
          <T top="50%" s="6%" c="#431407" size={5.5}>{title}</T>
          <B top="68%" s="6%" w="1.2%" h="16%" c="#EA580C" />
          <L top="70%" s="10%" w="30%" c="#43140755" />
          <L top="78%" s="10%" w="22%" c="#43140744" />
        </>
      );
    case "legal":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <T top="8%" s="7%" c="#111827" size={6}>{title}</T>
          {[0, 1, 2, 3].map((i) => (
            <B key={i} top={`${34 + i * 14}%`} s="7%" e="7%" h="1px" c="#11182733" />
          ))}
          {[0, 1, 2].map((i) => (
            <T key={`n${i}`} top={`${38 + i * 14}%`} s="7%" c="#1D4ED8" size={3.6} weight={700}>{`1.${i + 1}`}</T>
          ))}
          {[0, 1, 2].map((i) => (
            <L key={`l${i}`} top={`${39.5 + i * 14}%`} s="18%" w={`${50 - i * 8}%`} c="#11182744" />
          ))}
        </>
      );
    case "magazine":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(170deg,#F9A8D4,#831843)" />
          <T top="4%" s="6%" c="#FFFFFF" size={13} weight={900}>{title}</T>
          <T top="27%" s="6%" c="#FFFFFF" size={2.8} weight={600}>ISSUE 01 / 2026</T>
          <L top="62%" s="6%" w="34%" c="#FFFFFFcc" />
          <L top="70%" s="6%" w="26%" c="#FFFFFF99" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <B key={i} bottom="8%" e={`${6 + i * 1.6}%`} w={i % 2 ? "0.5%" : "0.9%"} h="9%" c="#FFFFFF" />
          ))}
        </>
      );
    case "lookbook":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FAF7F2" />
          <B top="8%" s="8%" w="30%" h="84%" c="linear-gradient(170deg,#D6C7B4,#7C6A55)" />
          <B top="40%" s="42%" w="16%" h="30%" c="linear-gradient(170deg,#E7DCCD,#A8957C)" />
          <T top="12%" e="8%" c="#2B2620" size={4.5} weight={500}>{title}</T>
          <L top="24%" e="8%" w="18%" c="#2B262044" />
          <T bottom="8%" e="8%" c="#2B2620" size={2.6} weight={600} style={{ letterSpacing: "0.3em" }}>LOOK 03</T>
        </>
      );
    case "risograph":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F6F1E7" />
          <T top="14%" s="7.8%" c="#FF5A79" size={11} weight={900}>{title}</T>
          <T top="12.5%" s="7%" c="#2563EB" size={11} weight={900}>{title}</T>
          <svg style={{ position: "absolute", bottom: "8%", insetInlineEnd: "6%", width: "34%", height: "44%" }}>
            <defs>
              <pattern id="riso-dots" width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1.6" fill="#FF5A79" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#riso-dots)" />
          </svg>
          <L top="60%" s="7%" w="30%" c="#2563EB99" />
        </>
      );
    case "menu":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FBF3E4" />
          <B top="6%" s="4%" e="4%" bottom="6%" c="transparent" style={{ border: "3px double #7C2D12" }} />
          <T top="14%" s="10%" c="#7C2D12" size={6.5}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B key={i} top={`${40 + i * 14}%`} s="10%" w="44%" h="0" c="transparent" style={{ borderBottom: "2px dotted #7C2D1288" }} />
          ))}
          {[0, 1, 2].map((i) => (
            <T key={`p${i}`} top={`${36 + i * 14}%`} s="56%" c="#B45309" size={3.4} weight={700}>{`${18 + i * 6}`}</T>
          ))}
          <B top="30%" e="10%" w="20%" h="36%" c="radial-gradient(circle,#FDBA74,#9A3412)" r={999} />
        </>
      );
    case "blueprint":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#123A6B" style={{ backgroundImage: "linear-gradient(#ffffff14 1px,transparent 1px),linear-gradient(90deg,#ffffff14 1px,transparent 1px)", backgroundSize: "8% 14%" }} />
          <T top="10%" s="6%" c="#E0F2FE" size={6} weight={600}>{title}</T>
          <B top="40%" s="10%" w="40%" h="34%" c="transparent" style={{ border: "1px solid #E0F2FE" }} />
          <B top="80%" s="10%" w="40%" h="1px" c="#E0F2FEaa" />
          <B bottom="8%" e="6%" w="26%" h="18%" c="transparent" style={{ border: "1px solid #E0F2FE" }} />
          <B bottom="17%" e="6%" w="26%" h="1px" c="#E0F2FE" />
        </>
      );
    case "techreport":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <T top="7%" s="6%" c="#1E3A8A" size={4} weight={700}>2.1</T>
          <T top="16%" s="6%" c="#111" size={5.5}>{title}</T>
          <B top="36%" s="6%" w="56%" h="40%" c="#F1F5F9" style={{ border: "1px solid #CBD5E1" }} />
          {[30, 50, 40, 64].map((h, i) => (
            <B key={i} bottom="26%" s={`${12 + i * 11}%`} w="6%" h={`${h * 0.5}%`} c={i === 3 ? "#1E3A8A" : "#94A3B8"} />
          ))}
          <L top="80%" s="6%" w="30%" c="#11111155" />
          <B top="36%" e="6%" w="24%" h="40%" c="transparent" style={{ borderInlineStart: "1px solid #CBD5E1" }} />
          <L top="42%" e="8%" w="18%" c="#11111133" />
          <L top="50%" e="8%" w="14%" c="#11111133" />
        </>
      );
    case "command":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#05080F" />
          <B top="0" s="0" w="100%" h="9%" c="#0B1220" style={{ borderBottom: "1px solid #1E293B" }} />
          <B top="3.5%" s="4%" w="1.6%" h="2.8%" c="#22C55E" r={999} />
          <T top="2.6%" s="7%" c="#94A3B8" size={2.8} weight={700}>{title}</T>
          {[0, 1, 2, 3].map((i) => (
            <B key={i} top={i < 2 ? "16%" : "56%"} s={i % 2 ? "51%" : "4%"} w="45%" h="36%" c="#0B1220" r="1cqw" style={{ border: "1px solid #1E293B" }} />
          ))}
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ position: "absolute", top: "30%", insetInlineStart: "8%", width: "37%", height: "16%" }}>
            <polyline points="0,25 20,18 40,22 60,8 80,12 100,4" fill="none" stroke="#38BDF8" strokeWidth="1.5" />
          </svg>
          <T top="62%" s="8%" c="#E2E8F0" size={7}>98%</T>
        </>
      );
    case "journey":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F8FAFC" />
          <T top="10%" s="6%" c="#0F172A" size={6.5}>{title}</T>
          <B top="46%" s="6%" e="6%" h="1.4%" c="#2563EB" r={999} />
          {[0, 1, 2, 3, 4].map((i) => (
            <B key={i} top={i === 2 ? "40%" : "43.5%"} s={`${8 + i * 20}%`} w={i === 2 ? "6%" : "3%"} h={i === 2 ? "13%" : "6%"} c={i <= 2 ? "#2563EB" : "#FFFFFF"} r={999} style={{ border: "2px solid #2563EB" }} />
          ))}
          <B top="60%" s="40%" w="30%" h="26%" c="#FFFFFF" r="2cqw" style={{ border: "1px solid #CBD5E1" }} />
          <L top="68%" s="43%" w="20%" c="#0F172A55" />
        </>
      );
    case "pastel":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FDF2F8" />
          <T top="12%" s="7%" c="#831843" size={7}>{title}</T>
          <B top="34%" s="7%" w="22%" h="9%" c="#FBCFE8" r={999} />
          <B top="34%" s="31%" w="16%" h="9%" c="#DDD6FE" r={999} />
          <B top="52%" s="7%" w="40%" h="36%" c="#FFFFFF" r="4cqw" style={{ boxShadow: "0 4px 10px #83184322" }} />
          <B top="40%" e="7%" w="38%" h="48%" c="#EDE9FE" r="4cqw" />
          <L top="62%" s="11%" w="24%" c="#83184355" />
        </>
      );
    case "papercut":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#ECFDF5" />
          <T top="14%" s="7%" c="#064E3B" size={7}>{title}</T>
          <B bottom="-20%" s="-10%" w="80%" h="55%" c="#A7F3D0" r={999} style={{ boxShadow: "0 -3px 8px #064E3B22" }} />
          <B bottom="-28%" e="-12%" w="80%" h="55%" c="#6EE7B7" r={999} style={{ boxShadow: "0 -3px 8px #064E3B22" }} />
          <B bottom="-34%" s="10%" w="90%" h="50%" c="#10B981" r={999} style={{ boxShadow: "0 -3px 8px #064E3B33" }} />
          <L top="34%" s="7%" w="30%" c="#064E3B55" />
        </>
      );
    case "aurora":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F5F3FF" />
          <B top="-30%" e="-14%" w="60%" h="110%" c="#DDD6FE" r={999} />
          <B bottom="-40%" e="10%" w="50%" h="90%" c="#FBCFE8" r={999} />
          <B top="-20%" s="-14%" w="44%" h="80%" c="#BAE6FD" r={999} />
          <B top="18%" s="12%" w="56%" h="64%" c="#FFFFFF" r="3cqw" style={{ border: "1px solid #E9D5FF" }} />
          <T top="32%" s="17%" c="#3B0764" size={6.5}>{title}</T>
          <L top="54%" s="17%" w="30%" c="#3B076455" />
        </>
      );
    case "sports":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0B0B0F" />
          <B top="0" e="0" w="55%" h="100%" c="#E11D48" style={{ clipPath: "polygon(30% 0,100% 0,100% 100%,0 100%)" }} />
          {[0, 1, 2].map((i) => (
            <B key={i} top={`${20 + i * 6}%`} s="6%" w="22%" h="2%" c="#FFFFFF" style={{ transform: "skewX(-20deg)" }} />
          ))}
          <T top="40%" s="6%" c="#FFFFFF" size={20} weight={900} style={{ transform: "skewX(-8deg)" }}>3:1</T>
          <T bottom="10%" s="6%" c="#FFFFFF" size={4.5}>{title}</T>
        </>
      );
    case "storybook":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFF8E7" />
          <B top="6%" s="5%" e="5%" bottom="6%" c="transparent" r="4cqw" style={{ border: "3px solid #FDBA74" }} />
          <B top="12%" s="10%" e="10%" h="50%" c="#BAE6FD" r="3cqw" />
          <B top="40%" s="10%" e="10%" h="22%" c="#86EFAC" r="50% 50% 3cqw 3cqw / 60% 60% 3cqw 3cqw" />
          <B top="18%" e="18%" w="10%" h="17%" c="#FDE047" r={999} />
          <T top="68%" s="10%" e="10%" c="#7C2D12" size={6} style={{ textAlign: "center" }}>{title}</T>
          <B bottom="3%" s="46%" w="8%" h="9%" c="#FDBA74" r={999} />
        </>
      );
    case "felt":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FEF3C7" />
          <B top="12%" s="8%" w="50%" h="40%" c="#FCA5A5" r="3cqw" />
          <B top="15%" s="10%" w="46%" h="34%" c="transparent" r="2cqw" style={{ border: "2px dashed #7F1D1D88" }} />
          <T top="26%" s="13%" c="#7F1D1D" size={6}>{title}</T>
          <B top="58%" s="8%" w="24%" h="30%" c="#93C5FD" r="3cqw" />
          <B top="60.5%" s="9.5%" w="21%" h="25%" c="transparent" r="2cqw" style={{ border: "2px dashed #1E3A8A88" }} />
          <B top="20%" e="10%" w="18%" h="32%" c="#86EFAC" r={999} />
          <B top="32%" e="16%" w="2%" h="4%" c="#14532D" r={999} />
          <B top="32%" e="20%" w="2%" h="4%" c="#14532D" r={999} />
        </>
      );
    case "chalkboard":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#1F3B2D" />
          <T top="14%" s="8%" c="#F8FAF5" size={7}>{title}</T>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={{ position: "absolute", top: "30%", insetInlineStart: "8%", width: "40%", height: "5%" }}>
            <path d="M0 6 Q25 2 50 6 T100 5" fill="none" stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <L top="44%" s="8%" w="40%" c="#F8FAF5aa" />
          <L top="54%" s="8%" w="30%" c="#F8FAF588" />
          <B top="38%" e="10%" w="26%" h="30%" c="transparent" r={999} style={{ border: "2px solid #F8FAF5aa" }} />
          <B bottom="0" s="0" w="100%" h="9%" c="#8B5E34" style={{ borderTop: "2px solid #5C3A1E" }} />
          <B bottom="6%" s="20%" w="7%" h="3%" c="#F8FAF5" r={999} />
        </>
      );
    case "gamequest":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#1E1B4B" />
          <B top="8%" s="6%" w="16%" h="9%" c="#FACC15" r={999} />
          <T top="9.5%" s="8.5%" c="#1E1B4B" size={3.2} weight={900}>LEVEL 2</T>
          <B top="10%" e="6%" w="40%" h="5%" c="#312E81" r={999} />
          <B top="10%" e="26%" w="20%" h="5%" c="#22D3EE" r={999} />
          <T top="30%" s="6%" c="#FFFFFF" size={7}>{title}</T>
          <B top="54%" s="6%" w="54%" h="30%" c="#4338CA" r="3cqw" />
          <B top="62%" s="10%" w="6%" h="11%" c="#FFFFFF" r="1cqw" />
          <Star size="18%" color="#FACC15" style={{ top: "54%", insetInlineEnd: "10%" }} />
        </>
      );
    case "mathgrid":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" style={{ backgroundImage: "linear-gradient(#BFDBFE 1px,transparent 1px),linear-gradient(90deg,#BFDBFE 1px,transparent 1px)", backgroundSize: "5% 8.9%" }} />
          <B top="0" s="12%" w="0.5%" h="100%" c="#F87171" />
          <T top="10%" s="16%" c="#1E3A8A" size={6}>{title}</T>
          <B top="34%" s="16%" w="40%" h="14%" c="#EFF6FF" style={{ border: "1px solid #93C5FD" }} />
          <B top="52%" s="16%" w="40%" h="14%" c="#EFF6FF" style={{ border: "1px solid #93C5FD" }} />
          <B top="40%" e="8%" w="26%" h="22%" c="#FEF9C3" style={{ border: "3px double #1E3A8A" }} />
          <T top="45%" e="16%" c="#1E3A8A" size={6} weight={900}>= 12</T>
        </>
      );
    case "sciencelab":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F0FDFA" />
          <T top="8%" s="6%" c="#134E4A" size={6}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B key={i} top="32%" s={`${6 + i * 30}%`} w="27%" h="54%" c="#FFFFFF" r="2cqw" style={{ border: "1px solid #CCFBF1" }} />
          ))}
          {["#F59E0B", "#3B82F6", "#10B981"].map((c, i) => (
            <B key={`t${i}`} top="36%" s={`${9 + i * 30}%`} w="12%" h="7%" c={c} r={999} />
          ))}
          <svg viewBox="0 0 20 24" style={{ position: "absolute", top: "50%", insetInlineStart: "13%", width: "10%", height: "26%" }}>
            <path d="M7 2 H13 M8 2 V9 L3 21 H17 L12 9 V2" fill="#99F6E4" stroke="#134E4A" strokeWidth="1" />
          </svg>
        </>
      );
    case "comic":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="5%" s="4%" w="56%" h="52%" c="#FDE68A" style={{ border: "3px solid #111" }} />
          <B top="5%" s="62%" w="34%" h="52%" c="#BFDBFE" style={{ border: "3px solid #111" }} />
          <B top="60%" s="4%" w="92%" h="35%" c="#FECACA" style={{ border: "3px solid #111" }} />
          <B top="9%" s="7%" w="30%" h="10%" c="#FFFFFF" style={{ border: "2px solid #111" }} />
          <T top="68%" s="8%" c="#111" size={7} weight={900}>{title}</T>
          <B top="14%" s="68%" w="22%" h="20%" c="#FFFFFF" r={999} style={{ border: "2px solid #111" }} />
        </>
      );
    case "cornell":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="100%" h="15%" c="#F8FAFC" style={{ borderBottom: "1px solid #CBD5E1" }} />
          <T top="4%" s="5%" c="#0F172A" size={4.5}>{title}</T>
          <B top="15%" s="0" w="28%" h="63%" c="#EEF2FF" style={{ borderInlineEnd: "1px solid #CBD5E1" }} />
          {[0, 1, 2].map((i) => (
            <L key={i} top={`${24 + i * 16}%`} s="5%" w="16%" c="#4338CA88" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <B key={`r${i}`} top={`${28 + i * 12}%`} s="32%" e="5%" h="1px" c="#CBD5E1" />
          ))}
          <B bottom="0" s="0" w="100%" h="22%" c="#FEF3C7" style={{ borderTop: "2px solid #0F172A" }} />
          <L bottom="9%" s="5%" w="50%" c="#0F172A66" />
        </>
      );
    case "flashcard":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#EEF2FF" />
          <B top="14%" s="16%" w="68%" h="72%" c="#FFFFFF" r="3cqw" style={{ border: "1px solid #C7D2FE", boxShadow: "0 4px 10px #4338CA22" }} />
          <B top="20%" s="21%" w="8%" h="13%" c="#4338CA" r={999} />
          <T top="22%" s="23.3%" c="#FFFFFF" size={4.5} weight={900}>Q</T>
          <B top="46%" s="26%" w="34%" h="13%" c="#FDE68A" />
          <T top="45%" s="27%" c="#1E1B4B" size={6.5}>{title}</T>
          <T top="6%" e="6%" c="#4338CA" size={3} weight={700}>3 / 20</T>
        </>
      );
    case "posterfair":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#1E40AF" />
          <T top="5%" s="6%" c="#FFFFFF" size={5.5}>{title}</T>
          {[[6, 26], [35, 30], [68, 26]].map(([s, w], i) => (
            <B key={i} top="24%" s={`${s}%`} w={`${w}%`} h="68%" c="#FFFFFF" r="1cqw" />
          ))}
          {[[6, 26, "#F59E0B"], [35, 30, "#10B981"], [68, 26, "#EC4899"]].map(([s, w, c], i) => (
            <B key={`h${i}`} top="24%" s={`${s}%`} w={`${w}%`} h="9%" c={c as string} r="1cqw 1cqw 0 0" />
          ))}
          <B top="40%" s="38%" w="24%" h="28%" c="linear-gradient(150deg,#A7F3D0,#047857)" />
          <B top="38.5%" s="49%" w="2%" h="3.5%" c="#DC2626" r={999} />
        </>
      );
    case "thesis":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FAFAF9" />
          {[0, 1, 2, 3, 4].map((i) => (
            <B key={i} top="6%" s={`${6 + i * 17.8}%`} w="16%" h="3%" c={i <= 1 ? "#7C2D12" : "#E7E5E4"} r={999} />
          ))}
          <T top="18%" s="6%" c="#1C1917" size={6}>{title}</T>
          {[0, 1].map((i) => (
            <B key={`q${i}`} top={`${38 + i * 20}%`} s="6%" w="11%" h="12%" c="#7C2D12" r="1cqw" />
          ))}
          {[0, 1].map((i) => (
            <T key={`t${i}`} top={`${40.5 + i * 20}%`} s="7.5%" c="#FFFFFF" size={3.6} weight={800}>{`RQ${i + 1}`}</T>
          ))}
          {[0, 1].map((i) => (
            <L key={`l${i}`} top={`${43 + i * 20}%`} s="20%" w="40%" c="#1C191755" />
          ))}
          <B bottom="10%" s="6%" e="6%" h="1px" c="#1C191733" />
        </>
      );
    case "casestudy":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F8FAFC" />
          <T top="7%" e="6%" c="#475569" size={3} weight={700}>DILEMMA</T>
          <T top="14%" s="6%" c="#0F172A" size={6}>{title}</T>
          <B top="34%" s="6%" e="6%" h="18%" c="#DBEAFE" r="2cqw" />
          <L top="41%" s="10%" w="50%" c="#1E3A8A88" />
          {[0, 1, 2].map((i) => (
            <B key={i} top="58%" s={`${6 + i * 30}%`} w="27%" h="30%" c="#FFFFFF" r="2cqw" style={{ border: "1px solid #CBD5E1" }} />
          ))}
          {[0, 1, 2].map((i) => (
            <B key={`d${i}`} top="62%" s={`${9 + i * 30}%`} w="5%" h="8%" c={["#22C55E", "#F59E0B", "#EF4444"][i]} r={999} />
          ))}
        </>
      );
    case "workshop":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFBEB" />
          <T top="9%" s="6%" c="#78350F" size={6}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B key={i} top={`${32 + i * 19}%`} s="6%" w="58%" h="15%" c="#FFFFFF" r="2cqw" style={{ border: "1px solid #FDE68A" }} />
          ))}
          {[0, 1, 2].map((i) => (
            <B key={`c${i}`} top={`${35.5 + i * 19}%`} s="9%" w="12%" h="8%" c={i === 1 ? "#0EA5E9" : "#F59E0B"} r={999} />
          ))}
          {[0, 1, 2].map((i) => (
            <L key={`l${i}`} top={`${38.5 + i * 19}%`} s="24%" w="30%" c="#78350F55" />
          ))}
          <B top="32%" e="6%" w="26%" h="53%" c="#E0F2FE" r="2cqw" />
        </>
      );
    case "languagelab":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F0F9FF" />
          <T top="8%" s="6%" c="#0C4A6E" size={6}>{title}</T>
          {[0, 1].map((i) => (
            <B key={i} top={`${30 + i * 32}%`} s="6%" e="6%" h="26%" c="#FFFFFF" r="2cqw" style={{ border: "1px solid #BAE6FD" }} />
          ))}
          {[0, 1].map((i) => (
            <B key={`d${i}`} top={`${33 + i * 32}%`} s="50%" w="1px" h="20%" c="#BAE6FD" />
          ))}
          {[0, 1].map((i) => (
            <T key={`a${i}`} top={`${36 + i * 32}%`} s="10%" c="#0369A1" size={4.5}>{["كتاب", "قلم"][i]}</T>
          ))}
          {[0, 1].map((i) => (
            <T key={`e${i}`} top={`${36 + i * 32}%`} s="56%" c="#BE185D" size={4.5} style={{ direction: "ltr" }}>{["book", "pen"][i]}</T>
          ))}
        </>
      );
    case "schoolreport":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="100%" h="20%" c="#14532D" />
          <B top="4%" s="5%" w="7%" h="12.5%" c="#FDE68A" r={999} />
          <T top="6%" s="15%" c="#FFFFFF" size={4.5}>{title}</T>
          {[0, 1, 2].map((i) => (
            <B key={i} top="28%" s={`${5 + i * 31}%`} w="28%" h="34%" c="#F0FDF4" r="2cqw" style={{ border: "1px solid #BBF7D0" }} />
          ))}
          {[0, 1, 2].map((i) => (
            <T key={`n${i}`} top="36%" s={`${8 + i * 31}%`} c="#14532D" size={7}>{["96%", "88", "12"][i]}</T>
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <B key={`e${i}`} top="72%" s={`${5 + i * 18.4}%`} w="16%" h="16%" c={i === 0 ? "#14532D" : "#ECFDF5"} r="1.5cqw" />
          ))}
        </>
      );
  }
}

// ── Social post thumbnails (2026-10-06) ─────────────────────────────
// The /social styles drawn the same way as the deck thumbnails above (owner
// direction: the old grey wireframes read as too technical): each style is a
// small 4:5 post in its OWN colour mood with a sample headline. Preview
// content only; the generated post uses the user's brand palette.

export type SocialThumbKey =
  | "auto"
  | "boldtype"
  | "editorial"
  | "grainy"
  | "brutalist"
  | "minimal"
  | "photo"
  | "retro"
  | "pop3d"
  | "swiss"
  | "corporate"
  | "quote"
  | "textpost"
  | "heritage"
  | "luxury"
  | "techglow"
  | "doodle"
  | "scrapbook"
  | "steps";

export function SocialStyleThumb({
  k,
  title,
  dir,
}: {
  k: SocialThumbKey;
  title: string;
  dir: "rtl" | "ltr";
}) {
  return (
    <div
      dir={dir}
      className="relative w-full overflow-hidden rounded-md border border-[var(--tq-border-hairline)]"
      style={{ aspectRatio: "4/5", containerType: "inline-size" }}
      aria-hidden
    >
      {renderSocial(k, title)}
    </div>
  );
}

// A rounded "@handle" pill, the little social signature most posts carry.
function Handle({ c, bottom = "6%" }: { c: string; bottom?: string }) {
  return <L bottom={bottom} s="8%" w="26%" c={c} />;
}

function renderSocial(k: SocialThumbKey, title: string): ReactNode {
  switch (k) {
    case "auto":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(160deg,#3b82f6,#8b5cf6 55%,#ec4899)" />
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <span className="material-symbols-outlined" style={{ fontSize: "22cqw" }}>
              auto_awesome
            </span>
          </div>
        </>
      );
    case "boldtype":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFD60A" />
          <T top="26%" s="8%" c="#111" size={17} weight={900}>{title}</T>
          <B top="58%" s="8%" w="44%" h="4%" c="#111" />
          <Handle c="#11111166" />
        </>
      );
    case "editorial":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F5EFE6" />
          <B top="7%" s="8%" w="22%" h="4%" c="#C2410C" r={2} />
          <T top="14%" s="8%" c="#1C1917" size={13} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{title}</T>
          <B top="40%" s="8%" e="8%" h="42%" c="linear-gradient(180deg,#FDBA74,#FB7185 55%,#7C2D12)" r={4} />
          <B top="62%" s="40%" w="24%" h="20%" c="#7C2D12cc" r="50% 50% 0 0" />
          <L bottom="7%" s="8%" w="46%" c="#1C191766" />
        </>
      );
    case "grainy":
      return (
        <>
          <B
            top="0"
            s="0"
            w="100%"
            h="100%"
            c="radial-gradient(90% 70% at 25% 20%,#F472B6,transparent 60%),radial-gradient(90% 80% at 85% 85%,#F97316,transparent 60%),#6D28D9"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundImage: "radial-gradient(#ffffff 0.6px, transparent 0.6px)", backgroundSize: "4px 4px", opacity: 0.25 }}
          />
          <T bottom="20%" s="8%" c="#fff" size={13}>{title}</T>
          <L bottom="12%" s="8%" w="40%" c="#ffffffaa" />
        </>
      );
    case "brutalist":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F4F4F0" />
          <B top="10%" s="9%" w="78%" h="30%" c="#C6F432" style={{ border: "1.5px solid #111", boxShadow: "4px 4px 0 #111" }} />
          <T top="17%" s="14%" c="#111" size={12} weight={900}>{title}</T>
          <B top="52%" s="9%" w="44%" h="26%" c="#FF5CA8" style={{ border: "1.5px solid #111", boxShadow: "4px 4px 0 #111" }} />
          <B top="52%" e="9%" w="22%" h="26%" c="#fff" style={{ border: "1.5px solid #111", boxShadow: "4px 4px 0 #111" }} />
          <Handle c="#11111188" />
        </>
      );
    case "minimal":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FAFAF7" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[5cqw]">
            <span style={{ color: "#1F2937", fontSize: "11cqw", fontWeight: 700, lineHeight: 1 }}>{title}</span>
            <span style={{ width: "22cqw", height: "1px", background: "#1F293766" }} />
            <span style={{ width: "4cqw", height: "4cqw", borderRadius: 999, background: "#0EA5E9" }} />
          </div>
        </>
      );
    case "photo":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(180deg,#38BDF8,#FDE68A 58%,#F59E0B)" />
          <B top="22%" e="18%" w="20%" h="16%" c="#FFF7D6" r="50%" />
          <B bottom="0" s="-10%" w="80%" h="46%" c="#14532D" r="60% 60% 0 0" />
          <B bottom="0" e="-14%" w="74%" h="38%" c="#166534" r="60% 60% 0 0" />
          <B top="0" s="0" w="100%" h="100%" c="linear-gradient(to top,#000000cc,transparent 55%)" />
          <T bottom="18%" s="8%" c="#fff" size={13}>{title}</T>
          <L bottom="10%" s="8%" w="38%" c="#ffffffaa" />
        </>
      );
    case "retro":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FDF0D5" />
          <B top="16%" s="20%" w="60%" h="48%" c="#E76F51" r="50% 50% 0 0" />
          {[30, 40, 50].map((t) => (
            <B key={t} top={`${t}%`} s="18%" w="64%" h="3%" c="#FDF0D5" />
          ))}
          <B top="64%" s="8%" e="8%" h="2%" c="#264653" />
          <T bottom="16%" s="8%" c="#264653" size={13}>{title}</T>
          <div
            className="absolute"
            style={{ top: "4%", insetInlineEnd: "4%", width: "22%", height: "18%", backgroundImage: "radial-gradient(#2A9D8F 1px, transparent 1px)", backgroundSize: "5px 5px" }}
          />
        </>
      );
    case "pop3d":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#EDE9FE" />
          <B top="8%" e="8%" w="30%" h="24%" c="radial-gradient(circle at 35% 30%,#C4B5FD,#7C3AED)" r="50%" />
          <B top="30%" s="6%" w="22%" h="18%" c="radial-gradient(circle at 35% 30%,#FDE68A,#F59E0B)" r="50%" />
          <B bottom="12%" s="8%" e="8%" h="34%" c="#fff" r={10} style={{ boxShadow: "0 6px 14px #7C3AED33" }} />
          <T bottom="30%" s="14%" c="#3B0764" size={11}>{title}</T>
          <L bottom="20%" s="14%" w="40%" c="#7C3AED66" />
        </>
      );
    case "swiss":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          {[33, 66].map((x) => (
            <B key={x} top="5%" bottom="5%" s={`${x}%`} w="1px" c="#11111126" />
          ))}
          <T top="8%" s="8%" c="#111" size={12}>{title}</T>
          <B top="40%" s="8%" w="28%" h="24%" c="#E63B2E" />
          <L top="44%" s="42%" w="40%" c="#11111166" />
          <L top="52%" s="42%" w="30%" c="#11111144" />
          <T bottom="6%" e="8%" c="#111" size={6} weight={700}>01</T>
        </>
      );
    case "corporate":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFFFF" />
          <B top="0" s="0" w="100%" h="20%" c="#1E3A5F" />
          <T top="6%" s="8%" c="#fff" size={9}>{title}</T>
          <T top="26%" s="8%" c="#14B8A6" size={16} weight={900} style={{ direction: "ltr" }}>+24%</T>
          {[
            [24, "#CBD5E1"],
            [36, "#CBD5E1"],
            [30, "#CBD5E1"],
            [48, "#14B8A6"],
          ].map(([h, c], i) => (
            <B key={i} bottom="10%" s={`${8 + i * 21}%`} w="15%" h={`${h}%`} c={c as string} />
          ))}
        </>
      );
    case "quote":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFF7ED" />
          <T top="6%" s="8%" c="#EA580C" size={34} weight={900} style={{ fontFamily: "Georgia, 'Times New Roman', serif", direction: "ltr" }}>&ldquo;</T>
          <T top="44%" s="8%" c="#431407" size={13}>{title}</T>
          <L top="62%" s="8%" w="56%" c="#43140733" />
          <B bottom="12%" s="8%" w="10%" h="1px" c="#EA580C" />
          <L bottom="8.5%" s="22%" w="26%" c="#43140777" />
        </>
      );
    case "textpost":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#E0F2FE" />
          <B top="16%" s="8%" e="8%" h="64%" c="#FFFFFF" r={8} style={{ boxShadow: "0 4px 12px #0F172A1f" }} />
          <B top="22%" s="14%" w="13%" h="10.4%" c="#0284C7" r="50%" />
          <L top="24%" s="31%" w="30%" c="#0F172A99" />
          <L top="29%" s="31%" w="18%" c="#0F172A44" />
          <T top="42%" s="14%" c="#0F172A" size={10}>{title}</T>
          <L top="57%" s="14%" w="60%" c="#0F172A44" />
          <L top="63%" s="14%" w="42%" c="#0F172A44" />
          <L top="72%" s="14%" w="20%" c="#0284C766" />
        </>
      );
    case "heritage":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0F3D3E" />
          <B top="4%" s="4%" e="4%" bottom="4%" c="transparent" style={{ border: "1px solid #E9C46A88" }} />
          <B top="16%" s="24%" w="52%" h="44%" c="#E9C46A" r="50% 50% 0 0" />
          <B top="20%" s="28%" w="44%" h="40%" c="radial-gradient(circle at 50% 30%,#1F6F6B,#0B2E2F 75%)" r="50% 50% 0 0" />
          <Star size="13%" color="#E9C46A" style={{ top: "33%", insetInlineStart: "43.5%" }} />
          <Star size="11%" color="#E9C46A" style={{ top: "7%", insetInlineStart: "7%" }} />
          <Star size="11%" color="#E9C46A" style={{ top: "7%", insetInlineEnd: "7%" }} />
          <T bottom="17%" s="10%" c="#F4E3B5" size={12}>{title}</T>
          <L bottom="10%" s="10%" w="30%" c="#E9C46A88" />
        </>
      );
    case "luxury":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0D0D0D" />
          <B top="5%" s="6%" e="6%" bottom="5%" c="transparent" style={{ border: "1px solid #C9A96E" }} />
          <B top="14%" s="20%" w="60%" h="40%" c="radial-gradient(circle at 45% 35%,#5a4a32,#141414 70%)" />
          <T top="60%" s="14%" c="#C9A96E" size={4} weight={500} style={{ letterSpacing: "0.3em", direction: "ltr" }}>PRIVATE</T>
          <T top="67%" s="14%" c="#F5EFE3" size={12} weight={300}>{title}</T>
          <B bottom="12%" s="14%" w="14%" h="1px" c="#C9A96E" />
        </>
      );
    case "techglow":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#0A0F2C" />
          <B top="-12%" e="-20%" w="80%" h="60%" c="radial-gradient(circle,#7B5CFFcc,transparent 65%)" />
          <B bottom="-14%" s="-22%" w="80%" h="60%" c="radial-gradient(circle,#00D1FFaa,transparent 65%)" />
          <B top="22%" s="8%" e="8%" h="56%" c="rgba(255,255,255,0.08)" r={8} style={{ border: "1px solid rgba(255,255,255,0.22)", backdropFilter: "blur(2px)" }} />
          <T top="32%" s="14%" c="#E6F1FF" size={12}>{title}</T>
          <L top="52%" s="14%" w="50%" c="#E6F1FF55" />
          <B top="62%" s="14%" w="34%" h="1.2%" c="linear-gradient(90deg,#00D1FF,#7B5CFF)" r={999} />
          <L bottom="8%" s="8%" w="22%" c="#E6F1FF44" />
        </>
      );
    case "doodle":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#FFFDF5" />
          {[18, 30, 42, 54, 66, 78, 90].map((t) => (
            <B key={t} top={`${t}%`} s="0" w="100%" h="1px" c="#93C5FD55" />
          ))}
          <B top="22%" s="7%" w="62%" h="10%" c="#FDE04788" r={3} style={{ transform: "rotate(-2deg)" }} />
          <T top="20%" s="9%" c="#1F2937" size={13}>{title}</T>
          <svg viewBox="0 0 100 20" className="absolute" style={{ top: "36%", insetInlineStart: "8%", width: "52%" }}>
            <path d="M2 12 C 20 4, 40 18, 60 9 S 90 6, 98 11" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <B top="56%" s="9%" w="16%" h="12.8%" c="transparent" r="50%" style={{ border: "2px solid #2563EB" }} />
          <L top="61%" s="30%" w="40%" c="#1F293766" />
          <L top="72%" s="30%" w="28%" c="#1F293744" />
          <svg viewBox="0 0 20 20" className="absolute" style={{ bottom: "8%", insetInlineEnd: "10%", width: "12%" }}>
            <path d="M10 1 L12.5 7.5 L19 8 L14 12.5 L15.5 19 L10 15.5 L4.5 19 L6 12.5 L1 8 L7.5 7.5 Z" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </>
      );
    case "scrapbook":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F3EDE2" />
          <B top="10%" s="10%" w="50%" h="38%" c="linear-gradient(135deg,#F4A261,#E76F51)" style={{ border: "3px solid #fff", boxShadow: "0 3px 8px rgba(0,0,0,0.18)", transform: "rotate(-5deg)" }} />
          <B top="26%" e="8%" w="40%" h="32%" c="linear-gradient(135deg,#7FB7BE,#3D5A80)" style={{ border: "3px solid #fff", boxShadow: "0 3px 8px rgba(0,0,0,0.18)", transform: "rotate(6deg)" }} />
          <B top="7%" s="26%" w="18%" h="6%" c="#F6D365cc" style={{ transform: "rotate(-8deg)" }} />
          <B top="23%" e="20%" w="16%" h="6%" c="#F6D365cc" style={{ transform: "rotate(10deg)" }} />
          <B bottom="10%" s="8%" e="8%" h="24%" c="#FFFFFF" r={4} style={{ boxShadow: "0 2px 5px rgba(0,0,0,0.12)" }} />
          <T bottom="23%" s="13%" c="#2D2A26" size={11}>{title}</T>
          <L bottom="15%" s="13%" w="40%" c="#2D2A2666" />
        </>
      );
    case "steps":
      return (
        <>
          <B top="0" s="0" w="100%" h="100%" c="#F0FDF4" />
          <T top="8%" s="8%" c="#14532D" size={12}>{title}</T>
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div
                className="absolute flex items-center justify-center"
                style={{
                  top: `${30 + i * 22}%`,
                  insetInlineStart: "8%",
                  width: "16%",
                  height: "12.8%",
                  borderRadius: "50%",
                  background: i === 0 ? "#16A34A" : "#BBF7D0",
                  color: i === 0 ? "#fff" : "#14532D",
                  fontSize: "7cqw",
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {i + 1}
              </div>
              <L top={`${32 + i * 22}%`} s="30%" w={`${46 - i * 8}%`} c="#14532D88" />
              <L top={`${38 + i * 22}%`} s="30%" w={`${32 - i * 4}%`} c="#14532D44" />
            </div>
          ))}
        </>
      );
  }
}
