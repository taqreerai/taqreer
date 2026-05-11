"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type BrandState = {
  slideCount?: { mode?: "match" | "auto" | "custom"; value?: number | null };
};

function getStoredSlideCount() {
  try {
    const rawBrand = sessionStorage.getItem("taqreer:create:brand");
    if (!rawBrand) return 6;

    const brand = JSON.parse(rawBrand) as BrandState;
    const value = brand.slideCount?.mode === "custom" ? brand.slideCount.value : null;
    return value && value > 0 ? value : 6;
  } catch {
    return 6;
  }
}

function GeneratingShimmer() {
  return (
    <section dir="rtl" className="space-y-6">
      <div className="h-10 w-64 animate-pulse rounded bg-[rgba(42,36,59,0.5)]" />
      <div className="h-4 w-96 animate-pulse rounded bg-[rgba(42,36,59,0.4)]" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="glass-card overflow-hidden rounded-xl">
            <div className="aspect-video animate-pulse rounded-xl bg-[rgba(42,36,59,0.5)]" />
          </div>
        ))}
      </div>
    </section>
  );
}

function GeneratingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const [slideCount, setSlideCount] = useState(6);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!projectId) {
      router.replace("/create/content");
      return;
    }

    queueMicrotask(() => {
      setSlideCount(getStoredSlideCount());
    });
  }, [projectId, router]);

  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`presentation:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "presentation_versions",
        },
        (payload) => {
          const record = payload.new as {
            slide_json?: { status?: string; slides?: unknown[] };
            slideJson?: { status?: string; slides?: unknown[] };
            status?: string;
          };
          const slideJson = record?.slide_json ?? record?.slideJson;
          if (slideJson?.status === "complete" || record?.status === "completed") {
            router.push(`/preview/${projectId}`);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, router]);

  useEffect(() => {
    if (!projectId) return;

    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/status`);
        if (!response.ok) throw new Error("تعذر قراءة حالة المشروع");

        const data = (await response.json()) as {
          status: string;
          slideCount: number;
        };

        if (data.slideCount > 0) setSlideCount(data.slideCount);
        if (data.status === "complete" || data.status === "completed") {
          router.push(`/preview/${projectId}`);
        }
        if (data.status === "failed") {
          setFailed(true);
          setError("تعذر إنشاء العرض. يمكنك المحاولة مرة أخرى.");
        }
      } catch {
        setError("نحاول متابعة حالة الإنشاء...");
      }
    };

    void checkStatus();
    const interval = window.setInterval(checkStatus, 5000);
    return () => window.clearInterval(interval);
  }, [projectId, router]);

  const slides = useMemo(() => Array.from({ length: slideCount }), [slideCount]);

  const handleRetry = async () => {
    if (!projectId) return;
    setRetrying(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/retry`, { method: "POST" });
      if (!response.ok) throw new Error("تعذر إعادة المحاولة الآن");
      setFailed(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "تعذر إعادة المحاولة الآن");
    } finally {
      setRetrying(false);
    }
  };

  if (failed) {
    return (
      <section dir="rtl" className="space-y-6">
        <div className="glass-card mx-auto max-w-xl rounded-xl p-8 text-center">
          <span className="material-symbols-outlined mb-4 text-[42px] text-red-400">warning</span>
          <h1 className="mb-2 text-[26px] font-bold text-white">تعذر إنشاء العرض</h1>
          <p className="mb-6 text-[#9A94A8]">{error || "حدث خطأ أثناء تصميم الشرائح."}</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="btn-gradient inline-flex items-center justify-center gap-2 px-6 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retrying ? <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" /> : null}
              حاول مرة أخرى
            </button>
            <Link href="/dashboard" className="btn-outline-dark px-6 py-3 no-underline">
              العودة للرئيسية
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section dir="rtl" className="space-y-6">
      <div>
        <h1 className="font-headline-lg text-[36px] font-bold text-white">جارٍ تصميم عرضك...</h1>
        <p className="mt-2 text-[#9A94A8]">يعمل تقرير على إنشاء شرائحك — سيستغرق ذلك بضع دقائق</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {slides.map((_, index) => (
          <div key={index} className="glass-card overflow-hidden rounded-xl">
            <div className="aspect-video animate-pulse rounded-xl bg-[rgba(42,36,59,0.5)]" />
            <div className="space-y-2 p-3">
              <div className="h-3 w-2/3 animate-pulse rounded bg-[rgba(42,36,59,0.5)]" />
              <div className="h-2 w-1/2 animate-pulse rounded bg-[rgba(42,36,59,0.4)]" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 text-[#9A94A8]">
        <span className="spinner h-4 w-4 rounded-full border-2 border-white/20 border-t-white" />
        <span>جارٍ تصميم الشريحة...</span>
      </div>
      {error ? <p className="text-center text-sm text-[#9A94A8]">{error}</p> : null}
    </section>
  );
}

export default function GeneratingPage() {
  return (
    <Suspense fallback={<GeneratingShimmer />}>
      <GeneratingContent />
    </Suspense>
  );
}
