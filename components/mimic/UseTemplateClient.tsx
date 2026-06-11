"use client";

// Client driver for the "use as a template" flows:
//   • /use-template/[id]          → source="template" (a saved Template)
//   • /use-template/project/[id]  → source="project"  (a project used directly)
//
// On mount it resolves the use result (cached per source+id, else POSTs
// the matching route which mints a fresh Anthropic design file_id),
// writes the branding into CREATE_BRAND_KEY for MimicFlow's hydration,
// then renders MimicFlow in template mode. Logged-out users (401) bounce
// to /signup and return.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import MimicFlow from "@/components/mimic/MimicFlow";
import {
  fetchUse,
  applyTemplateUse,
  readCachedUse,
  writeCachedUse,
  TemplateUseError,
  type TemplateSource,
  type MimicTemplateSeed,
} from "@/lib/mimic/template-seed";

export default function UseTemplateClient({
  source,
  id,
}: {
  source: TemplateSource;
  id: string;
}) {
  const dict = useDict();
  const { dir } = useLocale();
  const router = useRouter();
  const [seed, setSeed] = useState<MimicTemplateSeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guard the resolve against React StrictMode double-mount (which would
  // otherwise mint the Anthropic file_id twice), keyed by source+id so an
  // in-place change of either — navigating between two template pages
  // without a full remount — re-resolves instead of holding stale data.
  const startedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${source}:${id}`;
    if (startedKeyRef.current === key) return;
    startedKeyRef.current = key;
    (async () => {
      // Reset for the new target (inside the async so it isn't a
      // synchronous setState in the effect body).
      setSeed(null);
      setError(null);
      try {
        let use = readCachedUse(source, id);
        if (!use) {
          use = await fetchUse(source, id);
          writeCachedUse(source, id, use);
        }
        setSeed(applyTemplateUse(id, use));
      } catch (err) {
        if (err instanceof TemplateUseError && err.status === 401) {
          const next =
            typeof window !== "undefined"
              ? window.location.pathname
              : source === "project"
                ? `/use-template/project/${id}`
                : `/use-template/${id}`;
          router.push(`/signup?next=${encodeURIComponent(next)}`);
          return;
        }
        setError(
          err instanceof Error ? err.message : dict.flows.mimic.useTemplateFailed,
        );
      }
    })();
  }, [source, id, router, dict]);

  if (error) {
    return (
      <div className="page-container flex w-full justify-center" dir={dir}>
        <div className="mt-[20vh] flex flex-col items-center gap-4 text-center">
          <p className="tq-subhead text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/templates")}
            className="btn-pill"
          >
            {dict.flows.mimic.backToTemplates}
          </button>
        </div>
      </div>
    );
  }

  if (!seed) {
    return (
      <div className="page-container flex w-full justify-center" dir={dir}>
        <div className="mt-[20vh] flex flex-col items-center gap-4">
          <span className="spinner h-8 w-8 rounded-full border-2 border-foreground/20 border-t-white" />
          <p className="tq-subhead">{dict.flows.mimic.preparingTemplate}</p>
        </div>
      </div>
    );
  }

  return <MimicFlow mode="template" templateSeed={seed} />;
}
