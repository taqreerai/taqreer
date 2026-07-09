// Bake the per-slide EDITOR SNAPSHOT for a freshly generated deck.
//
// Triggered by `inngest.send({ name: "deck.snapshot.bake", data: { projectId,
// versionId } })` from deck-generate once a version's slides are final. Renders
// the whole deck in the export-grade puppeteer render (scale 1, fonts loaded, no
// editor CSS) — the exact clean environment that made the flattener faithful in
// the 2026-07-09 stress audit — runs `flattenSlideSection` on each slide's
// section IN-PAGE, and writes the resulting absolute-positioned HTML into
// `slideJson.slides[i].editorHtml`.
//
// Why here and not in the editor: the in-browser editor-enter flatten ran at
// fractional zoom, mid-font-load, mid gen-image fade, with the editor's own
// selection/cursor CSS live in the cascade — the source of every flatten
// fidelity bug. Baking server-side in the clean render removes that whole class.
//
// `html` stays the canonical flow design (viewing + export); this only ADDS
// editorHtml, read by nobody until the editor + export are switched over. So the
// function is a safe no-op on existing behavior — it populates a new optional
// field. A slide whose bake trips the content-parity net is left WITHOUT
// editorHtml (the editor falls back to the legacy in-browser flatten for it).
//
// Failure isolation: fire-and-forget from generation's perspective; a failed
// bake must never block a deck from completing. onFailure logs only.

import { inngest } from "@/inngest/client";
import {
  launchGuardedBrowser,
  closeGuardedBrowser,
  guardPageEgress,
} from "@/lib/export/puppeteer-pool";
import { SlideManifestSchema, dimensionsForFormat } from "@/lib/schema/slide";
import { buildHtmlDocumentServer } from "@/lib/export/html-document-server";
import { FLATTEN_IIFE } from "@/lib/editor/flatten-iife.generated";

const NETWORK_IDLE_TIMEOUT_MS = 15_000;

export const deckSnapshotBake = inngest.createFunction(
  {
    id: "deck-snapshot-bake",
    name: "Bake editor snapshots",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "deck.snapshot.bake" }],
  },
  async ({ event, step, logger }) => {
    const { projectId, versionId } = event.data as {
      projectId: string;
      versionId: string;
    };
    if (!projectId || !versionId) {
      throw new Error("deck-snapshot-bake: event missing projectId / versionId");
    }

    // ─── Step 1: load + validate the version's manifest ─────────────
    const manifest = await step.run("load-manifest", async () => {
      const { prisma } = await import("@/lib/prisma");
      // Cross-check versionId belongs to this project (same guard as
      // thumbnail-render): a bad event payload must not bake another deck.
      const version = await prisma.presentationVersion.findFirst({
        where: { id: versionId, presentation: { projectId } },
        select: { slideJson: true },
      });
      if (!version) {
        throw new Error(
          `PresentationVersion ${versionId} not found OR not in project ${projectId}`,
        );
      }
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error(
          `Manifest failed validation: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      return parsed.data;
    });

    // ─── Step 2: render the deck + flatten each slide in-page ───────
    // Puppeteer state can't cross step boundaries, so the whole render +
    // flatten loop is one step; the result is slideId -> editorHtml.
    const snapshots = await step.run("render-and-flatten", async () => {
      const html = buildHtmlDocumentServer(manifest);
      const { width: canvasW, height: canvasH } = dimensionsForFormat(
        manifest.format,
      );
      const browser = await launchGuardedBrowser();
      try {
        const page = await browser.newPage();
        await guardPageEgress(page);
        await page.setViewport({
          width: canvasW,
          height: canvasH + 1,
          deviceScaleFactor: 1,
        });
        await page.setContent(html, {
          waitUntil: ["domcontentloaded", "networkidle0"],
          timeout: NETWORK_IDLE_TIMEOUT_MS,
        });
        // Fonts settle on their own clock after networkidle0 — geometry
        // must be font-accurate before the flatten measures it.
        await page.evaluate(() => {
          const f = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
          return f?.ready ?? Promise.resolve();
        });
        await page.evaluate(
          `new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); })`,
        );
        // Inject the flattener as a browser global (TQFlatten).
        await page.addScriptTag({ content: FLATTEN_IIFE });

        const out: Record<string, string> = {};
        let failed = 0;
        for (const slide of manifest.slides) {
          const res = (await page.evaluate((sid) => {
            const host = document.querySelector(`[data-slide-id="${sid}"]`);
            const sec = host?.querySelector("section.tq-canvas") as HTMLElement | null;
            if (!sec) return { ok: false, html: "", reason: "no-section" };
            // Paint the slide before measuring (deck is stacked; each
            // section is its own 1920x1080 box, flatten measures relative
            // to the section so stack position is irrelevant).
            sec.scrollIntoView({ block: "start", inline: "start" });
            const TQ = (window as unknown as {
              TQFlatten: {
                flattenSlideSection: (
                  s: HTMLElement,
                  o: { scale: number },
                ) => { html: string; parity: { ok: boolean } };
              };
            }).TQFlatten;
            const r = TQ.flattenSlideSection(sec, { scale: 1 });
            return { ok: r.parity.ok, html: r.html, reason: "" };
          }, cssEscape(slide.slideId))) as { ok: boolean; html: string; reason: string };
          if (res.ok && res.html) out[slide.slideId] = res.html;
          else failed++;
        }
        return { out, failed, total: manifest.slides.length };
      } finally {
        await closeGuardedBrowser(browser);
      }
    });

    if (snapshots.failed > 0) {
      logger.warn("deck_snapshot_bake_partial", {
        projectId,
        versionId,
        baked: snapshots.total - snapshots.failed,
        failed: snapshots.failed,
      });
    }

    // ─── Step 3: splice editorHtml into the version's manifest ──────
    // Read-modify-write the SAME versionId. This runs right after
    // generation, before the user can edit, so there is no concurrent
    // writer to race. Re-validate before writing so a malformed splice
    // can never corrupt the live deck.
    const written = await step.run("write-snapshots", async () => {
      const { prisma } = await import("@/lib/prisma");
      const version = await prisma.presentationVersion.findUnique({
        where: { id: versionId },
        select: { slideJson: true },
      });
      if (!version) throw new Error(`Version ${versionId} vanished before write`);
      const parsed = SlideManifestSchema.safeParse(version.slideJson);
      if (!parsed.success) {
        throw new Error("Manifest invalid at write time; skipping snapshot write");
      }
      const m = parsed.data;
      let count = 0;
      const slides = m.slides.map((s) => {
        const editorHtml = snapshots.out[s.slideId];
        if (!editorHtml) return s;
        count++;
        return { ...s, editorHtml };
      });
      const reparsed = SlideManifestSchema.safeParse({ ...m, slides });
      if (!reparsed.success) {
        throw new Error("Spliced manifest failed validation; not writing");
      }
      await prisma.presentationVersion.update({
        where: { id: versionId },
        data: { slideJson: reparsed.data as object },
      });
      return count;
    });

    return { versionId, baked: written, failed: snapshots.failed };
  },
);

// Same defensive CSS-attribute-selector escape as thumbnail-render.
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
