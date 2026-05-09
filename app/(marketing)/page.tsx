"use client";

import { motion } from "framer-motion";
import Image from "next/image";

export default function ComingSoon() {
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
      transition: { duration: 0.7, ease: "easeOut" as const } 
    },
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative glow-effect overflow-hidden bg-brand-dark">
      
      {/* Additional subtle center glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-[400px] md:h-[600px] bg-brand-purple-900/20 blur-[100px] md:blur-[120px] rounded-full -z-10 pointer-events-none"></div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="z-10 flex flex-col items-center text-center max-w-2xl mx-auto space-y-12 w-full"
      >
        
        {/* Logo */}
        <motion.div variants={itemVariants} className="flex items-center justify-center mb-8 w-full">
          <Image 
            src="/logo-light.svg" 
            alt="Taqreer Logo" 
            width={200} 
            height={48}
            className="w-auto h-12 md:h-16 object-contain"
            priority
          />
        </motion.div>

        {/* Content */}
        <motion.div variants={itemVariants} className="space-y-6 w-full">
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-6">
            قريباً
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 leading-relaxed">
            نعمل على إطلاق منصة تقرير. سجّل بريدك لتكون أول من يعلم.
          </p>
        </motion.div>

        {/* Signup Form */}
        <form className="w-full max-w-lg mx-auto flex flex-col sm:flex-row gap-4 mt-8">
          <motion.input 
            variants={itemVariants}
            type="email" 
            placeholder="أدخل بريدك الإلكتروني" 
            required
            dir="ltr"
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-brand-purple-500 focus:ring-1 focus:ring-brand-purple-500 transition-all text-right sm:text-left"
          />
          <motion.button 
            variants={itemVariants}
            type="submit"
            className="bg-button-gradient hover:opacity-90 transition-opacity text-white font-bold rounded-full px-8 py-4 whitespace-nowrap shadow-[0_0_20px_rgba(168,85,247,0.3)]"
          >
            أبلغني عند الإطلاق
          </motion.button>
        </form>

      </motion.div>
    </main>
  );
}
