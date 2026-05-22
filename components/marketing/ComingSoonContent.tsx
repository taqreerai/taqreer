"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: "easeOut" as const },
  },
};

export function ComingSoonContent({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="z-10 flex flex-col items-center text-center max-w-2xl mx-auto space-y-12 w-full"
    >
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-center mb-8 w-full"
      >
        <Image
          src="/logo-light.svg"
          alt="Taqreer Logo"
          width={200}
          height={48}
          className="w-auto h-12 md:h-16 object-contain"
          priority
        />
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-6 w-full">
        <h1 className="text-6xl md:text-8xl font-bold text-white mb-6">قريباً</h1>
        <p className="text-xl md:text-2xl text-gray-400 leading-relaxed">
          نعمل على إطلاق منصة تقرير. سجّل بريدك لتكون أول من يعلم.
        </p>
      </motion.div>

      {isLoggedIn ? (
        <motion.div
          variants={itemVariants}
          className="w-full flex justify-center gap-4"
        >
          <Link
            href="/dashboard"
            className="bg-button-gradient hover:opacity-90 transition-opacity text-white font-bold rounded-full px-8 py-4"
          >
            لوحة التحكم
          </Link>
        </motion.div>
      ) : (
        <motion.div
          variants={itemVariants}
          className="w-full flex flex-col sm:flex-row justify-center gap-4 mt-8"
        >
          <Link
            href="/auth/signup"
            className="bg-button-gradient hover:opacity-90 transition-opacity text-white font-bold rounded-full px-8 py-4 whitespace-nowrap text-center"
          >
            ابدأ مجاناً
          </Link>
          <Link
            href="/auth/login"
            className="border border-white/10 hover:border-white/30 hover:bg-white/5 transition-all text-white font-bold rounded-full px-8 py-4 whitespace-nowrap text-center"
          >
            تسجيل الدخول
          </Link>
        </motion.div>
      )}
    </motion.div>
  );
}
