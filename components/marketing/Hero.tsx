"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";

export function Hero() {
  const { scrollY } = useScroll();
  
  // As user scrolls from 0 to 600px, rotation goes from 30deg to 0deg
  const rotateX = useTransform(scrollY, [0, 600], [30, 0]);

  // Framer motion variants for fade in up
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
    <section className="relative pt-40 pb-32 overflow-hidden glow-effect">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
            
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-center"
            >
              <motion.div variants={itemVariants} className="flex justify-center gap-3 mb-8 w-full">
                  <span
                      className="px-4 py-1.5 rounded-full text-xs font-medium bg-brand-purple-900/30 text-brand-purple-400 border border-brand-purple-500/20 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-purple-500"></span>
                      تم إنشاء 12,345 عرض تقديمي حتى الآن
                  </span>
                  <span
                      className="px-4 py-1.5 rounded-full text-xs font-medium bg-white/5 text-gray-300 border border-white/10">
                      مدعوم بتقنية Claude Design
                  </span>
              </motion.div>
              
              <motion.h1 variants={itemVariants} className="text-5xl md:text-7xl font-bold mb-8 leading-tight w-full">
                  حوّل محتواك إلى عرض <br />
                  <span className="text-gradient">احترافي خلال دقائق</span>
              </motion.h1>
              
              <motion.p variants={itemVariants} className="text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed w-full">
                  taqreer.ai يحوّل محتواك إلى عروض تقديمية مصممة بالكامل، يدعم العربية والإنجليزية.
                  يحافظ على هويتك البصرية، ويمنحك محررًا متقدمًا لتعديل كل شريحة مباشرة داخل المتصفح.
              </motion.p>
              
              <div className="flex justify-center gap-4 mb-20 w-full">
                  <motion.a href="#" variants={itemVariants}
                      className="px-8 py-3 rounded-full bg-button-gradient text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">
                      ابدأ الآن
                  </motion.a>
                  <motion.a href="#" variants={itemVariants}
                      className="px-8 py-3 rounded-full bg-transparent border border-white/20 text-white font-medium hover:bg-white/5 transition-colors cursor-pointer">
                      استعرض القوالب
                  </motion.a>
              </div>
            </motion.div>
            
            <div className="relative max-w-5xl mx-auto" style={{ perspective: "1000px" }}>
                <div
                    className="absolute -inset-1 bg-gradient-to-r from-brand-purple-600 to-blue-600 rounded-2xl blur opacity-20">
                </div>
                <motion.div
                  style={{ 
                    rotateX,
                    transformStyle: "preserve-3d" 
                  }}
                  className="relative origin-top"
                >
                  <Image alt="Dashboard Mockup"
                      className="relative rounded-2xl border border-white/10 shadow-2xl w-full h-auto mx-auto"
                      width={1200}
                      height={800}
                      loading="lazy"
                      src="https://lh3.googleusercontent.com/aida/ADBb0uiOr-DESEXkqkE9BaoA2AvmyY_e0Du0EPjEueisx6sfkDZwhPas3KD7v3Tvm0I1YJ71g6Sywa_Akg8lm3XSucywemblkgpu5I6APAllNL26z8av2SkzCoBaksszU5W_nDgFZs11AGMnnU3stTkUK8pS6LQAGq0s4y96medmeWHXiKr7SjhoD3CWzR0E8mJoq13JXr9wIjMo1de9nPFVdnqZQBbW3BO82C90tq-NMrbYmUUejWgiZOi5qMdxvVAnrjc9X3ZBy5CcCg" />
                </motion.div>
            </div>
        </div>
    </section>
  );
}
