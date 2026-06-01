"use client";

// PersistentRow — the "عنصر ثابت على كل الشرائح" control as ONE row
// (flow-card redesign): a smaller text input + the compact
// PositionDropdown beside it. The cover/closing exclude pills are gone —
// the persistent footer is, by definition, on every slide.
//
// Pure UI; the parent owns the text + position state. `language` drives
// the input direction so an English footer ("© 2026 · taqreer.ai") types
// LTR and an Arabic one types RTL.

import { PositionDropdown, type CornerPosition } from "@/components/create/controls";

export function PersistentRow({
  text,
  position,
  language = "ar",
  onText,
  onPosition,
}: {
  text: string;
  position: CornerPosition;
  language?: "ar" | "en";
  onText: (s: string) => void;
  onPosition: (p: CornerPosition) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder="عنصر ثابت. مثل: التاريخ، الموقع الإلكتروني"
          aria-label="عنصر ثابت على كل الشرائح"
          dir={language === "en" ? "ltr" : "rtl"}
          className="input-dark min-w-0 flex-1 text-xs"
          style={{ height: 32 }}
        />
        <PositionDropdown
          value={position}
          onChange={onPosition}
          disabled={!text.trim()}
        />
      </div>
    </div>
  );
}
