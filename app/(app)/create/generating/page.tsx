"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GeneratingRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  useEffect(() => {
    if (projectId) {
      router.replace(`/preview/${projectId}`);
    } else {
      router.replace("/create");
    }
  }, [projectId, router]);

  return null;
}

export default function GeneratingPage() {
  return (
    <Suspense fallback={null}>
      <GeneratingRedirect />
    </Suspense>
  );
}
