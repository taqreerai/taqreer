"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { PlanUsage } from "@/components/app/PlanUsage";
import { avatarGradientForSeed } from "@/lib/util/avatar-gradient";
import type { User } from "@supabase/supabase-js";

type Msg = { type: "success" | "error"; text: string } | null;
type PlanUsageData = {
  plan: string;
  usageCount: number;
  limit: number;
  renewalDate: string | null;
};

function StatusMsg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={msg.type === "success" ? "status-success" : "status-error"}>
      {msg.text}
    </div>
  );
}

export default function SettingsPage() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [planUsage, setPlanUsage] = useState<PlanUsageData | null>(null);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

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
      setLoading(false);
    });
  }, [supabase.auth]);

  useEffect(() => {
    if (!user) return;

    fetch("/api/usage/plan")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlanUsageData | null) => {
        setPlanUsage(data);
      })
      .catch(() => {
        setPlanUsage(null);
      });
  }, [user]);

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
      setProfileMsg({ type: "error", text: "حدث خطأ أثناء الحفظ" });
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
        setProfileMsg({ type: "success", text: "تم حفظ التغييرات بنجاح" });
      } else {
        // Auth name was updated even though the Prisma mirror failed
        // — be honest about the partial-success state so the user
        // can retry. They aren't blocked; the next save (or any
        // subsequent /api/auth/user-sync) will reconcile.
        setProfileMsg({
          type: "error",
          text: "تم تحديث الاسم، لكن تعذّرت مزامنته داخل التطبيق",
        });
      }
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < 8) { setPwMsg({ type: "error", text: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return; }
    if (newPw !== confirmPw) { setPwMsg({ type: "error", text: "كلمات المرور غير متطابقة" }); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setPwMsg({ type: "error", text: "حدث خطأ. يرجى المحاولة مرة أخرى" });
    } else {
      setPwMsg({ type: "success", text: "تم تغيير كلمة المرور بنجاح" });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    }
    setPwLoading(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "POST" });
      if (res.ok) {
        router.push("/login?deleted=true");
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
        <p className="text-muted">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* §settings (2026-06-09): one centered column — cards stacked a row each
          at a comfortable reading width, instead of the old 2-col grid. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col">
      {/* Plan banner — full width at top */}
      {planUsage ? (
        <PlanUsage
          plan={planUsage.plan}
          usageCount={planUsage.usageCount}
          limit={planUsage.limit}
          renewalDate={planUsage.renewalDate ? new Date(planUsage.renewalDate) : null}
        />
      ) : null}

      {/* Page title */}
      <h1 className="tq-h1 mt-8 mb-6">الإعدادات</h1>

      {/* Stacked cards — one per row. */}
      <div className="flex flex-col gap-6">

        {/* ── Profile ── */}
        <div className="settings-card surface-card rounded-xl">
          <h2 className="settings-card-title">الملف الشخصي</h2>
          <div className="settings-divider" />

          <div className="flex items-center gap-4 mb-5">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={64}
                height={64}
                // `no-referrer` for Google profile pics — see
                // components/common/Avatar.tsx for the full rationale.
                referrerPolicy="no-referrer"
                className="rounded-full object-cover w-16 h-16 tq-avatar-ring"
              />
            ) : (
              <div
                // Per-user gradient — same picker the dashboard
                // sidebar + presence avatars use, so the same person
                // gets the same colour everywhere they appear. Inline
                // `backgroundImage` overrides the canonical single-
                // gradient `background` set on `.tq-avatar-fallback`.
                className="w-16 h-16 rounded-full tq-avatar-fallback text-xl"
                style={{
                  backgroundImage: avatarGradientForSeed(
                    user?.id ?? user?.email ?? displayName,
                  ),
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-white text-sm">{displayName}</p>
              <p className="text-muted text-xs">{user?.email}</p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-white">الاسم الكامل</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="أحمد محمد" className="input-dark" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-muted">البريد الإلكتروني</label>
              <input type="email" value={user?.email ?? ""} disabled className="input-dark" />
            </div>
            <StatusMsg msg={profileMsg} />
            <button type="submit" disabled={saving} className="btn-gradient px-6 py-3 disabled:opacity-50 w-full cursor-pointer">
              {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
            </button>
          </form>
        </div>

        {/* ── Password ── */}
        <div className="settings-card surface-card rounded-xl">
          <h2 className="settings-card-title">تغيير كلمة المرور</h2>
          <div className="settings-divider" />

          {isGoogleUser && (
            <p className="text-muted text-sm mb-4">
              أنت مسجل بحساب جوجل. يمكنك إضافة كلمة مرور لتسجيل الدخول بالبريد الإلكتروني أيضاً
            </p>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            {!isGoogleUser && (
              <div>
                <label className="block text-sm font-medium mb-2 text-white">كلمة المرور الحالية</label>
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" className="input-dark" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-2 text-white">كلمة المرور الجديدة</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" className="input-dark" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-white">تأكيد كلمة المرور</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" className="input-dark" />
            </div>
            <StatusMsg msg={pwMsg} />
            <button type="submit" disabled={pwLoading} className="btn-gradient px-6 py-3 disabled:opacity-50 w-full cursor-pointer">
              {pwLoading ? "جاري الحفظ..." : isGoogleUser ? "إضافة كلمة مرور" : "تغيير كلمة المرور"}
            </button>
          </form>
        </div>

        {/* ── Delete Account ── */}
        <div className="settings-card surface-card-danger rounded-xl">
          <h2 className="settings-card-title text-red-400">حذف الحساب</h2>
          <div className="settings-divider" />
          <p className="text-muted text-sm mb-5">هذا الإجراء لا يمكن التراجع عنه وسيتم حذف جميع بياناتك نهائياً</p>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="btn-pill-danger px-4 py-2 text-sm cursor-pointer"
          >
            حذف حسابي
          </button>
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
              <h3 className="text-xl font-bold mb-2 text-white">حذف الحساب</h3>
              <p className="text-muted text-sm mb-8">هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه وسيُحذف حسابك وجميع بياناتك نهائياً.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                  className="btn-pill flex-1 px-4 py-3 text-sm cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading}
                  className="btn-pill-danger flex-1 px-4 py-3 text-sm cursor-pointer"
                >
                  {deleteLoading ? "جاري الحذف..." : "حذف حسابي نهائياً"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
