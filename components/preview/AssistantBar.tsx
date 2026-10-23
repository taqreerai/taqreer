"use client";

// Editor assistant, bottom-bar edition (2026-10-21, owner: "merge everything
// into the AI prompt field at the bottom"). An always-visible prompt beside the
// studio toolbar, ringed by the animated AI stroke (.ai-field), so every user,
// paid or not, sees where to ask. Questions are answered in a card above the
// field; an edit comes back priced and runs only after Confirm (free plans get
// the upgrade popup on edits). Server: app/api/projects/[id]/assistant.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import {
  AssistantBubble,
  isCheckNote,
  useAssistantThread,
  type AssistantContext,
  type AssistantMessageRow,
} from "@/components/preview/AssistantThread";

type Scope = "area" | "slide" | "deck";

// The AI tools that used to sit behind the toolbar's Edit / AI toggle (removed
// 2026-10-21): drawing an area, the no-prompt redesigns and the slide's AI lock.
export type AssistantActions = {
  // Area selection = the canvas's AI draw mode. Free plans get the upgrade popup.
  drawing: boolean;
  onToggleArea: () => void;
  onRegenSlide?: () => void;
  onRegenAll?: () => void;
  regenAllRunning?: boolean;
  onToggleLock?: () => void;
  locked?: boolean;
  applying?: boolean;
};

export function AssistantBar({
  ctx,
  dir,
  actions,
}: {
  ctx: AssistantContext;
  dir: "rtl" | "ltr";
  actions?: AssistantActions;
}) {
  const t = useDict().editor.assistant;
  // A run that just finished may have posted a note (Enhance "Slides to
  // check"): reload the thread when busy turns off (state adjusted during
  // render, the React pattern for reacting to a prop change).
  const [reloadKey, setReloadKey] = useState(0);
  const [wasBusy, setWasBusy] = useState(ctx.busy);
  if (wasBusy !== ctx.busy) {
    setWasBusy(ctx.busy);
    if (!ctx.busy) setReloadKey((k) => k + 1);
  }
  const { messages, setMessages } = useAssistantThread(ctx.projectId, reloadKey);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<AssistantMessageRow[] | null>(null);
  // The card shows the latest exchange; "history" widens it to recent ones.
  const [cardOpen, setCardOpen] = useState(false);
  const [history, setHistory] = useState(false);
  // The newest check note seen so far: one that arrives with a reload after a
  // run opens the card once (the thread's first load only records it).
  const [seenCheck, setSeenCheck] = useState<string | null>(null);
  const latestCheck = messages.findLast(isCheckNote)?.id ?? null;
  if (seenCheck !== latestCheck) {
    setSeenCheck(latestCheck);
    if (reloadKey > 0 && latestCheck) {
      setCardOpen(true);
      setHistory(false);
    }
  }
  const [picked, setPicked] = useState<Scope>("slide");
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A drawn area wins (the user just made it for this); otherwise the pick.
  const scope: Scope = ctx.area && picked !== "deck" ? "area" : picked === "area" ? "slide" : picked;

  const onStatus = useCallback(
    (id: string, status: string) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m))),
    [setMessages],
  );

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending) return;
    if (scope !== "deck" && !ctx.slideId) return;
    setSending(true);
    setErr(null);
    setCardOpen(true);
    setHistory(false);
    const now = new Date().toISOString();
    setPending([
      { id: "pending-user", role: "user", content: message, proposalJson: null, status: null, createdAt: now },
      { id: "pending-bot", role: "assistant", content: "", proposalJson: null, status: null, createdAt: now, pending: true },
    ]);
    try {
      const res = await fetch(`/api/projects/${ctx.projectId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          lang: ctx.lang,
          scope:
            scope === "deck"
              ? { kind: "deck" }
              : scope === "area" && ctx.area
                ? { kind: "area", slideId: ctx.slideId, bounds: ctx.area }
                : { kind: "slide", slideId: ctx.slideId },
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { messages?: AssistantMessageRow[]; error?: string; cap?: number }
        | null;
      if (!res.ok || !data?.messages) {
        setErr(
          data?.error === "assistant_daily_cap"
            ? t.dailyCap.replace("{n}", String(data.cap ?? ""))
            : res.status === 429
              ? t.slowDown
              : t.error,
        );
        return;
      }
      setText("");
      if (scope === "area") {
        ctx.onClearArea();
        if (actions?.drawing) actions.onToggleArea();
      }
      setMessages((prev) => [...prev, ...data.messages!]);
    } catch {
      setErr(t.error);
    } finally {
      setPending(null);
      setSending(false);
    }
  }, [text, sending, scope, ctx, actions, setMessages, t]);

  // Close the card on Escape or a click outside the assistant.
  useEffect(() => {
    if (!cardOpen && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCardOpen(false);
        setMenuOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setCardOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [cardOpen, menuOpen]);

  const thread = pending ? [...messages, ...pending] : messages;
  // Latest exchange = the last user message and what follows it, or a check
  // note posted after it.
  const lastUser = thread.map((m) => m.role).lastIndexOf("user");
  const lastCheck = thread.findLastIndex(isCheckNote);
  const start = Math.max(lastUser, lastCheck);
  const shown = history ? thread.slice(-8) : start >= 0 ? thread.slice(start) : [];
  const tail = `${shown.length}:${shown[shown.length - 1]?.status ?? ""}:${history}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  const chip = (value: Scope, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setPicked(value)}
      aria-pressed={scope === value}
      // 36px: the same height as the send button, one inset from the stroke.
      className={`flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors ${
        scope === value
          ? "bg-[var(--tq-cta-blue)] text-white"
          : "text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground/85"
      }`}
    >
      {label}
    </button>
  );
  const slideLabel = ctx.slideNumber ? t.scopeSlide.replace("{n}", String(ctx.slideNumber)) : null;
  const scopeLabel = scope === "area" ? t.scopeArea : scope === "deck" ? t.scopeDeck : slideLabel ?? t.scopeDeck;
  const menuItems = [
    actions?.onRegenSlide ? { icon: "auto_fix_high", label: t.redesignSlide, run: actions.onRegenSlide, disabled: !!actions.applying || !!actions.locked } : null,
    actions?.onRegenAll ? { icon: "autorenew", label: t.redesignAll, run: actions.onRegenAll, disabled: !!actions.applying || !!actions.regenAllRunning } : null,
    actions?.onToggleLock
      ? { icon: actions.locked ? "lock" : "lock_open", label: actions.locked ? t.unlockSlide : t.lockSlide, run: actions.onToggleLock, disabled: false }
      : null,
  ].filter(<T,>(x: T | null): x is T => x != null);

  return (
    <div ref={rootRef} dir={dir} className="relative">
      {/* Reply card: the latest exchange (or recent history) above the field. */}
      {cardOpen && (shown.length > 0 || err) ? (
        <div
          className="surface-popover absolute inset-x-0 bottom-[calc(100%+10px)] z-40 rounded-2xl border p-3 text-foreground lg:inset-x-auto lg:end-0 lg:w-[380px]"
          style={{ borderColor: "var(--tq-border-hairline)" }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/55">
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
                auto_awesome
              </span>
              {t.tab}
            </span>
            <span className="flex items-center gap-1">
              {messages.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setHistory((v) => !v)}
                  aria-pressed={history}
                  aria-label={t.history}
                  title={t.history}
                  className="btn-icon h-6 w-6 rounded-full text-foreground/55 hover:text-foreground"
                >
                  <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden>
                    history
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setCardOpen(false)}
                aria-label={t.close}
                className="btn-icon h-6 w-6 rounded-full text-foreground/55 hover:text-foreground"
              >
                <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden>
                  close
                </span>
              </button>
            </span>
          </div>
          <div ref={scrollRef} className="max-h-[min(55vh,420px)] space-y-3 overflow-y-auto overscroll-contain">
            {shown.map((m) => (
              <AssistantBubble key={m.id} m={m} ctx={ctx} onStatus={onStatus} />
            ))}
            {err ? <p className="text-[12px] text-[var(--tq-text-danger)]">{err}</p> : null}
          </div>
        </div>
      ) : null}

      {/* AI menu: the no-prompt redesigns and the slide's AI lock. */}
      {menuOpen && menuItems.length > 0 ? (
        <div
          role="menu"
          className="surface-menu absolute bottom-[calc(100%+10px)] end-0 z-40 min-w-[220px] rounded-xl border p-1 text-foreground"
          style={{ borderColor: "var(--tq-border-hairline)" }}
        >
          {menuItems.map((it) => (
            <button
              key={it.icon}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setMenuOpen(false);
                it.run();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-[13px] text-foreground/85 transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[18px] leading-none text-foreground/60" aria-hidden>
                {it.icon}
              </span>
              {it.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* The field: area, scope, the prompt, menu, send. Full width of the dock
          on tablets and phones; a fixed-width pill beside the toolbar on desktop. */}
      {/* Sizing: the send button sits CONCENTRIC in the field's rounded end, an
          equal 8px from the stroke on every side (52px field, 36px button; 56 / 40
          on phones, where the button is the thumb target). */}
      <div className="ai-field flex h-[52px] w-full items-center gap-1 px-2 max-md:h-14 lg:w-[min(460px,36vw)] lg:min-w-[320px]">
        {actions ? (
          <button
            type="button"
            onClick={actions.onToggleArea}
            aria-pressed={actions.drawing}
            aria-label={actions.drawing ? t.areaCancel : t.areaPick}
            title={actions.drawing ? t.areaCancel : t.areaPick}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors max-md:hidden ${
              actions.drawing ? "bg-[var(--tq-cta-blue)] text-white" : "text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground"
            }`}
          >
            <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>
              {actions.drawing ? "close" : "highlight_alt"}
            </span>
          </button>
        ) : null}
        {/* Scope: every option as a chip where there is room ... */}
        <div className="hidden shrink-0 items-center gap-0.5 sm:flex" role="group" aria-label={t.scopeAria}>
          {ctx.area ? chip("area", t.scopeArea) : null}
          {slideLabel ? chip("slide", slideLabel) : null}
          {chip("deck", t.scopeDeck)}
        </div>
        {/* ... one chip that switches on a phone. */}
        <button
          type="button"
          onClick={() => setPicked(scope === "deck" ? (ctx.area ? "area" : "slide") : "deck")}
          aria-label={`${t.scopeAria}: ${scopeLabel}`}
          // Same height as the send button (40px on phones), so both ends of the
          // field share one inset from the stroke.
          className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--tq-cta-blue)] ps-3.5 pe-2.5 text-[12px] font-medium text-white sm:hidden"
        >
          {scopeLabel}
          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden>
            swap_horiz
          </span>
        </button>
        <input
          type="text"
          dir={text ? "auto" : dir}
          value={text}
          maxLength={1000}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            if (messages.length > 0 || err) setCardOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={ctx.area ? t.placeholderArea : actions?.drawing ? t.drawHint : t.placeholder}
          aria-label={t.placeholder}
          disabled={sending}
          className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-foreground outline-none placeholder:text-foreground/40 max-md:text-base"
        />
        {menuItems.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v);
              setCardOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t.menu}
            title={t.menu}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/[0.07] hover:text-foreground max-md:h-10 max-md:w-10"
          >
            <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden>
              more_horiz
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          aria-label={t.send}
          aria-busy={sending || undefined}
          className="btn-gradient-anim flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40 max-md:h-10 max-md:w-10"
        >
          <span className={`material-symbols-outlined text-[18px] leading-none ${sending ? "animate-spin" : ""}`}>
            {sending ? "progress_activity" : "arrow_upward"}
          </span>
        </button>
      </div>
    </div>
  );
}
