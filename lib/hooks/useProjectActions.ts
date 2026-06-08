"use client";

// Shared project actions — the menu/rename/favorite/delete/share/
// use-as-template logic used by the project cards (ProjectThumbnail). The
// action state + handlers + the four portalled dialogs live here + in the
// `<ProjectActionsDialogs>` companion so any future surface can reuse them.
//
// The consumer owns its own 3-dots trigger (it positions it differently)
// and its own title/rename UI; it wires them to the refs + handlers
// returned here, and renders `<ProjectActionsDialogs actions={actions} />`
// for the menu + dialogs.

import { useEffect, useRef, useState, type RefObject } from "react";
import { prepareTemplateUse } from "@/lib/mimic/template-seed";

// Mirror the server-side cap in /api/projects/[id] PATCH so the input
// can't write past what the route would silently truncate.
export const MAX_TITLE_LENGTH = 200;

type UseProjectActionsOptions = {
  initialFavorite: boolean;
  initialTitle: string;
  // The consumer owns these refs (so the lint rule sees them created +
  // attached in the same component) and attaches them to its own 3-dots
  // trigger + rename input; the hook reads `.current` only in handlers /
  // effects.
  menuBtnRef: RefObject<HTMLButtonElement | null>;
  renameInputRef: RefObject<HTMLInputElement | null>;
  // Fires AFTER the DELETE round-trip succeeds — the caller drops the
  // tile/row from its rendered list.
  onDeleted?: (projectId: string) => void;
  // Optional: notify the caller of a successful rename (other surfaces
  // showing the same title can sync).
  onRenamed?: (projectId: string, newTitle: string) => void;
  // Optional: notify the caller of a confirmed favorite-state change
  // (e.g. /favorites drops the tile when un-starred).
  onFavoriteChange?: (projectId: string, isFavorite: boolean) => void;
};

export type ProjectActions = ReturnType<typeof useProjectActions>;

export function useProjectActions(
  projectId: string,
  {
    initialFavorite,
    initialTitle,
    menuBtnRef,
    renameInputRef,
    onDeleted,
    onRenamed,
    onFavoriteChange,
  }: UseProjectActionsOptions,
) {
  // Menu open + the DOMRect it anchors to. Null rect ↔ closed.
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  // Optimistic favorite — server response replaces this once the PATCH
  // lands; reverted on failure so the failure is visible.
  const [favoriteState, setFavoriteState] = useState(initialFavorite);
  // Local title — optimistic on rename.
  const [titleState, setTitleState] = useState(initialTitle);
  const [renameMode, setRenameMode] = useState(false);
  const [renameDraft, setRenameDraft] = useState(initialTitle);
  const [renameSaving, setRenameSaving] = useState(false);
  // Synchronous single-flight latch: `renameSaving` state is async, so a
  // near-simultaneous onBlur + Enter can both clear the guard and fire two
  // PATCHes. A ref flips immediately, so the second call returns at once.
  const renameInFlight = useRef(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // While true the surface dims + can't re-fire the use-as-template prep.
  const [useTplBusy, setUseTplBusy] = useState(false);

  // Focus + select the rename input when entering rename mode (it only
  // exists conditionally, so defer to the next frame).
  useEffect(() => {
    if (renameMode) {
      const id = window.requestAnimationFrame(() => {
        const el = renameInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [renameMode, renameInputRef]);

  const openMenu = () =>
    setMenuRect(menuBtnRef.current?.getBoundingClientRect() ?? null);
  const closeMenu = () => setMenuRect(null);
  const toggleMenu = () => (menuRect != null ? closeMenu() : openMenu());

  const handleToggleFavorite = async () => {
    const previous = favoriteState;
    const next = !previous;
    setFavoriteState(next);
    try {
      const res = await fetch(`/api/projects/${projectId}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!res.ok) throw new Error(`favorite: ${res.status}`);
      const data = (await res.json()) as { isFavorite: boolean };
      setFavoriteState(data.isFavorite);
      onFavoriteChange?.(projectId, data.isFavorite);
    } catch (err) {
      // Revert the optimistic flip so the failure is visible (no toast
      // infra; next click retries).
      setFavoriteState(previous);
      console.error("favorite toggle failed", err);
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/project/${projectId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("copy link failed", err);
    }
  };

  const handleShare = () => setShareOpen(true);

  const enterRenameMode = () => {
    setRenameDraft(titleState);
    setRenameMode(true);
  };
  const cancelRename = () => {
    setRenameMode(false);
    setRenameDraft(titleState);
  };
  const commitRename = async () => {
    if (renameInFlight.current) return;
    const trimmed = renameDraft.trim().slice(0, MAX_TITLE_LENGTH);
    if (trimmed.length === 0 || trimmed === titleState) {
      cancelRename();
      return;
    }
    renameInFlight.current = true;
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`rename: ${res.status}`);
      const data = (await res.json()) as { title: string };
      setTitleState(data.title);
      onRenamed?.(projectId, data.title);
      setRenameMode(false);
    } catch (err) {
      // Keep rename mode + draft so the user can retry.
      console.error("rename failed", err);
    } finally {
      renameInFlight.current = false;
      setRenameSaving(false);
    }
  };

  const handleConfirmTrash = async () => {
    setTrashBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete: ${res.status}`);
      setTrashOpen(false);
      onDeleted?.(projectId);
    } catch (err) {
      // Leave the dialog open so the user can retry / cancel.
      console.error("delete failed", err);
    } finally {
      setTrashBusy(false);
    }
  };

  const handleUseAsTemplate = async () => {
    if (useTplBusy) return;
    setUseTplBusy(true);
    try {
      // Render the project's PDF + mint the Anthropic reference on the
      // dimmed surface, then navigate to the (now-cached) Mimic flow.
      await prepareTemplateUse("project", projectId);
      window.location.assign(`/use-template/project/${projectId}`);
    } catch (err) {
      console.warn("[useProjectActions] use-as-template prep failed", err);
      setUseTplBusy(false);
    }
  };

  return {
    projectId,
    // menu
    menuRect,
    openMenu,
    closeMenu,
    toggleMenu,
    // favorite
    favoriteState,
    // title / rename
    titleState,
    renameMode,
    renameDraft,
    renameSaving,
    setRenameDraft,
    enterRenameMode,
    cancelRename,
    commitRename,
    // use-as-template busy
    useTplBusy,
    // menu-item handlers (passed through ProjectActionsDialogs)
    handleToggleFavorite,
    handleCopyLink,
    handleShare,
    handleUseAsTemplate,
    handleConfirmTrash,
    // dialog open state (read + driven by ProjectActionsDialogs)
    trashOpen,
    trashBusy,
    setTrashOpen,
    saveTemplateOpen,
    setSaveTemplateOpen,
    shareOpen,
    setShareOpen,
  };
}
