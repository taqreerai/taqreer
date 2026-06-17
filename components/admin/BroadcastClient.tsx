"use client";

// Admin > Broadcast (client). Compose a BILINGUAL platform-wide announcement:
// an EN/AR toggle swaps the title+message fields, both languages are required,
// and the bell preview follows the toggle. On send the payload carries both
// languages; each user's bell renders the version matching their locale. The
// recipient count + history come from the server page (history in the admin's
// own locale); a successful send prepends the new row.

import { useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { IconCircle } from "@/components/admin/IconCircle";
import type { BroadcastItem } from "@/lib/admin/mock";

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

type Lang = "en" | "ar";
const LANG_LABEL: Record<Lang, string> = { en: "English", ar: "العربية" };

export function BroadcastClient({
  recipientCount,
  initialHistory,
  lang,
}: {
  recipientCount: number;
  initialHistory: BroadcastItem[];
  lang: Lang;
}) {
  const recipients = recipientCount;
  const [composeLang, setComposeLang] = useState<Lang>("en");
  const [titleEn, setTitleEn] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [messageAr, setMessageAr] = useState("");
  const [history, setHistory] = useState<BroadcastItem[]>(initialHistory);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const enDone = titleEn.trim().length > 0 && messageEn.trim().length > 0;
  const arDone = titleAr.trim().length > 0 && messageAr.trim().length > 0;
  const canSend = enDone && arDone;

  // Bind the visible fields to the toggled language.
  const isAr = composeLang === "ar";
  const title = isAr ? titleAr : titleEn;
  const setTitle = isAr ? setTitleAr : setTitleEn;
  const message = isAr ? messageAr : messageEn;
  const setMessage = isAr ? setMessageAr : setMessageEn;
  const fieldDir = isAr ? "rtl" : "ltr";

  const send = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          en: { title: titleEn.trim(), message: messageEn.trim() },
          ar: { title: titleAr.trim(), message: messageAr.trim() },
        }),
      });
      if (!res.ok) throw new Error("broadcast failed");
      const data = (await res.json()) as {
        broadcast: {
          id: string;
          titleEn: string;
          messageEn: string;
          titleAr: string;
          messageAr: string;
          recipientCount: number;
          createdAt: string;
        };
      };
      const b = data.broadcast;
      setHistory((prev) => [
        {
          id: b.id,
          title: lang === "ar" ? b.titleAr : b.titleEn,
          message: lang === "ar" ? b.messageAr : b.messageEn,
          sentAt: b.createdAt.slice(0, 10),
          recipients: b.recipientCount,
        },
        ...prev,
      ]);
      setTitleEn("");
      setMessageEn("");
      setTitleAr("");
      setMessageAr("");
      setConfirmOpen(false);
    } catch {
      // leave the modal open so the admin can retry
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Compose + preview */}
      <div className="space-y-4">
        <div className="surface-card space-y-4 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
              Compose
            </span>
            {/* EN/AR toggle - a check appears when that side is complete. */}
            <div
              className="flex gap-1 rounded-lg p-1"
              style={{ background: "var(--tq-overlay-soft)" }}
            >
              {(["en", "ar"] as const).map((l) => {
                const active = composeLang === l;
                const done = l === "en" ? enDone : arDone;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setComposeLang(l)}
                    className="flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: active ? "var(--tq-overlay)" : "transparent",
                      color: active ? PRIMARY : MUTED,
                    }}
                  >
                    {LANG_LABEL[l]}
                    {done ? (
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14, color: ACCENT }}
                      >
                        check_circle
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              dir={fieldDir}
              maxLength={80}
              placeholder={isAr ? "عنوان قصير" : "Short headline"}
              className="h-10 w-full rounded-lg px-3 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              dir={fieldDir}
              maxLength={280}
              rows={4}
              placeholder={
                isAr ? "ما الذي تريد أن يراه كل المستخدمين؟" : "What do you want every user to see?"
              }
              className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <div className="text-end text-xs" style={{ color: MUTED }}>
              {message.length}/280
            </div>
          </div>
          <button
            type="button"
            disabled={!canSend || sending}
            onClick={() => setConfirmOpen(true)}
            className="btn-gradient w-full rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          >
            Send to all {recipients.toLocaleString("en-US")} users
          </button>
          {!canSend ? (
            <p className="text-center text-xs" style={{ color: MUTED }}>
              Both English and Arabic are required.
            </p>
          ) : null}
        </div>

        {/* Live bell preview (the toggled language) */}
        <div className="space-y-2">
          <span className="text-xs font-medium" style={{ color: MUTED }}>
            Bell preview ({LANG_LABEL[composeLang]})
          </span>
          <div className="surface-card flex items-start gap-3 rounded-xl p-4">
            <IconCircle icon="campaign" size={36} />
            <div className="min-w-0 flex-1" dir={fieldDir}>
              <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                {title.trim() || (isAr ? "عنوان الإشعار" : "Notification title")}
              </div>
              <div className="text-sm" style={{ color: MUTED }}>
                {message.trim() ||
                  (isAr ? "رسالتك لكل المستخدمين تظهر هنا." : "Your message to all users appears here.")}
              </div>
              <div className="mt-1 text-xs" style={{ color: MUTED }} dir="ltr">
                now
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="space-y-3">
        <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
          Sent broadcasts
        </span>
        {history.length === 0 ? (
          <p
            className="surface-card rounded-xl p-6 text-center text-sm"
            style={{ color: MUTED }}
          >
            No broadcasts sent yet.
          </p>
        ) : (
          <div className="surface-card rounded-xl px-5">
            {history.map((b, i) => (
              <div
                key={b.id}
                className="py-4"
                style={
                  i === history.length - 1
                    ? undefined
                    : { borderBottom: "1px solid var(--tq-border-hairline)" }
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: PRIMARY }}>
                    {b.title}
                  </span>
                  <span className="text-xs" style={{ color: MUTED }}>
                    {b.sentAt}
                  </span>
                </div>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>
                  {b.message}
                </p>
                <div
                  className="mt-2 flex items-center gap-1 text-xs"
                  style={{ color: MUTED }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                    group
                  </span>
                  {b.recipients.toLocaleString("en-US")} recipients
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdminModal
        open={confirmOpen}
        title={`Send to all ${recipients.toLocaleString("en-US")} users?`}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: MUTED }}>
            This pushes a notification to every user&apos;s bell (
            {recipients.toLocaleString("en-US")} users) and can&apos;t be unsent.
            Each user sees their own language.
          </p>
          <div className="space-y-2">
            <div className="surface-card rounded-lg p-3">
              <div className="text-[10px] font-medium uppercase" style={{ color: MUTED }}>
                English
              </div>
              <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                {titleEn.trim()}
              </div>
              <div className="text-sm" style={{ color: MUTED }}>
                {messageEn.trim()}
              </div>
            </div>
            <div className="surface-card rounded-lg p-3" dir="rtl">
              <div
                className="text-[10px] font-medium uppercase"
                style={{ color: MUTED }}
                dir="ltr"
              >
                Arabic
              </div>
              <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                {titleAr.trim()}
              </div>
              <div className="text-sm" style={{ color: MUTED }}>
                {messageAr.trim()}
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send now"}
            </button>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
