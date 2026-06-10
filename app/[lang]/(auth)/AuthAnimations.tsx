"use client";

import { AnimatePresence } from "framer-motion";

export function AuthAnimations({ children }: { children: React.ReactNode }) {
  return <AnimatePresence mode="wait">{children}</AnimatePresence>;
}
