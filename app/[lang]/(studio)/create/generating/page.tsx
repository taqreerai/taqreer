"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GeneratingRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  useEffect(() => {
    // TQ-FLOW-TRACKER — TEMPORARY (remove after testing; grep TQ-FLOW-TRACKER)
    console.log(
      `%c[flow]%c EVENT create:legacy-redirect → ${projectId ? `/project/${projectId}` : "/create"}`,
      "background:#370BF4;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700",
      "color:#370BF4;font-weight:600",
    );
    if (projectId) {
      router.replace(`/project/${projectId}`);
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
