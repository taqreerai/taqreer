"use client";

// PersistentRow — the "عنصر ثابت على كل الشرائح" control (flow-card
// redesign). Just a text input now: the position picker was removed
// 2026-06-02 (user direction) — only the LOGO corner is reserved, and
// Claude freestyles where the persistent overlay sits (chrome-locked
// across the deck). The cover/closing exclude pills are gone too — the
// persistent footer is, by definition, on every slide.
//
// Pure UI; the parent owns the text state. `language` drives the input
// direction so an English footer ("© 2026 · taqreer.ai") types LTR and an
// Arabic one types RTL.

import { useDict } from "@/components/i18n/LocaleProvider";

export function PersistentRow({
  text,
  language = "ar",
  onText,
}: {
  text: string;
  language?: "ar" | "en";
  onText: (s: string) => void;
}) {
  const dict = useDict();
  return (
    <input
      type="text"
      value={text}
      onChange={(event) => onText(event.target.value)}
      placeholder={dict.flows.brand.persistentPlaceholder}
      aria-label={dict.flows.brand.persistentAria}
      dir={language === "en" ? "ltr" : "rtl"}
      className="input-dark w-full text-xs"
      style={{ height: 32 }}
    />
  );
}
