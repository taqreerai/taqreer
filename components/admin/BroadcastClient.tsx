"use client";

// Admin > Broadcast (client). Compose a platform-wide announcement (single
// title + message), preview it as a bell row, and send to every user via
// POST /api/admin/broadcast. The recipient count + history come from the server
// page; a successful send prepends the new row to the history list.

import { useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { IconCircle } from "@/components/admin/IconCircle";
import type { BroadcastItem } from "@/lib/admin/mock";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

export function BroadcastClient({
  recipientCount,
  initialHistory,
}: {
  recipientCount: number;
  initialHistory: BroadcastItem[];
}) {
  const recipients = recipientCount;
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<BroadcastItem[]>(initialHistory);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const canSend = title.trim().length > 0 && message.trim().length > 0;

  const send = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), message: message.trim() }),
      });
      if (!res.ok) throw new Error("broadcast failed");
      const data = (await res.json()) as {
        broadcast: {
          id: string;
          title: string;
          message: string;
          recipientCount: number;
          createdAt: string;
        };
      };
      const b = data.broadcast;
      setHistory((prev) => [
        {
          id: b.id,
          title: b.title,
          message: b.message,
          sentAt: b.createdAt.slice(0, 10),
          recipients: b.recipientCount,
        },
        ...prev,
      ]);
      setTitle("");
      setMessage("");
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
          <span className="text-sm font-semibold" style={{ color: PRIMARY }}>
            Compose
          </span>
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Short headline"
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
              maxLength={280}
              rows={4}
              placeholder="What do you want every user to see?"
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
        </div>

        {/* Live bell preview */}
        <div className="space-y-2">
          <span className="text-xs font-medium" style={{ color: MUTED }}>
            Bell preview
          </span>
          <div className="surface-card flex items-start gap-3 rounded-xl p-4">
            <IconCircle icon="campaign" size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                {title.trim() || "Notification title"}
              </div>
              <div className="text-sm" style={{ color: MUTED }}>
                {message.trim() || "Your message to all users appears here."}
              </div>
              <div className="mt-1 text-xs" style={{ color: MUTED }}>
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
          </p>
          <div className="surface-card rounded-lg p-3">
            <div className="text-sm font-medium" style={{ color: PRIMARY }}>
              {title.trim()}
            </div>
            <div className="text-sm" style={{ color: MUTED }}>
              {message.trim()}
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
