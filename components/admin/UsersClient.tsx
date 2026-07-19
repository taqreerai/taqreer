"use client";

// Admin > Users (client). Searchable / filterable user list fed by real data
// from the server page. Per-user "Grant credits" and "Ban / Unban" + a toolbar
// "Grant to all", all wired to /api/admin/* endpoints (optimistic local update
// on success). English-only, dark-only, LTR.

import { useState } from "react";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import { AdminModal as Modal } from "@/components/admin/AdminModal";
import { PLAN_LABEL, type AdminUser, type Plan } from "@/lib/admin/mock";

const ACCENT = "var(--tq-purple)";
const MUTED = "var(--tq-text-muted)";
const PRIMARY = "var(--tq-text-primary)";
const DANGER = "var(--tq-text-danger)";

const PLAN_OPTIONS: Array<Plan | "all"> = ["all", "free", "plus", "pro", "max"];
const STATUS_OPTIONS = ["all", "active", "banned"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

// The list is client-filtered (search / plan / status) over the server's
// take-500 window, so paginate on the client to keep filtering instant.
const PAGE_SIZE = 20;

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

export function UsersClient({ initialUsers }: { initialUsers: AdminUser[] }) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  // Any filter change jumps back to page 1 (the current page may not exist in
  // the narrowed result set). Setters wrap this so no mount effect is needed.
  const resetToFirstPage = () => setPage(1);

  // grantTarget: a user id, or "all" for the toolbar action, or null (closed).
  const [grantTarget, setGrantTarget] = useState<string | "all" | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  // Send the credit-gift email to each granted user (default OFF - most
  // grants are quiet support adjustments; gifting campaigns opt in).
  const [grantSendEmail, setGrantSendEmail] = useState(false);

  // Opening the grant modal always starts with the email checkbox OFF -
  // a checked-then-cancelled state must not leak into an unrelated grant
  // (CR PR#112).
  const openGrant = (target: string | "all") => {
    setGrantSendEmail(false);
    setGrantTarget(target);
  };
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  // Set-credits modal (absolute subscription balance, e.g. 0 to claw back
  // a farmed signup grant).
  const [setTarget, setSetTarget] = useState<AdminUser | null>(null);
  const [setAmount, setSetAmount] = useState("");
  const [setReason, setSetReason] = useState("");
  const [granting, setGranting] = useState(false);
  const [banning, setBanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingCredits, setSettingCredits] = useState(false);
  // Grant test tier (a complimentary paid plan for 1 month).
  const [compTarget, setCompTarget] = useState<AdminUser | null>(null);
  const [compPlan, setCompPlan] = useState<"plus" | "pro" | "max">("plus");
  const [compingTier, setCompingTier] = useState(false);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      // Searching an IP pulls up every account that signed up from it.
      (u.signupIp?.toLowerCase().includes(q) ?? false);
    const matchesPlan = planFilter === "all" || u.plan === planFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "banned" ? u.banned : !u.banned);
    return matchesQuery && matchesPlan && matchesStatus;
  });

  // Clamp the page against the current result set (a stale page from before a
  // filter change resolves to the last valid page rather than an empty list).
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageUsers = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const applyGrant = async () => {
    const amount = parseInt(grantAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0 || granting) return;
    setGranting(true);
    try {
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: grantTarget,
          amount,
          reason: grantReason.trim() || undefined,
          sendEmail: grantSendEmail,
        }),
      });
      if (!res.ok) throw new Error("grant failed");
      // The server applied the grant; reflect it in the list.
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
      setGrantSendEmail(false);
    } catch {
      // leave the modal open so the admin can retry
    } finally {
      setGranting(false);
    }
  };

  const applySetCredits = async () => {
    if (!setTarget || settingCredits) return;
    const amount = parseInt(setAmount, 10);
    if (!Number.isInteger(amount) || amount < 0) return;
    setSettingCredits(true);
    try {
      const res = await fetch("/api/admin/credits/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: setTarget.id,
          amount,
          reason: setReason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("set failed");
      // The displayed credits include top-ups, so take the server's total
      // instead of guessing client-side.
      const json = (await res.json()) as { balance?: { total?: number } };
      const total = json.balance?.total;
      setUsers((prev) =>
        prev.map((u) =>
          u.id === setTarget.id
            ? {
                ...u,
                credits: typeof total === "number" ? total : amount,
                subscriptionCredits: amount,
              }
            : u,
        ),
      );
      setSetTarget(null);
      setSetAmount("");
      setSetReason("");
    } catch {
      // leave the modal open so the admin can retry
    } finally {
      setSettingCredits(false);
    }
  };

  const confirmBan = async () => {
    if (!banTarget || banning) return;
    const action = banTarget.banned ? "unban" : "ban";
    setBanning(true);
    try {
      const res = await fetch(`/api/admin/users/${banTarget.id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("ban failed");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === banTarget.id ? { ...u, banned: action === "ban" } : u,
        ),
      );
      setBanTarget(null);
    } catch {
      // leave the modal open so the admin can retry
    } finally {
      setBanning(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // leave the modal open so the admin can retry
    } finally {
      setDeleting(false);
    }
  };

  const applyCompTier = async () => {
    if (!compTarget || compingTier) return;
    setCompingTier(true);
    try {
      const res = await fetch(`/api/admin/users/${compTarget.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: compPlan }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        expiresAt?: string;
        balance?: { total?: number; subscription?: number };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "comp failed");
      const total = json.balance?.total;
      const subscription = json.balance?.subscription;
      const expiresAt = json.expiresAt ? json.expiresAt.slice(0, 10) : null;
      setUsers((prev) =>
        prev.map((u) =>
          u.id === compTarget.id
            ? {
                ...u,
                plan: compPlan,
                compExpiresAt: expiresAt,
                credits: typeof total === "number" ? total : u.credits,
                subscriptionCredits:
                  typeof subscription === "number"
                    ? subscription
                    : u.subscriptionCredits,
              }
            : u,
        ),
      );
      setCompTarget(null);
    } catch {
      // leave the modal open so the admin can retry / see the failure
    } finally {
      setCompingTier(false);
    }
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
            onChange={(e) => {
              setQuery(e.target.value);
              resetToFirstPage();
            }}
            placeholder="Search name or email"
            className="h-10 w-full rounded-full ps-10 pe-4 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        <select
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value as Plan | "all");
            resetToFirstPage();
          }}
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
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            resetToFirstPage();
          }}
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
          onClick={() => openGrant("all")}
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
          pageUsers.map((u, i) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3"
              style={{
                opacity: u.banned ? 0.55 : 1,
                borderBottom:
                  i === pageUsers.length - 1
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
                  {u.sharedIp ? (
                    <span
                      className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                      style={{ color: DANGER, border: "1px solid var(--tq-border-hairline)" }}
                      title={`Same signup IP as another account${u.signupIp ? `: ${u.signupIp}` : ""}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                        share
                      </span>
                      Shared IP
                    </span>
                  ) : null}
                </div>
                <span className="block truncate text-xs" style={{ color: MUTED }}>
                  {u.email}
                </span>
                {u.signupCity || u.signupCountry ? (
                  // City/country only - the raw IP stays off-screen (hover
                  // tooltip here + the Shared IP chip) to keep the list scannable.
                  <span
                    className="block truncate text-xs"
                    style={{ color: MUTED }}
                    title={u.signupIp ?? undefined}
                  >
                    {[u.signupCity, u.signupCountry].filter(Boolean).join(", ")}
                  </span>
                ) : null}
              </div>

              <div className="hidden w-16 sm:block">
                <PlanBadge plan={u.plan} />
                {u.compExpiresAt ? (
                  <div
                    className="mt-0.5 text-[10px] leading-tight"
                    style={{ color: MUTED }}
                    title={`Complimentary tier until ${u.compExpiresAt}`}
                  >
                    comp {u.compExpiresAt}
                  </div>
                ) : null}
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

              <div className="flex w-full flex-shrink-0 items-center justify-end gap-1.5 sm:w-auto sm:gap-1">
                <button
                  type="button"
                  onClick={() => openGrant(u.id)}
                  aria-label="Grant credits"
                  title="Grant credits"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8"
                  style={{ color: ACCENT, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    add_card
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSetAmount("");
                    setSetReason("");
                    setSetTarget(u);
                  }}
                  aria-label="Set credits"
                  title="Set credits"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8"
                  style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    tune
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompPlan("plus");
                    setCompTarget(u);
                  }}
                  aria-label="Grant test tier"
                  title="Grant test tier (1 month, free)"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8"
                  style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    workspace_premium
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBanTarget(u)}
                  aria-label={u.banned ? "Unban" : "Ban"}
                  title={u.banned ? "Unban" : "Ban"}
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8"
                  style={{ color: MUTED, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {u.banned ? "lock_open" : "block"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(u)}
                  aria-label="Delete user"
                  title="Delete user"
                  className="grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8"
                  style={{ color: DANGER, background: "var(--tq-overlay-soft)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    delete
                  </span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination - only when the filtered set spills past one page. */}
      {totalPages > 1 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs" style={{ color: MUTED }}>
            Showing {pageStart + 1}-{pageStart + pageUsers.length} of{" "}
            {filtered.length.toLocaleString("en-US")}
          </span>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="btn-pill flex h-9 items-center gap-1 pe-4 ps-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                chevron_left
              </span>
              Prev
            </button>
            <span
              className="text-xs tabular-nums"
              style={{ color: MUTED }}
            >
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="btn-pill flex h-9 items-center gap-1 ps-4 pe-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                chevron_right
              </span>
            </button>
          </div>
        </div>
      ) : null}

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
          <label
            className="flex cursor-pointer items-center gap-2 text-xs font-medium"
            style={{ color: MUTED }}
          >
            <input
              type="checkbox"
              checked={grantSendEmail}
              onChange={(e) => setGrantSendEmail(e.target.checked)}
            />
            Email users about the gift (credit-gift email, per-user language)
          </label>
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
              disabled={granting}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {granting ? "Granting..." : "Grant credits"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Set credits (absolute subscription balance) */}
      <Modal
        open={setTarget !== null}
        title={`Set credits for ${setTarget?.name ?? ""}`}
        onClose={() => setSetTarget(null)}
      >
        <div className="space-y-4">
          {setTarget ? (
            <p className="text-xs" style={{ color: MUTED }}>
              Current subscription balance:{" "}
              <span style={{ color: PRIMARY }}>
                {setTarget.subscriptionCredits.toLocaleString("en-US")}
              </span>
              {setTarget.credits - setTarget.subscriptionCredits > 0
                ? ` (+ ${(setTarget.credits - setTarget.subscriptionCredits).toLocaleString("en-US")} top-up credits, not affected)`
                : ""}
            </p>
          ) : null}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              New balance (credits)
            </label>
            <input
              type="number"
              min={0}
              value={setAmount}
              onChange={(e) => setSetAmount(e.target.value)}
              placeholder="e.g. 0"
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
              value={setReason}
              onChange={(e) => setSetReason(e.target.value)}
              placeholder="e.g. duplicate signup-grant clawback"
              className="h-10 w-full rounded-lg px-3 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <p className="text-xs" style={{ color: MUTED }}>
            Sets the subscription balance to this exact value. Top-up credits
            are not affected. Audited in the credit ledger.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setSetTarget(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applySetCredits}
              disabled={settingCredits}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {settingCredits ? "Setting..." : "Set credits"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Grant test tier (complimentary paid plan, 1 month) */}
      <Modal
        open={compTarget !== null}
        title={`Grant test tier to ${compTarget?.name ?? ""}`}
        onClose={() => setCompTarget(null)}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: MUTED }}>
              Tier
            </label>
            <select
              value={compPlan}
              onChange={(e) =>
                setCompPlan(e.target.value as "plus" | "pro" | "max")
              }
              className="h-10 w-full rounded-lg px-3 text-sm outline-none"
              style={inputStyle}
              autoFocus
            >
              <option value="plus">Plus</option>
              <option value="pro">Pro</option>
              <option value="max">Max</option>
            </select>
          </div>
          <p className="text-xs" style={{ color: MUTED }}>
            Activates {PLAN_LABEL[compPlan]} free for 1 month with that tier&apos;s
            credits, no Stripe. The user is emailed (in their language) and
            auto-reverts to Free when the month ends. A user with an active paid
            subscription can&apos;t be comped.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCompTarget(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCompTier}
              disabled={compingTier}
              className="btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {compingTier ? "Granting..." : "Grant tier"}
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
              disabled={banning}
              className={
                banTarget?.banned
                  ? "btn-gradient flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                  : "btn-pill-danger flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              }
            >
              {banning
                ? banTarget?.banned
                  ? "Unbanning..."
                  : "Banning..."
                : banTarget?.banned
                  ? "Unban"
                  : "Ban user"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm - permanent, removes the user from everywhere */}
      <Modal
        open={deleteTarget !== null}
        title="Delete user"
        onClose={() => setDeleteTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: MUTED }}>
            Permanently delete {deleteTarget?.name} ({deleteTarget?.email}) and all
            their data - decks, credits, and their login. This removes them from
            everywhere and cannot be undone.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="btn-pill flex-1 px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="btn-pill-danger flex-1 rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete user"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
