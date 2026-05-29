"use client";

// Client driver for /use-template/[id]. On mount it resolves the
// template "use" result (cached per id, else POST /api/templates/[id]/use
// which mints a fresh Anthropic design file_id), writes the branding
// into CREATE_BRAND_KEY for MimicFlow's hydration, then renders MimicFlow
// in template mode. Logged-out users (401) bounce to /signup and return.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MimicFlow from "@/components/mimic/MimicFlow";
import {
  fetchTemplateUse,
  applyTemplateUse,
  readCachedTemplateUse,
  writeCachedTemplateUse,
  TemplateUseError,
  type MimicTemplateSeed,
} from "@/lib/mimic/template-seed";

export default function UseTemplateClient({
  templateId,
}: {
  templateId: string;
}) {
  const router = useRouter();
  const [seed, setSeed] = useState<MimicTemplateSeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guard the one-shot resolve against React StrictMode double-mount
  // (which would otherwise re-mint the Anthropic file_id twice).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        let use = readCachedTemplateUse(templateId);
        if (!use) {
          use = await fetchTemplateUse(templateId);
          writeCachedTemplateUse(templateId, use);
        }
        setSeed(applyTemplateUse(templateId, use));
      } catch (err) {
        if (err instanceof TemplateUseError && err.status === 401) {
          router.push(
            `/signup?next=${encodeURIComponent(`/use-template/${templateId}`)}`,
          );
          return;
        }
        setError(
          err instanceof Error ? err.message : "تعذر استخدام القالب",
        );
      }
    })();
  }, [templateId, router]);

  if (error) {
    return (
      <div
        className="page-container flex w-full justify-center"
        dir="rtl"
      >
        <div className="mt-[20vh] flex flex-col items-center gap-4 text-center">
          <p className="tq-subhead text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/templates")}
            className="btn-pill"
          >
            العودة إلى القوالب
          </button>
        </div>
      </div>
    );
  }

  if (!seed) {
    return (
      <div
        className="page-container flex w-full justify-center"
        dir="rtl"
      >
        <div className="mt-[20vh] flex flex-col items-center gap-4">
          <span className="spinner h-8 w-8 rounded-full border-2 border-white/20 border-t-white" />
          <p className="tq-subhead">جارٍ تجهيز القالب...</p>
        </div>
      </div>
    );
  }

  return <MimicFlow mode="template" templateSeed={seed} />;
}
