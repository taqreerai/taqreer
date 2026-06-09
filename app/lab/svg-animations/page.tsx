"use client";

// Lab harness for the BiDi extraction demo — the scene itself lives in
// components/marketing/BidiExtractionDemo (also used in the landing features
// section). This page just renders it centred on a dark page for tuning.

import { BidiExtractionDemo } from "@/components/marketing/BidiExtractionDemo";

export default function BidiLabPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--tq-bg)] px-6">
      <BidiExtractionDemo />
    </main>
  );
}
