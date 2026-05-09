"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { PlanUsage } from "@/components/app/PlanUsage";
import type { User } from "@supabase/supabase-js";

type Msg = { type: "success" | "error"; text: string } | null;

function StatusMsg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={`rounded-xl p-3 text-sm border ${
      msg.type === "success"
        ? "bg-green-500/20 border-green-500/40 text-green-200"
        : "bg-red-500/20 border-red-500/40 text-red-200"
    }`}>
      {msg.text}
    </div>
  );
}

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

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
      try { await fetch("/api/auth/user-sync", { method: "POST" }); } catch {}
      setProfileMsg({ type: "success", text: "تم حفظ التغييرات بنجاح" });
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
        router.push("/auth/login?deleted=true");
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
        <p className="text-[#9A94A8]">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Plan banner — full width at top */}
      <PlanUsage />

      {/* Page title */}
      <h1 className="text-2xl font-bold text-white mt-8 mb-6">الإعدادات</h1>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

        {/* ── Col 1 Row 1: Profile ── */}
        <div className="settings-card">
          <h2 className="settings-card-title">الملف الشخصي</h2>
          <div className="settings-divider" />

          <div className="flex items-center gap-4 mb-5">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={64}
                height={64}
                className="rounded-full object-cover w-16 h-16 ring-2 ring-[rgba(55,11,244,0.5)]"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-[#370BF4] to-[#E036B8] flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-white text-sm">{displayName}</p>
              <p className="text-[#9A94A8] text-xs">{user?.email}</p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-white">الاسم الكامل</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="أحمد محمد" className="input-dark" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-[#9A94A8]">البريد الإلكتروني</label>
              <input type="email" value={user?.email ?? ""} disabled className="input-dark" />
            </div>
            <StatusMsg msg={profileMsg} />
            <button type="submit" disabled={saving} className="btn-gradient px-6 py-3 disabled:opacity-50 w-full cursor-pointer">
              {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
            </button>
          </form>
        </div>

        {/* ── Col 2 Row 1: Password ── */}
        <div className="settings-card">
          <h2 className="settings-card-title">تغيير كلمة المرور</h2>
          <div className="settings-divider" />

          {isGoogleUser && (
            <p className="text-[#9A94A8] text-sm mb-4">
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

        {/* ── Col 1 Row 2: Delete Account ── */}
        <div className="settings-card border-red-500/20">
          <h2 className="settings-card-title text-red-400">حذف الحساب</h2>
          <div className="settings-divider border-red-500/20" />
          <p className="text-[#9A94A8] text-sm mb-5">هذا الإجراء لا يمكن التراجع عنه وسيتم حذف جميع بياناتك نهائياً</p>
          <button onClick={() => setShowDeleteModal(true)} className="btn-danger cursor-pointer">
            حذف حسابي
          </button>
        </div>

        {/* ── Col 2 Row 2: Coming Soon ── */}
        <div className="settings-card">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="settings-card-title mb-0">إعدادات إضافية</h2>
            <span className="badge-purple text-[10px]">مقبلاً</span>
          </div>
          <div className="settings-divider" />
          <p className="text-[#9A94A8] text-sm opacity-50">إعدادات متقدمة ستكون متاحة قريباً</p>
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
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="bg-[#0F0B1E] border border-[rgba(42,36,59,0.8)] rounded-2xl p-8 max-w-md w-full mt-[20vh] shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-2 text-white">حذف الحساب</h3>
              <p className="text-[#9A94A8] text-sm mb-8">هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه وسيُحذف حسابك وجميع بياناتك نهائياً.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                  className="flex-1 btn-outline-dark px-4 py-3 cursor-pointer disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl px-4 py-3 cursor-pointer transition-colors font-medium disabled:opacity-50"
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
