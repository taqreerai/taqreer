"use client";

// Admin > Broadcast. Static Phase-0 screen: compose a notification (title +
// message) with a live bell preview, send to all users (confirm), and a history
// list. State is local over mock data; the wiring phase fans out via
// fanOutNotification to every user's bell. English-only, dark-only, LTR.

import { useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { IconCircle } from "@/components/admin/IconCircle";
import {
  MOCK_BROADCASTS,
  MOCK_USERS,
  type BroadcastItem,
} from "@/lib/admin/mock";

const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

export default function AdminBroadcastPage() {
  const recipients = MOCK_USERS.length;
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<BroadcastItem[]>(MOCK_BROADCASTS);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSend = title.trim().length > 0 && message.trim().length > 0;

  const send = () => {
    const today = new Date().toISOString().slice(0, 10);
    setHistory((prev) => [
      {
        id: `b-${prev.length + 1}-${today}`,
        title: title.trim(),
        message: message.trim(),
        sentAt: today,
        recipients,
      },
      ...prev,
    ]);
    setTitle("");
    setMessage("");
    setConfirmOpen(false);
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
            disabled={!canSend}
            onClick={() => setConfirmOpen(true)}
            className="btn-gradient w-full rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          >
            Send to all {recipients} users
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
      </div>

      <AdminModal
        open={confirmOpen}
        title={`Send to all ${recipients} users?`}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: MUTED }}>
            This pushes a notification to every user&apos;s bell. In production it
            fans out to all {recipients} users and can&apos;t be unsent.
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
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium"
            >
              Send now
            </button>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
