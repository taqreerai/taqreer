"use client";

// Email-lab: paste raw email HTML, give it a subject, send it to dev@taqreer.ai
// (fixed recipient) and check how it actually renders in a real inbox , for
// iterating on CSS gradients + iOS dark-mode behaviour. Dev tool; the API is
// gated (open on localhost, owner-only on prod).

import { useState } from "react";

const RECIPIENT = "dev@taqreer.ai";

export default function EmailLabPage() {
  const [html, setHtml] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  const send = async () => {
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/email-lab/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, subject }),
      });
      const data = await res.json();
      setStatus(
        data.ok
          ? { ok: true, msg: `Sent to ${data.to}` }
          : { ok: false, msg: data.error ?? "Send failed" },
      );
    } catch (err) {
      setStatus({
        ok: false,
        msg: err instanceof Error ? err.message : "Send failed",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      dir="ltr"
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-6 py-10"
    >
      <header>
        <h1 className="text-xl font-semibold">Email HTML sender</h1>
        <p className="mt-1 text-sm text-muted">
          Paste email HTML, hit Send, and it goes to{" "}
          <span className="text-foreground">{RECIPIENT}</span> so you can check
          the look (gradients, iOS dark mode) in a real inbox. Spam folder is
          fine , we just want to see it render.
        </p>
      </header>

      <div>
        <label className="mb-2 block text-sm font-medium">Subject</label>
        <input
          type="text"
          dir="ltr"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="taqreer.ai email test"
          className="input-dark cursor-text"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <label className="mb-2 block text-sm font-medium">HTML</label>
        <textarea
          dir="ltr"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder="<!doctype html> ..."
          spellCheck={false}
          className="input-dark min-h-[420px] flex-1 resize-y cursor-text font-mono text-xs leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={send}
          disabled={sending || !html.trim()}
          className="btn-gradient px-6 py-2.5 disabled:opacity-50 cursor-pointer"
        >
          {sending ? "Sending..." : `Send to ${RECIPIENT}`}
        </button>
        {status && (
          <span
            className={`text-sm ${status.ok ? "text-foreground" : "text-danger"}`}
          >
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
