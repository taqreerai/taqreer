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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";
import { localizedHref } from "@/lib/i18n/navigation";
import { BrandKitTile, type BrandKitTileData } from "@/components/app/BrandKitTile";
import { BrandKitActionsMenu } from "@/components/app/BrandKitActionsMenu";
import { BrandKitDeleteConfirmDialog } from "@/components/app/BrandKitDeleteConfirmDialog";
import { BrandKitRenameDialog } from "@/components/app/BrandKitRenameDialog";
import { UseBrandKitDialog } from "@/components/app/UseBrandKitDialog";
import { Pagination } from "@/components/app/Pagination";
import { useMultiSelect } from "@/lib/hooks/useMultiSelect";
import { SelectionBar, SelectModeToggle } from "@/components/app/SelectionBar";
import { BulkDeleteConfirmDialog } from "@/components/app/BulkDeleteConfirmDialog";
import { SelectableTile } from "@/components/app/SelectableTile";
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
  const dict = useDict();
  const { dir, locale } = useLocale();
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

  // Optimistic override of `name` per kit — set on a successful rename
  // so the tile reflects the new name immediately while
  // `router.refresh()` reconciles the SSR snapshot.
  const [nameOverride, setNameOverride] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());

  // Render with overrides applied so the star chip + the menu's
  // toggle-label + the tile name reflect the optimistic state.
  const visibleKits = kits
    .filter((k) => !removedIds.has(k.id))
    .map((k) => {
      let kit = k;
      if (defaultOverride.has(k.id)) {
        kit = { ...kit, isDefault: defaultOverride.get(k.id) ?? kit.isDefault };
      }
      if (nameOverride.has(k.id)) {
        kit = { ...kit, name: nameOverride.get(k.id) ?? kit.name };
      }
      return kit;
    });

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

  // Multi-select to delete (2026-06-12).
  const sel = useMultiSelect();
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const handleBulkDelete = async () => {
    const ids = [...sel.selected];
    setBulkBusy(true);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/brand-kits/${id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        return id;
      }),
    );
    const okIds = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    setRemovedIds((prev) => new Set([...prev, ...okIds]));
    const failed = ids.length - okIds.length;
    setBulkBusy(false);
    setBulkConfirm(false);
    sel.exit();
    router.refresh();
    if (failed > 0) {
      window.alert(dict.common.bulk.partialFail.replace("{count}", String(failed)));
    }
  };

  // Rename dialog state.
  const [renameKit, setRenameKit] = useState<BrandKitTileData | null>(null);
  const [renaming, setRenaming] = useState(false);

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
        throw new Error(await readApiError(res, dict.pages.brandKits.errDelete));
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
        err instanceof Error ? err.message : dict.pages.brandKits.errDeleteKit,
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async (kit: BrandKitTileData) => {
    const next = !kit.isDefault;
    // Optimistic: setting next=true also clears every other kit's
    // default flag so the server's transactional "only one default"
    // behavior is mirrored in the UI immediately. Source `visibleKits`
    // (the override-aware view) not `kits` (the stale SSR snapshot)
    // so rapid toggles before `router.refresh()` returns don't drift
    // off the latest UI state (CR #41 finding, 2026-05-28).
    const nextOverride = new Map<string, boolean>();
    if (next) {
      for (const k of visibleKits) {
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
        throw new Error(await readApiError(res, dict.pages.brandKits.errUpdate));
      }
      router.refresh();
    } catch (err) {
      console.error("[brand-kits] set-default failed", err);
      // Rollback by clearing the override; the SSR value takes over.
      setDefaultOverride(new Map());
      window.alert(
        err instanceof Error ? err.message : dict.pages.brandKits.errSetDefault,
      );
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameKit) return;
    const id = renameKit.id;
    setRenaming(true);
    try {
      const res = await fetch(`/api/brand-kits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, dict.pages.brandKits.errRename));
      }
      // Optimistic: reflect the server-normalised name (trimmed +
      // capped at 120) immediately; router.refresh() reconciles the
      // SSR snapshot after.
      const body = (await res.json().catch(() => null)) as {
        name?: string;
      } | null;
      const savedName = body?.name ?? newName;
      setNameOverride((prev) => {
        const next = new Map(prev);
        next.set(id, savedName);
        return next;
      });
      setRenameKit(null);
      router.refresh();
    } catch (err) {
      console.error("[brand-kits] rename failed", err);
      window.alert(
        err instanceof Error ? err.message : dict.pages.brandKits.errRenameKit,
      );
    } finally {
      setRenaming(false);
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
        err instanceof Error ? err.message : dict.pages.brandKits.errUse,
      );
    }
    // No `finally setSeeding(false)` on success — we're navigating
    // away, leaving the spinner up keeps the click-card disabled
    // until the page unloads (no double-fire window).
  };

  if (visibleKits.length === 0) {
    return (
      <div
        dir={dir}
        className="surface-card flex flex-col items-center justify-center gap-3 p-12 text-center"
      >
        <span
          className="material-symbols-outlined text-[40px] text-foreground/40"
          aria-hidden
        >
          id_card
        </span>
        <h2 className="text-lg font-semibold text-foreground">
          {dict.pages.brandKits.emptyTitle}
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {dict.pages.brandKits.emptyDesc}
        </p>
        <Link
          href={localizedHref("/brand-kits/new", locale)}
          className="btn-gradient mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18 }}
            aria-hidden
          >
            add
          </span>
          {dict.pages.brandKits.createNew}
        </Link>
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
      {/* Select pill - brand-kits has no sort row, so it sits on its
          own end-aligned row above the grid (mirrors the other pages'
          position next to their sort controls). */}
      <div className="mb-4 flex justify-end">
        <SelectModeToggle active={sel.active} onToggle={sel.toggleMode} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pageKits.map((kit) => (
          <SelectableTile
            key={kit.id}
            active={sel.active}
            selected={sel.selected.has(kit.id)}
            onToggle={() => sel.toggle(kit.id)}
            radiusClassName="rounded-3xl"
          >
            <BrandKitTile
              kit={kit}
              onUse={() => setUseKit(kit)}
              onMenuOpen={(rect) => handleMenuOpen(kit, rect)}
            />
          </SelectableTile>
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
        onRename={() => {
          if (menuKit) setRenameKit(menuKit);
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

      <SelectionBar
        open={sel.active}
        count={sel.selected.size}
        onSelectAll={() => sel.selectAll(visibleKits.map((k) => k.id))}
        onDelete={() => setBulkConfirm(true)}
        onCancel={sel.exit}
        deleting={bulkBusy}
      />
      <BulkDeleteConfirmDialog
        open={bulkConfirm}
        title={dict.dialogs.bulkDelete.brandKitsTitle.replace(
          "{count}",
          String(sel.selected.size),
        )}
        body={dict.dialogs.bulkDelete.brandKitsBody}
        confirmLabel={dict.dialogs.bulkDelete.confirm}
        busy={bulkBusy}
        onCancel={() => {
          if (!bulkBusy) setBulkConfirm(false);
        }}
        onConfirm={handleBulkDelete}
      />

      <BrandKitRenameDialog
        open={renameKit !== null}
        currentName={renameKit?.name ?? ""}
        busy={renaming}
        onCancel={() => {
          if (!renaming) setRenameKit(null);
        }}
        onSave={handleRename}
      />
    </>
  );
}
