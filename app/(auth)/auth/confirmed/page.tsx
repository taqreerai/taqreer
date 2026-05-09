"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function ConfirmedPage() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push("/dashboard"), 2500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <motion.div
      key="confirmed"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center gap-8 text-center"
      dir="rtl"
    >
      {/* Animated brand-gradient circle + checkmark */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1, type: "spring", stiffness: 200, damping: 18 }}
      >
        <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="confirmed-grad" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#370BF4" />
              <stop offset="100%" stopColor="#E036B8" />
            </linearGradient>
          </defs>
          {/* Circle draws itself */}
          <motion.circle
            cx="48"
            cy="48"
            r="44"
            stroke="url(#confirmed-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
          />
          {/* Checkmark draws itself after circle finishes */}
          <motion.path
            d="M 28 48 L 42 62 L 68 30"
            stroke="url(#confirmed-grad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 1.05, ease: "easeOut" }}
          />
        </svg>
      </motion.div>

      {/* Arabic text */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.9 }}
      >
        <h1 className="text-2xl font-bold text-white mb-3">
          تم التحقق من بريدك الإلكتروني ✓
        </h1>
        <p className="text-[#9A94A8] text-sm">جارٍ تحويلك إلى لوحة التحكم...</p>
      </motion.div>

      {/* Progress line filling over 2 seconds */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="w-full"
      >
        <div className="w-full h-px bg-[rgba(42,36,59,0.6)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-l from-[#370BF4] to-[#E036B8]"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 2.0, delay: 0.55, ease: "linear" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
