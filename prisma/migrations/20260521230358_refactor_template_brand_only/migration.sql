-- Refactors `Template` from a kitchen-sink scaffold (category/industry/
-- featured/styleContract/pptxUrl/colors/fonts/layoutRules/thumbnail/
-- visibility/planRequired — all unused) into a brand-only model: a
-- snapshot of palette + fonts + layout style, rendered as 4 PNG
-- showcase slides (cover / typography / palette / layout sample), and
-- traceable back to the originating project via `sourceProjectId`
-- (non-FK — source project may be deleted).
--
-- Safe: Template table is empty (no rows in any environment) so the
-- column drops don't destroy data.
--
-- Adds:
--   • brand Json — see lib/template/derive-brand.ts for shape
--   • sourceProjectId — provenance pointer, null-on-delete via app logic
--   • publishedAt — set when isPublic flips true; orders public feed
--   • slideCount default 4 (every brand showcase has exactly 4 slides)
--   • compound indexes for the two list queries:
--       /templates community tab → WHERE isPublic ORDER BY publishedAt
--       /templates own tab       → WHERE ownerId ORDER BY createdAt

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "category",
DROP COLUMN "colors",
DROP COLUMN "featured",
DROP COLUMN "fonts",
DROP COLUMN "industry",
DROP COLUMN "layoutRules",
DROP COLUMN "planRequired",
DROP COLUMN "pptxUrl",
DROP COLUMN "styleContract",
DROP COLUMN "thumbnail",
DROP COLUMN "visibility",
ADD COLUMN     "brand" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "sourceProjectId" TEXT,
ALTER COLUMN "slideCount" SET DEFAULT 4;

-- CreateIndex
CREATE INDEX "Template_isPublic_publishedAt_idx" ON "Template"("isPublic", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Template_ownerId_createdAt_idx" ON "Template"("ownerId", "createdAt" DESC);
