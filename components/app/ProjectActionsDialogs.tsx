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
}: {
  actions: ProjectActions;
}) {
  return (
    <>
      <ProjectActionsMenu
        open={actions.menuRect !== null}
        triggerRect={actions.menuRect}
        projectId={actions.projectId}
        isFavorite={actions.favoriteState}
        onClose={actions.closeMenu}
        onShare={actions.handleShare}
        onRename={actions.enterRenameMode}
        onToggleFavorite={actions.handleToggleFavorite}
        onCopyLink={actions.handleCopyLink}
        onUseAsTemplate={actions.handleUseAsTemplate}
        onSaveAsTemplate={() => actions.setSaveTemplateOpen(true)}
        onSendToTrash={() => actions.setTrashOpen(true)}
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
