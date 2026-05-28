"use client";

// Client wrapper for /brand-kits. Owns the:
//   • menu open state (which tile's 3-dots is showing)
//   • delete-confirm open state
//   • use-dialog open state
//   • optimistic removal of a deleted kit
//   • optimistic default-flag toggle (PATCH .../default)
//
// All three modals reuse glass + sibling-overlay primitives —
// see `BrandKitActionsMenu`, `BrandKitDeleteConfirmDialog`,
// `UseBrandKitDialog` for the per-modal recipes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandKitTile, type BrandKitTileData } from "@/components/app/BrandKitTile";
import { BrandKitActionsMenu } from "@/components/app/BrandKitActionsMenu";
import { BrandKitDeleteConfirmDialog } from "@/components/app/BrandKitDeleteConfirmDialog";
import { UseBrandKitDialog } from "@/components/app/UseBrandKitDialog";
import { Pagination } from "@/components/app/Pagination";
import {
  seedFromBrandKit,
  type BrandKitTargetFlow,
} from "@/lib/create/seed-from-brand-kit";

// 4 columns × 2 rows = 8 tiles per page. Same logic /projects uses
// (PAGE_SIZE pinned to a value that fits the largest grid step) so
// the boundary stays stable as the user resizes the window.
const PAGE_SIZE = 8;

// Read the API's `{ error }` payload if present, otherwise fall back
// to the status code. Used by every fetch handler below so the
// surfaced alert text matches what the server actually returned.
async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (${res.status})`;
}

export function BrandKitsPageClient({ kits }: { kits: BrandKitTileData[] }) {
  const router = useRouter();
  // Optimistic removal — flip a kit out of the rendered list as
  // soon as the delete confirms. router.refresh() also fires so
  // the SSR snapshot catches up; this just avoids the lag.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Optimistic override of `isDefault` per kit. When the user
  // toggles a kit as default via the 3-dots, we update this map
  // immediately and let `router.refresh()` reconcile from the
  // server. Map entry overrides the SSR value; missing entry uses
  // the SSR snapshot. Setting one kit to true clears every other
  // entry to mirror the server's transactional behavior.
  const [defaultOverride, setDefaultOverride] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());

  // Render with overrides applied so the star chip + the menu's
  // toggle-label reflect the optimistic state.
  const visibleKits = kits
    .filter((k) => !removedIds.has(k.id))
    .map((k) =>
      defaultOverride.has(k.id)
        ? { ...k, isDefault: defaultOverride.get(k.id) ?? k.isDefault }
        : k,
    );

  // Pagination — zero-indexed page. We clamp at READ time (via
  // `safePage`) rather than fire setPage inside an effect, which
  // would trip react-hooks/set-state-in-effect and cause a
  // cascading render every time visibleKits shrinks below the
  // current page. setPage still moves the user when they click a
  // pagination button; the clamp just keeps the rendered slice
  // honest until then.
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(visibleKits.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageKits = visibleKits.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  // Menu state — track which tile's menu is open + the trigger
  // rect for the popover's anchor math.
  const [menuKitId, setMenuKitId] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const menuKit = menuKitId
    ? visibleKits.find((k) => k.id === menuKitId) ?? null
    : null;

  // Delete dialog state.
  const [deleteKit, setDeleteKit] = useState<BrandKitTileData | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Use-flow dialog state.
  const [useKit, setUseKit] = useState<BrandKitTileData | null>(null);
  const [seeding, setSeeding] = useState(false);

  const handleMenuOpen = (kit: BrandKitTileData, rect: DOMRect) => {
    setMenuRect(rect);
    setMenuKitId(kit.id);
  };
  const closeMenu = () => {
    setMenuKitId(null);
    setMenuRect(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteKit) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/brand-kits/${deleteKit.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "تعذر الحذف"));
      }
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.add(deleteKit.id);
        return next;
      });
      setDeleteKit(null);
      router.refresh();
    } catch (err) {
      console.error("[brand-kits] delete failed", err);
      // Surface via alert for v1 — the project has no toast system
      // wired yet. Same fallback /templates uses for failed deletes.
      window.alert(
        err instanceof Error ? err.message : "تعذر حذف هوية الشركة",
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async (kit: BrandKitTileData) => {
    const next = !kit.isDefault;
    // Optimistic: setting next=true also clears every other kit's
    // default flag so the server's transactional "only one default"
    // behavior is mirrored in the UI immediately.
    const nextOverride = new Map<string, boolean>();
    if (next) {
      for (const k of kits) {
        if (k.id !== kit.id && k.isDefault) nextOverride.set(k.id, false);
      }
    }
    nextOverride.set(kit.id, next);
    setDefaultOverride(nextOverride);
    try {
      const res = await fetch(`/api/brand-kits/${kit.id}/default`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: next }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "تعذر التحديث"));
      }
      router.refresh();
    } catch (err) {
      console.error("[brand-kits] set-default failed", err);
      // Rollback by clearing the override; the SSR value takes over.
      setDefaultOverride(new Map());
      window.alert(
        err instanceof Error ? err.message : "تعذر تعيين الهوية الافتراضية",
      );
    }
  };

  const handleUsePick = async (flow: BrandKitTargetFlow) => {
    if (!useKit) return;
    setSeeding(true);
    try {
      await seedFromBrandKit(useKit.id);
      // Hard navigation so the target landing flow re-runs its
      // mount effect (and the freshly-written sessionStorage is
      // picked up on first render). Matches the use-template
      // wire's navigation behavior.
      window.location.assign(`/${flow}`);
    } catch (err) {
      console.error("[brand-kits] seed failed", err);
      setSeeding(false);
      window.alert(
        err instanceof Error ? err.message : "تعذر استخدام هوية الشركة",
      );
    }
    // No `finally setSeeding(false)` on success — we're navigating
    // away, leaving the spinner up keeps the click-card disabled
    // until the page unloads (no double-fire window).
  };

  if (visibleKits.length === 0) {
    return (
      <div
        dir="rtl"
        className="glass-card flex flex-col items-center justify-center gap-3 p-12 text-center"
      >
        <span
          className="material-symbols-outlined text-[40px] text-white/40"
          aria-hidden
        >
          id_card
        </span>
        <h2 className="text-lg font-semibold text-white">
          لا توجد هويات محفوظة
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          احفظ شعارك وألوانك وخطوطك مرة واحدة ثم استخدمها بضغطة زر في أي
          تدفق إنشاء.
        </p>
        <a
          href="/brand-kits/new"
          className="btn-gradient mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18 }}
            aria-hidden
          >
            add
          </span>
          إنشاء هوية جديدة
        </a>
      </div>
    );
  }

  return (
    <>
      {/* Bare grid — no wrapper container. The TILES carry their own
          rounded chrome (see BrandKitTile's `rounded-3xl`); a wrapper
          would just add a second layer of card-on-card visuals that
          fights for the user's attention. Pagination sits below the
          grid in the same flow. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pageKits.map((kit) => (
          <BrandKitTile
            key={kit.id}
            kit={kit}
            onUse={() => setUseKit(kit)}
            onMenuOpen={(rect) => handleMenuOpen(kit, rect)}
          />
        ))}
      </div>
      <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />

      <BrandKitActionsMenu
        open={menuKit !== null}
        triggerRect={menuRect}
        brandKitId={menuKit?.id ?? ""}
        isDefault={menuKit?.isDefault ?? false}
        onClose={closeMenu}
        onUse={() => {
          if (menuKit) setUseKit(menuKit);
        }}
        onSetDefault={() => {
          if (menuKit) void handleSetDefault(menuKit);
        }}
        onDelete={() => {
          if (menuKit) setDeleteKit(menuKit);
        }}
      />

      <UseBrandKitDialog
        open={useKit !== null}
        brandKitName={useKit?.name ?? ""}
        busy={seeding}
        onClose={() => {
          if (!seeding) setUseKit(null);
        }}
        onPick={handleUsePick}
      />

      <BrandKitDeleteConfirmDialog
        open={deleteKit !== null}
        brandKitName={deleteKit?.name ?? ""}
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteKit(null);
        }}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
