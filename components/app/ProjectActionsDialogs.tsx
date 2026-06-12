"use client";

// The four portalled project-action surfaces — the actions menu + the
// save-as-template / trash-confirm / share dialogs — driven by a
// `useProjectActions` instance. Layout-independent (the consumer renders
// its own 3-dots trigger + title/rename UI); this just wires the shared
// menu + dialogs. Used by ProjectThumbnail (project cards).

import { ProjectActionsMenu } from "@/components/app/ProjectActionsMenu";
import { TrashConfirmDialog } from "@/components/app/TrashConfirmDialog";
import { SaveAsTemplateDialog } from "@/components/app/SaveAsTemplateDialog";
import { ShareDialog } from "@/components/app/ShareDialog";
import type { ProjectActions } from "@/lib/hooks/useProjectActions";

export function ProjectActionsDialogs({
  actions,
  // True when the tile is a deck SHARED WITH the viewer (not owned).
  // Owner-only items are omitted - their API routes are owner-scoped
  // and would 404 ("Project not found") for an invitee (2026-06-12).
  shared = false,
}: {
  actions: ProjectActions;
  shared?: boolean;
}) {
  return (
    <>
      <ProjectActionsMenu
        open={actions.menuRect !== null}
        triggerRect={actions.menuRect}
        projectId={actions.projectId}
        isFavorite={actions.favoriteState}
        onClose={actions.closeMenu}
        onShare={shared ? undefined : actions.handleShare}
        onRename={shared ? undefined : actions.enterRenameMode}
        onToggleFavorite={shared ? undefined : actions.handleToggleFavorite}
        onCopyLink={actions.handleCopyLink}
        onUseAsTemplate={shared ? undefined : actions.handleUseAsTemplate}
        onSaveAsTemplate={shared ? undefined : (() => actions.setSaveTemplateOpen(true))}
        onSendToTrash={shared ? undefined : (() => actions.setTrashOpen(true))}
      />

      <SaveAsTemplateDialog
        open={actions.saveTemplateOpen}
        projectId={actions.projectId}
        onCancel={() => actions.setSaveTemplateOpen(false)}
        onSaved={() => actions.setSaveTemplateOpen(false)}
      />

      <TrashConfirmDialog
        open={actions.trashOpen}
        projectTitle={actions.titleState}
        busy={actions.trashBusy}
        onCancel={() => {
          if (!actions.trashBusy) actions.setTrashOpen(false);
        }}
        onConfirm={actions.handleConfirmTrash}
      />

      <ShareDialog
        open={actions.shareOpen}
        projectId={actions.projectId}
        projectTitle={actions.titleState}
        onClose={() => actions.setShareOpen(false)}
      />
    </>
  );
}
