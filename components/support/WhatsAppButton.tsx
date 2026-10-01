"use client";

// WhatsApp support entry points (owner request 2026-09-30). Two surfaces,
// one link:
//
// - WhatsAppButton: the floating button, mounted once in the root layout. It
//   serves the public site (marketing, legal, auth). Anchored to the
//   inline-END bottom corner (.support-fab-anchor in globals.css), so it
//   mirrors with the locale: bottom-right in English, bottom-left in Arabic,
//   and rides above the cookie banner while that shows.
// - WhatsAppToolbarButton: a brand-blue circular "?" button in the
//   TopUtilityBar, shared by the dashboard and the studio. It opens a help
//   popover whose action contacts us on WhatsApp (2026-10-01).
//   Wherever it renders, the floating button hides
//   (`body:has(.tq-support-toolbar)` in globals.css), so the app shows the
//   toolbar icon only and the studio canvas stays clear.
//
// Both reach WhatsApp with a greeting in the user's language (editable before
// sending).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Tooltip } from "@/components/common/Tooltip";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { stripLocale } from "@/lib/i18n/navigation";

// +1 (585) 548-6500, digits only for wa.me.
const WHATSAPP_NUMBER = "15855486500";

function useWhatsAppLink() {
  const t = useDict().components.supportWidget;
  return {
    label: t.whatsappLabel,
    href: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t.whatsappGreeting)}`,
  };
}

// WhatsApp glyph (Simple Icons, CC0), tinted via currentColor.
function WhatsAppGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export function WhatsAppButton() {
  const pathname = usePathname();
  const { dir } = useLocale();
  const { label, href } = useWhatsAppLink();

  // Belt and braces for the studio canvas: it carries the toolbar icon (which
  // hides this via CSS), but never float over slides even without :has().
  if (stripLocale(pathname ?? "/").startsWith("/project/")) return null;

  return (
    <Tooltip
      label={label}
      // The pill opens toward the page, away from the screen edge.
      placement={dir === "rtl" ? "right" : "left"}
      className="support-fab-anchor"
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="support-fab"
      >
        <WhatsAppGlyph size={26} />
      </a>
    </Tooltip>
  );
}

// `compact`: the studio header on phones, where the bar hides secondary icons
// to keep Export/Share in view (same rule as its Home + Search buttons).
//
// Brand-blue help button (2026-10-01). A click opens a small help popover
// whose action is "Contact us via WhatsApp"; the icon itself never jumps to
// WhatsApp. Portal'd + fixed like the bell popover so the header's blur and
// overflow can't clip it; closes on outside click, Escape, or the action.
export function WhatsAppToolbarButton({ compact = false }: { compact?: boolean }) {
  const t = useDict().components.supportWidget;
  const { dir } = useLocale();
  const { href } = useWhatsAppLink();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; start: number } | null>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open) return setPos(null);
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Align the popover's inline-end edge with the trigger's, so it opens
    // toward the page in both directions.
    setPos({
      top: r.bottom + 8,
      start: dir === "rtl" ? r.left : window.innerWidth - r.right,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      if (triggerRef.current?.contains(e.target)) return;
      if (e.target.closest("[data-help-popover]")) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const close = () => setPos(null);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <Tooltip
        label={t.helpLabel}
        disabled={open}
        placement="bottom"
        className={compact ? "hidden md:inline-flex" : "inline-flex"}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-label={t.helpLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          // Full h-9 hit area like its siblings; the visible mark is a small
          // blue circle with a white "?", sized to the neighbouring search
          // glyph (2026-10-01).
          className="tq-support-toolbar group flex h-9 w-9 items-center justify-center rounded-lg"
        >
          <span className="support-toolbar-btn flex h-5 w-5 items-center justify-center rounded-full">
            <span
              // Inline size: the unlayered .material-symbols-outlined rule
              // beats Tailwind text-[..] utilities on this glyph.
              className="material-symbols-outlined"
              style={{ fontSize: 13, lineHeight: 1, fontVariationSettings: "'wght' 600" }}
              aria-hidden="true"
            >
              question_mark
            </span>
          </span>
        </button>
      </Tooltip>

      {open && pos
        ? createPortal(
            <div
              dir={dir}
              data-help-popover
              role="dialog"
              aria-label={t.popoverTitle}
              className="in-slide-popover fixed z-[1100] w-72 rounded-2xl p-4"
              style={{
                top: pos.top,
                [dir === "rtl" ? "left" : "right"]: pos.start,
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.popoverTitle}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--tq-text-muted)]">
                    {t.popoverBody}
                  </p>
                </div>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setPos(null)}
                  className="support-whatsapp-cta"
                >
                  <WhatsAppGlyph size={18} />
                  {t.whatsappCta}
                </a>
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
