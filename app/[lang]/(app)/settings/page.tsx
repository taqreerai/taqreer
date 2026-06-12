"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { PlanUsage } from "@/components/app/PlanUsage";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import type { User } from "@supabase/supabase-js";

type Msg = { type: "success" | "error"; text: string } | null;

function StatusMsg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={msg.type === "success" ? "status-success" : "status-error"}>
      {msg.text}
    </div>
  );
}

export default function SettingsPage() {
  const dict = useDict();
  const { locale } = useLocale();
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

  // Email change (email+password accounts only). Supabase's
  // updateUser({ email }) sends a confirmation link to the NEW
  // address; until clicked, auth keeps the old email.
  const [email, setEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState<Msg>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setName(user?.user_metadata?.full_name || user?.user_metadata?.name || "");
      setEmail(user?.email ?? "");
      setLoading(false);
    });
  }, [supabase.auth]);

  const avatarUrl: string | null = user?.user_metadata?.avatar_url ?? null;
  const displayName: string =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "User";

  const isGoogleUser =
    user?.app_metadata?.provider === "google" ||
    (user?.identities ?? []).some((i) => i.provider === "google");

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setProfileMsg(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name, name } });
    if (error) {
      setProfileMsg({ type: "error", text: dict.pages.settings.profile.errSave });
    } else {
      // Supabase auth name was updated; user-sync mirrors that into
      // the Prisma User row. Previously the catch only caught
      // transport errors — a 500 from /api/auth/user-sync would
      // resolve as a normal Response and we'd flash a success toast
      // while the Prisma row stayed stale (dashboard greeting reads
      // the OLD name). Inspect response.ok to keep the message
      // truthful and the discrepancy surfaceable.
      let syncOk = false;
      try {
        const res = await fetch("/api/auth/user-sync", { method: "POST" });
        syncOk = res.ok;
        if (!res.ok) {
          console.error("[settings] user-sync failed", { status: res.status });
        }
      } catch (err) {
        // Sync failure leaves the Prisma User out-of-sync with the
        // Supabase auth `full_name` change. Log so the discrepancy
        // is traceable when the dashboard greeting reads stale.
        console.error("[settings] user-sync failed", err);
      }
      if (syncOk) {
        setProfileMsg({ type: "success", text: dict.pages.settings.profile.saved });
      } else {
        // Auth name was updated even though the Prisma mirror failed
        // — be honest about the partial-success state so the user
        // can retry. They aren't blocked; the next save (or any
        // subsequent /api/auth/user-sync) will reconcile.
        setProfileMsg({
          type: "error",
          text: dict.pages.settings.profile.syncFailed,
        });
      }
    }
    setSaving(false);
  };

  const handleChangeEmail = async () => {
    const next = email.trim();
    if (!next || next === user?.email) return;
    setEmailSaving(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email: next });
    if (error) {
      setEmailMsg({ type: "error", text: dict.pages.settings.profile.emailError });
    } else {
      // Supabase sent the confirmation link; auth email flips (and
      // user-sync mirrors it into Prisma on the next session) only
      // after the user clicks it.
      setEmailMsg({ type: "success", text: dict.pages.settings.profile.emailPending });
    }
    setEmailSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 8) { setPwMsg({ type: "error", text: dict.pages.settings.password.errShort }); return; }
    if (newPw !== confirmPw) { setPwMsg({ type: "error", text: dict.pages.settings.password.errMismatch }); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setPwMsg({ type: "error", text: dict.pages.settings.password.errGeneric });
    } else {
      setPwMsg({ type: "success", text: dict.pages.settings.password.changed });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    }
    setPwLoading(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "POST" });
      if (res.ok) {
        router.push(`${localizedHref("/login", locale)}?deleted=true`);
      } else {
        setDeleteLoading(false);
        setShowDeleteModal(false);
      }
    } catch {
      setDeleteLoading(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="text-muted">{dict.pages.settings.loading}</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* §settings (2026-06-09): one centered column of stacked cards.
          Width matches the create-flow content frame (max-w-6xl, user
          direction 2026-06-12; was 7xl/landing). */}
      <div className="mx-auto flex w-full max-w-6xl flex-col">
      {/* Plan banner - full width at top. Self-feeding from the shared
          credit store (same number as the avatar ring + profile menu). */}
      <PlanUsage />

      {/* Page title */}
      <h1 className="tq-h1 mt-8 mb-6">{dict.pages.settings.title}</h1>

      {/* Stacked cards — one per row. */}
      <div className="flex flex-col gap-6">

        {/* ── Profile ── label-start / control-end rows (user direction
            2026-06-11, lovable-style settings reference). Logical grid
            sides so AR mirrors automatically. */}
        <div className="settings-card surface-card rounded-xl">
          {/* Header row: card title at the start, avatar + name + email
              at the end - ABOVE the divider, so there's no duplicated
              "الملف الشخصي" row (user direction 2026-06-12). */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="settings-card-title !mb-0">{dict.pages.settings.profile.title}</h2>
            <div className="flex items-center gap-3">
              <div className="text-end">
                <p className="text-sm font-semibold text-foreground">{displayName}</p>
                <p className="text-xs text-muted">{user?.email}</p>
              </div>
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName}
                  width={48}
                  height={48}
                  // `no-referrer` for Google profile pics — see
                  // components/common/Avatar.tsx for the full rationale.
                  referrerPolicy="no-referrer"
                  className="rounded-full object-cover w-12 h-12 tq-avatar-ring"
                />
              ) : (
                <div
                  // Per-user gradient — same picker the dashboard
                  // sidebar + presence avatars use.
                  className="w-12 h-12 rounded-full tq-avatar-fallback text-lg"
                  style={{
                    backgroundImage: avatarGradientForSeed(
                      user?.id ?? user?.email ?? displayName,
                    ),
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>
          <div className="settings-divider !mt-3" />

          <form onSubmit={handleSaveProfile}>
            <div className="settings-row">
              <div>
                <p className="settings-row-title">{dict.pages.settings.profile.fullName}</p>
              </div>
              <div className="flex items-center gap-3">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={dict.pages.settings.profile.fullNamePlaceholder} className="input-dark" />
                <button type="submit" disabled={saving} className="btn-pill shrink-0 px-5 py-2.5 text-sm disabled:opacity-50 cursor-pointer">
                  {saving ? dict.pages.settings.profile.saving : dict.pages.settings.profile.save}
                </button>
              </div>
            </div>

            {/* Email row - EDITABLE for email+password accounts only
                (user direction 2026-06-12). Google accounts keep the
                locked input: their email is owned by the provider.
                Supabase sends a confirmation link to the NEW address;
                the change lands only after the user clicks it, so the
                row shows a "check your inbox" notice post-submit. */}
            <div className="settings-row border-b-0">
              <div>
                <p className="settings-row-title">{dict.pages.settings.profile.email}</p>
                {emailMsg ? (
                  <p className="settings-row-desc">{emailMsg.text}</p>
                ) : null}
              </div>
              {isGoogleUser ? (
                <input type="email" value={user?.email ?? ""} disabled className="input-dark" />
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-dark"
                    dir="ltr"
                    autoComplete="email"
                  />
                  <button
                    type="button"
                    onClick={handleChangeEmail}
                    disabled={emailSaving || email.trim() === (user?.email ?? "")}
                    className="btn-pill shrink-0 px-5 py-2.5 text-sm disabled:opacity-50 cursor-pointer"
                  >
                    {emailSaving
                      ? dict.pages.settings.profile.saving
                      : dict.pages.settings.profile.changeEmail}
                  </button>
                </div>
              )}
            </div>
            <StatusMsg msg={profileMsg} />
          </form>
        </div>

        {/* ── Password ── */}
        <div className="settings-card surface-card rounded-xl">
          <h2 className="settings-card-title">{dict.pages.settings.password.title}</h2>
          <div className="settings-divider" />

          {isGoogleUser && (
            <p className="text-muted text-sm mb-4">
              {dict.pages.settings.password.googleHint}
            </p>
          )}

          <form onSubmit={handleChangePassword}>
            {!isGoogleUser && (
              <div className="settings-row">
                <p className="settings-row-title">{dict.pages.settings.password.current}</p>
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" className="input-dark" />
              </div>
            )}
            <div className="settings-row">
              <p className="settings-row-title">{dict.pages.settings.password.new}</p>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" className="input-dark" />
            </div>
            <div className="settings-row">
              <p className="settings-row-title">{dict.pages.settings.password.confirm}</p>
              <div className="flex items-center gap-3">
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" className="input-dark" />
                <button type="submit" disabled={pwLoading} className="btn-pill shrink-0 px-5 py-2.5 text-sm disabled:opacity-50 cursor-pointer">
                  {pwLoading ? dict.pages.settings.password.saving : isGoogleUser ? dict.pages.settings.password.add : dict.pages.settings.password.change}
                </button>
              </div>
            </div>
            <StatusMsg msg={pwMsg} />
          </form>
        </div>

        {/* ── Delete Account ── */}
        <div className="settings-card surface-card rounded-xl">
          <h2 className="settings-card-title text-red-400">{dict.pages.settings.deleteAccount.title}</h2>
          <div className="settings-divider" />
          <div className="settings-row">
            <p className="settings-row-desc">{dict.pages.settings.deleteAccount.warning}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowDeleteModal(true)}
                className="btn-pill-danger px-4 py-2 text-sm cursor-pointer"
              >
                {dict.pages.settings.deleteAccount.button}
              </button>
            </div>
          </div>
        </div>

      </div>
      </div>

      {/* ── Delete Modal ── */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="modal-dim fixed inset-0 z-50 flex items-start justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="surface-modal rounded-2xl p-8 max-w-md w-full mt-[20vh]"
            >
              <h3 className="text-xl font-bold mb-2 text-foreground">{dict.pages.settings.deleteAccount.confirmTitle}</h3>
              <p className="text-muted text-sm mb-8">{dict.pages.settings.deleteAccount.confirmBody}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                  className="btn-pill flex-1 px-4 py-3 text-sm cursor-pointer"
                >
                  {dict.pages.settings.deleteAccount.cancel}
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading}
                  className="btn-pill-danger flex-1 px-4 py-3 text-sm cursor-pointer"
                >
                  {deleteLoading ? dict.pages.settings.deleteAccount.deleting : dict.pages.settings.deleteAccount.confirm}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
