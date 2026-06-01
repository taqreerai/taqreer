-- Templates no longer carry titles (the AI `templateName` generation is
-- removed, and template tiles render as bare thumbnails). Drop both columns.
ALTER TABLE "Project" DROP COLUMN "templateName";
ALTER TABLE "Template" DROP COLUMN "title";
