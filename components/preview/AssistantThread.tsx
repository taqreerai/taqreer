"use client";

// Editor assistant (2026-10-21): the thread state, the message bubbles and the
// priced proposal card, shown by AssistantBar above the bottom prompt. The user
// asks a question or describes a change for an area, the focused slide or the
// whole deck; an edit comes back as a priced proposal that runs only after
// Confirm (server: app/api/projects/[id]/assistant, lib/assistant/assistant.ts).

import { useEffect, useState } from "react";
import { useDict } from "@/components/i18n/LocaleProvider";
import { useCreditBalance } from "@/lib/credits/store";
import { isCreditGatePayload, type CreditGatePayload } from "@/components/credits/CreditGateDialog";
import type { CommentBounds } from "@/lib/types/comment";

export type AssistantContext = {
  projectId: string;
  lang: "ar" | "en";
  slideId: string | null;
  slideNumber: number | null;
  // A box drawn in AI mode on the focused slide (null = none).
  area: CommentBounds | null;
  onClearArea: () => void;
  // The partial regen started: DeckView shows its applying overlay.
  onApplied: (r: { versionId: string; targetSlideIds: string[] }) => void;
  // Free plan or not enough credits: DeckView opens the upgrade / top-up dialog.
  onGate: (g: CreditGatePayload) => void;
  // An AI image proposal: DeckView re-rolls the box (charged by the image
  // regen route, gates opened there) and writes the new prompt to the slide.
  onImageEdit: (r: { slideId: string; genid: string; change: string }) => Promise<boolean>;
  // Generation / another regen running, or the user can't edit right now.
  busy: boolean;
};

type Proposal = {
  kind?: "slides" | "image";
  genid?: string;
  change?: string;
  instruction: string;
  slideIds: string[];
  slideNumbers: number[];
  cost: number;
  gate: CreditGatePayload | null;
};

export type AssistantMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposalJson: Proposal | { scope: unknown } | null;
  status: string | null;
  createdAt: string;
  pending?: boolean;
};

export function useAssistantThread(projectId: string | null) {
  const [messages, setMessages] = useState<AssistantMessageRow[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    fetch(`/api/projects/${projectId}/assistant`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages?: AssistantMessageRow[] } | null) => {
        if (alive && d?.messages) setMessages(d.messages);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);
  return { messages, setMessages };
}

function isProposal(p: AssistantMessageRow["proposalJson"]): p is Proposal {
  return !!p && Array.isArray((p as Proposal).slideIds) && typeof (p as Proposal).cost === "number";
}

export function AssistantBubble({
  m,
  ctx,
  onStatus,
}: {
  m: AssistantMessageRow;
  ctx: AssistantContext;
  onStatus: (id: string, status: string) => void;
}) {
  const t = useDict().editor.assistant;
  const credit = useCreditBalance();
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p
          dir="auto"
          className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-foreground/[0.08] px-3 py-2 text-[12px] leading-relaxed text-foreground/85"
        >
          {m.content}
        </p>
      </div>
    );
  }
  if (m.pending) {
    return (
      <p className="flex items-center gap-2 px-1 py-1 text-[12px] text-foreground/50">
        <span className="spinner h-3 w-3 shrink-0 rounded-full border border-foreground/20 border-t-foreground/60" />
        {t.thinking}
      </p>
    );
  }

  const p = isProposal(m.proposalJson) ? m.proposalJson : null;
  const act = async (action: "apply" | "cancel") => {
    setWorking(true);
    setErr(null);
    try {
      if (action === "apply" && p?.kind === "image" && p.genid) {
        const ok = await ctx.onImageEdit({ slideId: p.slideIds[0], genid: p.genid, change: p.change ?? p.instruction });
        if (!ok) return; // DeckView showed the gate, or the box is unchanged
        await fetch(`/api/projects/${ctx.projectId}/assistant/${m.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "done" }),
        }).catch(() => {});
        onStatus(m.id, "applied");
        return;
      }
      const res = await fetch(`/api/projects/${ctx.projectId}/assistant/${m.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as
        | { versionId?: string; targetSlideIds?: string[]; error?: string }
        | CreditGatePayload
        | null;
      if (res.status === 402 && isCreditGatePayload(data)) {
        ctx.onGate(data);
        return;
      }
      if (!res.ok) {
        const code = (data as { error?: string } | null)?.error;
        setErr(code === "proposal_expired" ? t.expired : t.applyFailed);
        if (code === "proposal_expired") onStatus(m.id, "cancelled");
        return;
      }
      if (action === "cancel") {
        onStatus(m.id, "cancelled");
        return;
      }
      const ok = data as { versionId?: string; targetSlideIds?: string[] };
      if (ok.versionId) ctx.onApplied({ versionId: ok.versionId, targetSlideIds: ok.targetSlideIds ?? p?.slideIds ?? [] });
      onStatus(m.id, "applied");
    } catch {
      setErr(t.applyFailed);
    } finally {
      setWorking(false);
    }
  };

  const slidesLabel = p
    ? p.kind === "image"
      ? t.oneImage.replace("{n}", String(p.slideNumbers[0]))
      : p.slideNumbers.length === 1
      ? t.oneSlide.replace("{n}", String(p.slideNumbers[0]))
      : t.manySlides.replace("{n}", String(p.slideNumbers.length))
    : "";
  const locked = p?.gate?.error === "ai_edit_locked";
  const balance = credit?.isAdmin ? null : credit?.balance.total ?? null;

  return (
    <div className="space-y-2">
      <p dir="auto" className="whitespace-pre-wrap px-1 text-[12px] leading-relaxed text-foreground/85">
        {m.content}
      </p>
      {p ? (
        <div className="surface-card space-y-2 rounded-2xl p-3">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="font-medium text-foreground/80">{slidesLabel}</span>
            <span className="font-semibold text-foreground">{t.cost.replace("{n}", String(p.cost))}</span>
          </div>
          {balance != null && m.status === "proposed" && !locked ? (
            <p className="text-[11px] text-foreground/50">{t.balance.replace("{n}", String(balance))}</p>
          ) : null}
          {m.status === "proposed" ? (
            locked ? (
              <div className="space-y-2">
                <p className="text-[11px] text-foreground/60">{t.lockedNote}</p>
                <button type="button" className="btn-gradient w-full rounded-full px-3 py-1.5 text-[12px]" onClick={() => p.gate && ctx.onGate(p.gate)}>
                  {t.upgrade}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={working || ctx.busy}
                  onClick={() => void act("apply")}
                  className="btn-gradient flex-1 rounded-full px-3 py-1.5 text-[12px] disabled:opacity-50"
                >
                  {working ? t.applying : t.confirm}
                </button>
                <button type="button" disabled={working} onClick={() => void act("cancel")} className="btn-pill">
                  {t.cancel}
                </button>
              </div>
            )
          ) : (
            <p className="text-[11px] text-foreground/50">
              {m.status === "applied" ? t.applied : m.status === "cancelled" ? t.cancelled : t.applying}
            </p>
          )}
          {err ? <p className="text-[11px] text-[var(--tq-text-danger)]">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
