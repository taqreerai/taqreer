"use client";

// EnhanceQuestionsDialog - the three general questions /enhance asks after
// Generate, once the file is analysed (owner, 2026-10-22, after Gamma's
// "Beautify"): wording, pictures (when the deck has some), audience and
// display. Each is preselected (lib/enhance/answers.ts recommendedAnswers),
// so one click on Start gives what Auto gave. The option labels lean on the
// analysis (lib/extract/enhance-questions.ts); a missing one falls back to the
// dictionary. "Something else..." keeps the suggested value and adds the
// user's words to the instructions. Rendered only when the analysis wrote
// labels, and only while open (fresh state on every open).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import {
  recommendedAnswers,
  type DisplayChoice,
  type EnhanceAnswers,
  type EnhanceOptionKey,
  type EnhanceQuestions,
  type PicturesChoice,
  type QuestionKey,
  type WordingChoice,
} from "@/lib/enhance/answers";

export function EnhanceQuestionsDialog({
  questions,
  decision,
  imagesOn,
  onClose,
  onStart,
}: {
  // The analysis's labels for this deck.
  questions: EnhanceQuestions;
  decision: { mode: "rework" | "preserve" } | null;
  imagesOn: boolean;
  onClose: () => void;
  // notes: the "Something else" text, one labelled line per question ("" for none).
  onStart: (answers: EnhanceAnswers, notes: string) => void;
}) {
  const dict = useDict();
  const copy = dict.flows.enhanceQuestions;
  const suggested = recommendedAnswers(decision, questions, imagesOn);
  const [answers, setAnswers] = useState<EnhanceAnswers>(suggested);
  const [other, setOther] = useState<Partial<Record<QuestionKey, string>>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = (k: EnhanceOptionKey) => questions.labels[k] ?? copy.options[k];
  // Replace and redraw make new pictures, so they need AI images on.
  const pictureOptions: PicturesChoice[] = imagesOn ? ["keep", "refresh", "replace", "redraw"] : ["keep", "refresh"];
  const groups: { key: QuestionKey; title: string; options: EnhanceOptionKey[] }[] = [
    { key: "wording", title: copy.wording, options: ["exact", "tidy"] satisfies WordingChoice[] },
    ...(questions.pictures ? [{ key: "pictures" as const, title: copy.pictures, options: pictureOptions }] : []),
    { key: "display", title: copy.display, options: ["projected", "screen"] satisfies DisplayChoice[] },
  ];

  const start = () => {
    // Each note reads "question answer", in the user's language.
    const notes = groups
      .map((g) => {
        const text = other[g.key]?.trim();
        return text ? `${g.title} ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
    // A question answered with "Something else" keeps the suggested value.
    const final = { ...answers };
    for (const g of groups) if (other[g.key] !== undefined) (final as Record<QuestionKey, string>)[g.key] = suggested[g.key];
    onStart(final, notes);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={onClose}
        className="modal-dim fixed inset-0 z-[1200]"
      />
      <div className="pointer-events-none fixed inset-0 z-[1201] flex items-center justify-center p-4">
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="enhance-questions-title"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.97, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="surface-modal pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-2xl"
        >
          <header className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
            <div>
              <h3 id="enhance-questions-title" className="mb-1 text-xl font-bold text-foreground">
                {copy.title}
              </h3>
              <p className="text-sm text-muted">{copy.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={dict.common.close}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                close
              </span>
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-2">
            {questions.flatPages ? (
              <p className="rounded-xl border border-[var(--tq-border-hairline)] p-3 text-sm text-muted">{copy.flatPages}</p>
            ) : null}
            {groups.map((g) => (
              <fieldset key={g.key} className="rounded-xl border border-[var(--tq-border-hairline)] p-3">
                <legend className="sr-only">{g.title}</legend>
                <p aria-hidden className="mb-2 px-1 text-sm font-semibold text-foreground">
                  {g.title}
                </p>
                <div className="flex flex-col gap-1">
                  {g.options.map((opt, i) => {
                    const active = other[g.key] === undefined && answers[g.key] === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setAnswers((a) => ({ ...a, [g.key]: opt }));
                          setOther((o) => {
                            const next = { ...o };
                            delete next[g.key];
                            return next;
                          });
                        }}
                        className={`pick-tile flex items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm ${active ? "is-active text-foreground" : "border-transparent text-foreground/75"}`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${active ? "bg-[var(--tq-brand-blue)] text-white" : "bg-[var(--tq-overlay-soft)] text-foreground/60"}`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{label(opt)}</span>
                        {suggested[g.key] === opt ? (
                          <span className="shrink-0 text-[11px] font-medium text-foreground/45">{copy.recommended}</span>
                        ) : null}
                      </button>
                    );
                  })}
                  {other[g.key] === undefined ? (
                    <button
                      type="button"
                      onClick={() => setOther((o) => ({ ...o, [g.key]: "" }))}
                      className="pick-tile flex items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-start text-sm text-foreground/55"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--tq-overlay-soft)]">
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: 15 }}>
                          edit
                        </span>
                      </span>
                      {copy.other}
                    </button>
                  ) : (
                    <div className="pick-tile is-active flex items-center gap-3 rounded-lg px-3 py-1.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--tq-brand-blue)] text-white">
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: 15 }}>
                          edit
                        </span>
                      </span>
                      <input
                        autoFocus
                        value={other[g.key]}
                        maxLength={300}
                        onChange={(e) => setOther((o) => ({ ...o, [g.key]: e.target.value }))}
                        placeholder={copy.otherPlaceholder}
                        aria-label={`${g.title} ${copy.other}`}
                        className="min-w-0 flex-1 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-foreground/40"
                      />
                    </div>
                  )}
                </div>
              </fieldset>
            ))}
          </div>

          <footer className="flex justify-center px-6 pb-6 pt-4">
            <button type="button" onClick={start} className="btn-gradient-anim inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold">
              <span className="material-symbols-outlined leading-none" style={{ fontSize: 18 }}>
                auto_fix_high
              </span>
              {copy.start}
            </button>
          </footer>
        </motion.div>
      </div>
    </>,
    document.body,
  );
}
