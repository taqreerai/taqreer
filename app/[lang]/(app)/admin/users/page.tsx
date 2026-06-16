"use client";

// Admin > Users. Static Phase-0 screen: searchable / filterable user list with
// per-user "Grant credits" and "Ban / Unban" actions, plus a toolbar "Grant to
// all". State is local over mock data (lib/admin/mock.ts); the wiring phase
// calls grantTopup + a ban endpoint. English-only, dark-only, LTR.

import { useState } from "react";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { AdminModal as Modal } from "@/components/admin/AdminModal";
import {
  MOCK_USERS,
  PLAN_LABEL,
  type AdminUser,
  type Plan,
} from "@/lib/admin/mock";

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";

const PLAN_OPTIONS: Array<Plan | "all"> = ["all", "free", "plus", "pro", "max"];
const STATUS_OPTIONS = ["all", "active", "banned"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

// (modal extracted to components/admin/AdminModal.tsx, imported as Modal)

function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: plan === "free" ? MUTED : PRIMARY,
        background: "var(--tq-overlay-soft)",
      }}
    >
      {PLAN_LABEL[plan]}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--tq-overlay-soft)",
  border: "1px solid var(--tq-border-hairline)",
  color: PRIMARY,
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>(MOCK_USERS);
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // grantTarget: a user id, or "all" for the toolbar action, or null (closed).
  const [grantTarget, setGrantTarget] = useState<string | "all" | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesPlan = planFilter === "all" || u.plan === planFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "banned" ? u.banned : !u.banned);
    return matchesQuery && matchesPlan && matchesStatus;
  });

  const applyGrant = () => {
    const amount = parseInt(grantAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setUsers((prev) =>
      prev.map((u) =>
        grantTarget === "all" || u.id === grantTarget
          ? { ...u, credits: u.credits + amount }
          : u,
      ),
    );
    setGrantTarget(null);
    setGrantAmount("");
    setGrantReason("");
  };

  const confirmBan = () => {
    if (!banTarget) return;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === banTarget.id ? { ...u, banned: !u.banned } : u,
      ),
    );
    setBanTarget(null);
  };

  const grantUser =
    grantTarget && grantTarget !== "all"
      ? users.find((u) => u.id === grantTarget)
      : null;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 220 }}>
          <span
            className="material-symbols-outlined pointer-events-none absolute start-3 top-1/2 -translate-y-1/2"
            style={{ fontSize: 18, color: MUTED }}
          >
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="h-10 w-full rounded-full ps-10 pe-4 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as Plan | "all")}
          className="h-10 rounded-full px-4 text-sm outline-none"
          style={inputStyle}
        >
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p === "all" ? "All plans" : PLAN_LABEL[p]}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 rounded-full px-4 text-sm capitalize outline-none"
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setGrantTarget("all")}
          className="btn-pill flex h-10 items-center gap-2 px-4 text-sm font-medium"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            add_card
          </span>
          Grant to all
        </button>
      </div>

      {/* List */}
      <div className="surface-card rounded-xl px-4">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: MUTED }}>
            No users match these filters.
          </p>
        ) : (
          filtered.map((u, i) => (
            <div
              key={u.id}
              className="flex items-center gap-4 py-3"
              style={{
                opacity: u.banned ? 0.55 : 1,
                borderBottom:
                  i === filtered.length - 1
                    ? "none"
                    : "1px solid var(--tq-border-hairline)",
              }}
            >
              <span
                className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-bold"
                style={{ background: avatarGradientForSeed(u.email), color: "#fff" }}
              >
                {u.name.charAt(0)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium" style={{ color: PRIMARY }}>
                    {u.name}
                  </span>
                  {u.banned ? (
                    <span
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                      style={{ color: MUTED, border: "1px solid var(--tq-border-hairline)" }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                        block
                      </span>
                      Banned
                    </span>
                  ) : null}
                </div>
                <span className="truncate text-xs" style={{ color: MUTED }}>
                  {u.email}
                </span>
              </div>

              <div className="hidden w-16 sm:block">
                <PlanBadge plan={u.plan} />
              </div>

              <div className="hidden w-24 text-end sm:block">
                <div className="text-sm font-medium" style={{ color: PRIMARY }}>
                  {u.credits.toLocaleString("en-US")}
                </div>
                <div className="text-xs" style={{ color: MUTED }}>
                  credits
                </div>
              </div>

              <div className="hidden w-24 text-end text-xs md:block" style={{ color: MUTED }}>
                {u.joinedAt}
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setGrantTarget(u.id)}
                  aria-label="Grant credits"
                  title="Grant credits"
                  className="grid h-8 w-8 place-items-center rounded-full transition-colors"
                  style={{ color: ACCENT, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    add_card
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBanTarget(u)}
                  aria-label={u.banned ? "Unban" : "Ban"}
                  title={u.banned ? "Unban" : "Ban"}
                  className="grid h-8 w-8 place-items-center rounded-full transition-colors"
                  style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {u.banned ? "lock_open" : "block"}
                  </span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Grant modal */}
      <Modal
        open={grantTarget !== null}
        title={
          grantTarget === "all"
            ? `Grant credits to all ${users.length} users`
            : `Grant credits to ${grantUser?.name ?? ""}`
        }
        onClose={() => setGrantTarget(null)}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Amount (credits)
            </label>
            <input
              type="number"
              min={1}
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              placeholder="e.g. 500"
              className="h-10 w-full rounded-lg px-3 text-sm outline-none"
              style={inputStyle}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Reason (optional)
            </label>
            <input
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="e.g. goodwill, support credit"
              className="h-10 w-full rounded-lg px-3 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          {grantTarget === "all" ? (
            <p className="text-xs" style={{ color: MUTED }}>
              This applies the grant to every user. In production this is
              idempotent and audited.
            </p>
          ) : null}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setGrantTarget(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyGrant}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium"
            >
              Grant credits
            </button>
          </div>
        </div>
      </Modal>

      {/* Ban confirm */}
      <Modal
        open={banTarget !== null}
        title={banTarget?.banned ? "Unban user" : "Ban user"}
        onClose={() => setBanTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: MUTED }}>
            {banTarget?.banned
              ? `Restore access for ${banTarget?.name} (${banTarget?.email})?`
              : `Block ${banTarget?.name} (${banTarget?.email}) from signing in? This is reversible.`}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setBanTarget(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmBan}
              className={
                banTarget?.banned
                  ? "btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium"
                  : "btn-pill-danger flex-1 rounded-full px-4 py-2.5 text-sm font-medium"
              }
            >
              {banTarget?.banned ? "Unban" : "Ban user"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
