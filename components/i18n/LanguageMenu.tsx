"use client";

// Chrome language chooser — the `translate` icon button + a dropdown menu, using
// the same surface-popover surface, MenuItem rows, portal, and outside-click/Esc
// dismissal as the app's other dashboard menus (TemplateActionsMenu /
// ProjectActionsMenu). Picking a language swaps the locale segment on the CURRENT
// path (so you stay on the page) and writes a cookie so the choice persists and
// the proxy honours it on the next bare-URL visit.
//
// CHROME locale only — the slide canvas direction is independent (it comes from
// the deck's manifest.direction), so nothing here ever touches the canvas.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useDict } from "@/components/i18n/LocaleProvider";
import { Tooltip } from "@/components/common/Tooltip";
import { switchLocaleHref } from "@/lib/i18n/navigation";
import { locales, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";

const MENU_WIDTH = 150;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_EDGE_INSET_PX = 12;

export function LanguageMenu({ className = "" }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useLocale();
  const dict = useDict();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const labelFor = (code: Locale) => (code === "ar" ? dict.language.ar : dict.language.en);

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    // Persist to the account too, so the choice follows the user across
    // browsers/devices (the cookie above is the immediate per-browser effect).
    // Fire-and-forget; anonymous users get a 401 here, which we ignore.
    void fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
    router.push(switchLocaleHref(pathname, next));
  };

  const toggle = () => {
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((v) => !v);
  };

  // Outside click + Esc — same dismissal contract as the other dashboard menus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (surfaceRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Right/end-anchored under the trigger (clamped to the viewport), opening down.
  const left = rect
    ? Math.max(
        VIEWPORT_EDGE_INSET_PX,
        Math.min(
          rect.right - MENU_WIDTH,
          window.innerWidth - MENU_WIDTH - VIEWPORT_EDGE_INSET_PX,
        ),
      )
    : 0;
  const top = rect ? rect.bottom + ANCHOR_GAP_PX : 0;

  return (
    <>
      {/* Tooltip suppressed while the menu is open so it doesn't sit under the
          dropdown (both anchor below the trigger). */}
      <Tooltip label={dict.language.label} placement="bottom" disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-label={dict.language.label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-white ${className}`}
        >
          <span className="material-symbols-outlined text-[20px]">translate</span>
        </button>
      </Tooltip>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open && rect ? (
                <motion.div
                  key="language-menu"
                  ref={surfaceRef}
                  role="menu"
                  aria-label={dict.language.label}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="surface-menu fixed z-[1100] overflow-hidden rounded-xl"
                  style={{ top, left, width: MENU_WIDTH }}
                >
                  <ul className="flex flex-col p-1.5">
                    {locales.map((code) => (
                      <li role="none" key={code}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={code === locale}
                          onClick={() => choose(code)}
                          className="dropdown-item"
                        >
                          {/* Leading check on the active locale; a same-size
                              invisible glyph on the others keeps labels aligned. */}
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 18, opacity: code === locale ? 1 : 0 }}
                            aria-hidden
                          >
                            check
                          </span>
                          <span className="flex-1 text-start">{labelFor(code)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
